use crate::protocol::types::{TextEncoding, decode_bytes, encode_text};
// File management functionality for Hotline client

use super::{BoxedRead, BoxedWrite, FileInfo, HotlineClient};
use super::hope_aead::{TransferReader, TransferWriter, HopeAeadStreamReader, HopeAeadStreamWriter};
use crate::protocol::constants::{
    FieldType, TransactionType, FILE_TRANSFER_ID,
    HTXF_FLAG_LARGE_FILE, HTXF_FLAG_SIZE64, HTXF_FLAG_RESUME,
    resolve_error_message,
};
use crate::protocol::transaction::{Transaction, TransactionField};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

// Note: File transfers (HTXF) use their own separate TCP connections (port+1).
// When the control connection uses AEAD (ChaCha20-Poly1305), file transfers are
// also AEAD-encrypted with per-transfer derived keys. The HTXF handshake is
// always plaintext; AEAD framing begins immediately after the handshake.

/// Build the FilePath payload with the connection's negotiated encoding.
fn encode_file_path(path: &[String], encoding: TextEncoding) -> Option<Vec<u8>> {
    if path.is_empty() { None } else {
        Some(TransactionField::from_path_with(FieldType::FilePath, path, encoding).data)
    }
}

impl HotlineClient {
    /// Create a transfer connection (plain TCP or TLS) to the file transfer port.
    /// File transfers use main port + 1.
    pub(super) async fn create_transfer_stream(&self) -> Result<(BoxedRead, BoxedWrite), String> {
        let transfer_port = self.bookmark.port.checked_add(1).ok_or("Server port has no valid transfer port")?;
        let addr = crate::protocol::socket_addr_string(&self.bookmark.address, transfer_port);
        println!("Connecting to file transfer port: {}", transfer_port);

        let tcp_stream = tokio::time::timeout(
            Duration::from_secs(10),
            TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| format!("File transfer connection timed out after 10 seconds"))?
        .map_err(|e| format!("Failed to connect for file transfer: {}", e))?;

        if self.bookmark.tls {
            // Try modern TLS first; fall back to legacy if enabled
            match Self::wrap_tls(tcp_stream, &self.bookmark.address).await {
                Ok(tls_stream) => {
                    let (read_half, write_half) = tokio::io::split(tls_stream);
                    return Ok((Box::new(read_half), Box::new(write_half)));
                }
                Err(e) if self.allow_legacy_tls => {
                    println!("File transfer TLS 1.2+ failed ({}), retrying with legacy TLS...", e);
                    let addr = crate::protocol::socket_addr_string(&self.bookmark.address, transfer_port);
                    let tcp_stream = tokio::time::timeout(
                        Duration::from_secs(10),
                        TcpStream::connect(&addr),
                    )
                    .await
                    .map_err(|_| "File transfer legacy TLS reconnect timed out".to_string())?
                    .map_err(|e| format!("File transfer legacy TLS reconnect failed: {}", e))?;

                    let tls_stream = Self::wrap_tls_legacy(tcp_stream, &self.bookmark.address).await?;
                    let (read_half, write_half) = tokio::io::split(tls_stream);
                    return Ok((Box::new(read_half), Box::new(write_half)));
                }
                Err(e) => return Err(e),
            }
        } else {
            let (read_half, write_half) = tcp_stream.into_split();
            Ok((Box::new(read_half), Box::new(write_half)))
        }
    }

    pub async fn get_file_list(&self, path: Vec<String>) -> Result<(), String> {
        println!("Requesting file list for path: {:?}", path);

        let transaction_id = self.next_transaction_id();
        let mut transaction = Transaction::new(transaction_id, TransactionType::GetFileNameList);
        
        // Store the path for this transaction
        {
            let mut paths = self.file_list_paths.write().await;
            paths.insert(transaction_id, path.clone());
        }

        // Encode path as FilePath field
        if let Some(path_data) = encode_file_path(&path, self.encoding()) {
            println!("Path data encoded ({} bytes): {:02X?}", path_data.len(), path_data);
            transaction.add_field(TransactionField {
                field_type: FieldType::FilePath,
                data: path_data,
            });
        }

        println!("Sending GetFileNameList transaction...");
        self.send_transaction(&transaction).await?;

        println!("GetFileNameList request sent");

        Ok(())
    }

    pub async fn download_file(&self, path: Vec<String>, file_name: String) -> Result<(u32, Option<u64>), String> {
        self.download_file_at(path, file_name, 0).await
    }

    pub async fn download_file_at(&self, path: Vec<String>, file_name: String, offset: u64) -> Result<(u32, Option<u64>), String> {
        println!("Requesting download for file: {:?} / {}", path, file_name);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DownloadFile);

        // Add FileName field
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        // Add FilePath field if not at root
        if let Some(path_data) = encode_file_path(&path, self.encoding()) {
            transaction.add_field(TransactionField {
                field_type: FieldType::FilePath,
                data: path_data,
            });
        }

        if offset > 0 {
            transaction.add_field(TransactionField::from_u16(FieldType::FileTransferOptions, 2));
            transaction.add_field(TransactionField::new(FieldType::FileResumeData, super::transfer_io::resume_data(offset)));
            if self.large_file_support.load(Ordering::SeqCst) {
                transaction.add_field(TransactionField::from_u64(FieldType::Offset64, offset));
            } else if offset > u32::MAX as u64 {
                return Err("Resume offset exceeds this server's limit".into());
            }
        }

        let transaction_id = transaction.id;

        // Create channel to receive reply
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        // Send transaction
        println!("Sending DownloadFile transaction...");
        self.send_transaction(&transaction).await?;

        // Wait for reply
        println!("Waiting for DownloadFile reply...");
        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => reply,
            Ok(None) => {
                // Channel closed, remove from pending
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Channel closed".to_string());
            }
            Err(_) => {
                // Timeout, remove from pending
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for download reply".to_string());
            }
        };

        println!("DownloadFile reply received: error_code={}, {} fields", reply.error_code, reply.fields.len());

        // Print all fields for debugging
        for (i, field) in reply.fields.iter().enumerate() {
            println!("  Field {}: type={:?}, size={} bytes, data={:02X?}",
                i, field.field_type, field.data.len(),
                &field.data[..std::cmp::min(20, field.data.len())]);
        }

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Download failed: {}", error_msg));
        }

        // Get reference number from reply
        let reference_number = reply
            .get_field(FieldType::ReferenceNumber)
            .and_then(|f| f.to_u32().ok())
            .ok_or("No reference number in reply".to_string())?;

        println!("Download reference number: {}", reference_number);

        // Get transfer size — prefer 64-bit field if available
        let transfer_size_64 = reply.get_field(FieldType::TransferSize64)
            .and_then(|f| f.to_u64().ok());
        let transfer_size_32 = reply.get_field(FieldType::TransferSize)
            .and_then(|f| f.to_u32().ok());
        let transfer_size = transfer_size_64.or(transfer_size_32.map(|v| v as u64));

        if let Some(size) = transfer_size {
            println!("Transfer size from server: {} bytes", size);
        }

        // Get file size — prefer 64-bit field if available
        let file_size_64 = reply.get_field(FieldType::FileSize64)
            .and_then(|f| f.to_u64().ok());
        let file_size_32 = reply.get_field(FieldType::FileSize)
            .and_then(|f| f.to_u32().ok());
        let file_size = file_size_64.or(file_size_32.map(|v| v as u64));

        if let Some(size) = file_size {
            println!("File size from server: {} bytes ({:.2} MB)", size, size as f64 / 1_000_000.0);
        }

        // Check for file transfer options
        if let Some(options_field) = reply.get_field(FieldType::FileTransferOptions) {
            println!("File transfer options: {:02X?}", options_field.data);
        }

        // Return both reference number and server-reported file size
        Ok((reference_number, file_size))
    }

    pub async fn receive_file_to_disk<F: FnMut(u64, u64) + Send>(
        &self, reference: u32, remaining: Option<u64>, offset: u64,
        file: &mut tokio::fs::File, mut progress: F,
    ) -> Result<u64, String> {
        let large = self.large_file_support.load(Ordering::SeqCst);
        let (reader, mut writer) = self.create_transfer_stream().await?;
        let mut handshake = b"HTXF".to_vec();
        handshake.extend_from_slice(&reference.to_be_bytes());
        handshake.extend_from_slice(&0u32.to_be_bytes());
        handshake.extend_from_slice(&(if large { HTXF_FLAG_LARGE_FILE } else { 0 }).to_be_bytes());
        writer.write_all(&handshake).await.map_err(|e| e.to_string())?;
        writer.flush().await.map_err(|e| e.to_string())?;
        let mut reader = if let Some(key) = self.derive_transfer_key(reference).await {
            TransferReader::Aead(HopeAeadStreamReader::new(reader, &key))
        } else { TransferReader::Plain(reader) };
        let count = super::transfer_io::receive_file(&mut reader, file, large, remaining, offset == 0, None,
            |n| progress(offset + n, offset + remaining.unwrap_or(n))).await?;
        file.flush().await.map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub async fn perform_file_transfer<F>(&self, reference_number: u32, expected_size: u64, mut progress_callback: F) -> Result<Vec<u8>, String>
    where
        F: FnMut(u64, u64) + Send,
    {
        let large_file_mode = self.large_file_support.load(Ordering::SeqCst);
        println!("Starting file transfer with reference number: {} (large file mode: {})", reference_number, large_file_mode);

        // Open a new connection (TCP or TLS) to the server for file transfer
        let (mut transfer_read, mut transfer_write) = self.create_transfer_stream().await?;

        println!("File transfer connection established");

        // Send file transfer handshake
        // Standard: HTXF (4) + reference_number (4) + size (4) + flags (4) = 16 bytes
        // Large file: + optional 8-byte 64-bit length = 24 bytes (when SIZE64 flag set)
        let mut handshake = Vec::with_capacity(if large_file_mode { 24 } else { 16 });
        handshake.extend_from_slice(FILE_TRANSFER_ID); // "HTXF"
        handshake.extend_from_slice(&reference_number.to_be_bytes());
        handshake.extend_from_slice(&0u32.to_be_bytes()); // legacy size (0 for download)
        if large_file_mode {
            let flags = HTXF_FLAG_LARGE_FILE;
            handshake.extend_from_slice(&flags.to_be_bytes());
        } else {
            handshake.extend_from_slice(&0u32.to_be_bytes()); // no flags
        }

        println!("Sending file transfer handshake ({} bytes): {:02X?}", handshake.len(), &handshake);
        transfer_write
            .write_all(&handshake)
            .await
            .map_err(|e| format!("Failed to send file transfer handshake: {}", e))?;

        transfer_write
            .flush()
            .await
            .map_err(|e| format!("Failed to flush handshake: {}", e))?;

        // Wrap in AEAD if active (handshake was plaintext, AEAD starts now)
        let mut transfer_read: TransferReader = if let Some(key) = self.derive_transfer_key(reference_number).await {
            println!("[HOPE-AEAD-FT] Wrapping download in AEAD framing");
            TransferReader::Aead(HopeAeadStreamReader::new(transfer_read, &key))
        } else {
            TransferReader::Plain(transfer_read)
        };

        println!("File transfer handshake sent, waiting for response...");

        // Try to read any response from server first
        let mut peek_buffer = [0u8; 4];
        println!("Attempting to peek at server response...");
        let bytes_read = match tokio::time::timeout(
            Duration::from_secs(5),
            transfer_read.read(&mut peek_buffer)
        ).await {
            Ok(Ok(n)) => {
                println!("Server sent {} bytes: {:02X?}", n, &peek_buffer[..n]);
                n
            }
            Ok(Err(e)) => {
                return Err(format!("Error reading from server: {}", e));
            }
            Err(_) => {
                return Err("Timeout waiting for server response - server sent nothing".to_string());
            }
        };

        if bytes_read == 0 {
            return Err("Server closed connection immediately after handshake".to_string());
        }

        // Read rest of header (total 24 bytes for FILP header)
        // Format: FILP (4) + version (2) + reserved (16) + fork count (2)
        let mut response_header = [0u8; 24];
        response_header[..bytes_read].copy_from_slice(&peek_buffer[..bytes_read]);

        if bytes_read < 24 {
            transfer_read
                .read_exact(&mut response_header[bytes_read..])
                .await
                .map_err(|e| format!("Failed to read rest of file transfer header: {}", e))?;
        }

        println!("File transfer header received (24 bytes): {:02X?}", &response_header);

        // The header should start with "FILP"
        if &response_header[0..4] != b"FILP" {
            // Legacy fallback: very old servers may not send a FILP header.
            // If the first 4 bytes look like a fork type (DATA/MACR/INFO),
            // treat the 24 bytes we read as FILP-header(24 bytes) that is
            // actually the first fork header (16 bytes) + 8 extra bytes we
            // over-read.  Otherwise, treat the entire stream as raw file data.
            let magic = &response_header[0..4];
            if magic == b"DATA" || magic == b"MACR" || magic == b"INFO" {
                println!("No FILP wrapper — server sent fork data directly (legacy mode)");
                self.emit_protocol_log("warn", "Server sent fork data without FILP header (legacy server)");
                // We read 24 bytes but the fork header is only 16 bytes.
                // Parse the first fork from response_header[0..16] and treat
                // response_header[16..24] as the start of fork data.
                let fork_header = &response_header[0..16];
                let fork_type = String::from_utf8_lossy(&fork_header[0..4]).to_string();
                let data_size: u64 = {
                    let size = u32::from_be_bytes([fork_header[12], fork_header[13], fork_header[14], fork_header[15]]) as u64;
                    println!("Legacy fork: type='{}', size={} bytes", fork_type.trim(), size);
                    size
                };
                let actual_size = if data_size == 0 && expected_size > 0 { expected_size } else { data_size };
                // We already consumed 8 bytes past the fork header — prepend them
                let prefix = &response_header[16..24];
                let remaining = if actual_size > 8 { actual_size - 8 } else { 0 };
                let mut file_data = prefix.to_vec();
                if remaining > 0 {
                    let mut rest = vec![0u8; remaining as usize];
                    transfer_read.read_exact(&mut rest).await
                        .map_err(|e| format!("Failed to read legacy fork data: {}", e))?;
                    file_data.extend_from_slice(&rest);
                }
                progress_callback(file_data.len() as u64, actual_size);
                return Ok(file_data);
            } else {
                println!("No FILP header and no recognisable fork — treating as raw file data");
                self.emit_protocol_log("warn", "No FILP header — reading raw file data (very old server)");
                // Treat response_header + remaining stream as raw file bytes
                let mut file_data = response_header.to_vec();
                let remaining = if expected_size > 24 { expected_size - 24 } else { 0 };
                if remaining > 0 {
                    let mut rest = vec![0u8; remaining as usize];
                    transfer_read.read_exact(&mut rest).await
                        .map_err(|e| format!("Failed to read raw file data: {}", e))?;
                    file_data.extend_from_slice(&rest);
                }
                progress_callback(file_data.len() as u64, expected_size);
                return Ok(file_data);
            }
        }

        let version = u16::from_be_bytes([response_header[4], response_header[5]]);
        println!("FILP version: {}", version);

        // Read fork count from bytes 22-23 (after 4 + 2 + 16 bytes)
        let fork_count = u16::from_be_bytes([response_header[22], response_header[23]]);
        println!("File has {} fork(s)", fork_count);

        // Read each fork header and data
        let mut file_data = Vec::new();

        for fork_idx in 0..fork_count {
            // Fork header format (16 bytes):
            // Fork type (4 bytes) - "DATA" or "MACR" (resource fork) or "INFO"
            // In legacy mode:
            //   Compression type (4 bytes)
            //   Reserved (4 bytes)
            //   Data size (4 bytes)
            // In large file mode:
            //   High 32 bits of fork length (4 bytes)
            //   Compression type (4 bytes)
            //   Low 32 bits of fork length (4 bytes)
            let mut fork_header = [0u8; 16];
            transfer_read
                .read_exact(&mut fork_header)
                .await
                .map_err(|e| format!("Failed to read fork {} header: {}", fork_idx, e))?;

            println!("Fork {} header bytes: {:02X?}", fork_idx, &fork_header);

            let fork_type = String::from_utf8_lossy(&fork_header[0..4]).to_string();

            let data_size: u64 = if large_file_mode {
                // Large file mode: bytes 4-7 = high 32 bits, bytes 12-15 = low 32 bits
                let high = u32::from_be_bytes([fork_header[4], fork_header[5], fork_header[6], fork_header[7]]) as u64;
                let low = u32::from_be_bytes([fork_header[12], fork_header[13], fork_header[14], fork_header[15]]) as u64;
                let size = (high << 32) | low;
                let compression = u32::from_be_bytes([fork_header[8], fork_header[9], fork_header[10], fork_header[11]]);
                println!("Fork {} (large file): type='{}', compression={}, size={} bytes ({:.2} MB)",
                    fork_idx, fork_type.trim(), compression, size, size as f64 / 1_000_000.0);
                size
            } else {
                // Legacy mode: bytes 4-7 = compression, bytes 12-15 = size
                let compression = u32::from_be_bytes([fork_header[4], fork_header[5], fork_header[6], fork_header[7]]);
                let size = u32::from_be_bytes([fork_header[12], fork_header[13], fork_header[14], fork_header[15]]) as u64;
                println!("Fork {}: type='{}', compression={}, size={} bytes", fork_idx, fork_type.trim(), compression, size);
                size
            };

            // Determine actual size to read
            let (actual_size, read_until_eof) = if data_size == 0 && fork_type.trim() == "DATA" && expected_size > 0 {
                // With large file support, we trust the expected_size more
                if large_file_mode {
                    println!("Fork header shows 0 size in large file mode, using expected size: {} bytes ({:.2} MB)",
                        expected_size, expected_size as f64 / 1_000_000.0);
                    (expected_size, false)
                } else {
                    // Legacy heuristics for corrupted sizes
                    let is_suspicious = expected_size > 2_000_000_000;
                    if is_suspicious {
                        println!("WARNING: File size ({:.2} GB) is suspiciously large and fork header shows size=0. Attempting to read until EOF...",
                            expected_size as f64 / 1_000_000_000.0);
                    } else {
                        println!("Fork header shows 0 size, using expected size: {} bytes ({:.2} MB)",
                            expected_size, expected_size as f64 / 1_000_000.0);
                    }
                    (expected_size, is_suspicious)
                }
            } else {
                if fork_type.trim() == "DATA" && data_size != expected_size && expected_size > 0 {
                    println!("Note: DATA fork header size ({}) differs from file list size ({})", data_size, expected_size);
                }
                (data_size, false)
            };

            // Read fork data
            if actual_size > 0 || read_until_eof {
                let is_data_fork = fork_type.trim() == "DATA";

                if is_data_fork {
                    let chunk_size: usize = 65536; // 64KB chunks
                    let initial_capacity = if read_until_eof {
                        1024 * 1024
                    } else if actual_size > 100_000_000 {
                        std::cmp::min((actual_size / 100) as usize, 10 * 1024 * 1024)
                    } else {
                        std::cmp::min(actual_size as usize, 10 * 1024 * 1024)
                    };
                    let mut fork_data = Vec::with_capacity(initial_capacity);
                    let mut bytes_read: u64 = 0;
                    let mut last_reported_progress: u64 = 0;

                    if read_until_eof {
                        println!("Reading file until EOF (file list size may be corrupted)...");
                        loop {
                            let mut chunk = vec![0u8; chunk_size];
                            match transfer_read.read(&mut chunk).await {
                                Ok(0) => {
                                    println!("EOF reached after reading {} bytes", bytes_read);
                                    break;
                                }
                                Ok(n) => {
                                    chunk.truncate(n);
                                    bytes_read += n as u64;
                                    fork_data.extend_from_slice(&chunk);
                                    if bytes_read % (1024 * 1024) == 0 || bytes_read < 1024 * 1024 {
                                        progress_callback(bytes_read, bytes_read.max(1));
                                    }
                                }
                                Err(e) => {
                                    if bytes_read > 0 && e.kind() == std::io::ErrorKind::UnexpectedEof {
                                        println!("EOF reached after reading {} bytes (unexpected EOF)", bytes_read);
                                        break;
                                    }
                                    return Err(format!("Failed to read fork {} data: {}", fork_idx, e));
                                }
                            }
                        }
                        println!("Received DATA fork: {} bytes (read until EOF)", fork_data.len());
                    } else {
                        while bytes_read < actual_size {
                            let remaining = actual_size - bytes_read;
                            let to_read = std::cmp::min(remaining, chunk_size as u64) as usize;
                            let mut chunk = vec![0u8; to_read];

                            match transfer_read.read_exact(&mut chunk).await {
                                Ok(_) => {
                                    bytes_read += to_read as u64;
                                    fork_data.extend_from_slice(&chunk);

                                    let current_progress = (bytes_read as f64 / actual_size as f64 * 100.0) as u64;
                                    if current_progress >= last_reported_progress + 2 || bytes_read == actual_size {
                                        progress_callback(bytes_read, actual_size);
                                        last_reported_progress = current_progress;
                                    }
                                }
                                Err(e) => {
                                    if bytes_read > 0 && e.kind() == std::io::ErrorKind::UnexpectedEof {
                                        println!("Warning: Early EOF after reading {} of {} bytes. File may be incomplete.", bytes_read, actual_size);
                                        break;
                                    }
                                    return Err(format!("Failed to read fork {} data at offset {}: {}", fork_idx, bytes_read, e));
                                }
                            }
                        }
                        println!("Received DATA fork: {} bytes (expected: {} bytes)", fork_data.len(), actual_size);
                        if fork_data.len() as u64 != actual_size {
                            println!("Warning: Received {} bytes but expected {} bytes. File may be incomplete.", fork_data.len(), actual_size);
                        }
                    }

                    file_data = fork_data;
                } else {
                    // For INFO/MACR forks, read all at once
                    let mut fork_data = vec![0u8; actual_size as usize];
                    transfer_read
                        .read_exact(&mut fork_data)
                        .await
                        .map_err(|e| format!("Failed to read fork {} data: {}", fork_idx, e))?;

                    if fork_type.trim() == "INFO" {
                        println!("Skipped INFO fork: {} bytes", fork_data.len());
                    } else if fork_type.trim() == "MACR" {
                        println!("Skipped MACR (resource) fork: {} bytes", fork_data.len());
                    }
                }
            }
        }

        println!("File transfer complete: {} bytes received", file_data.len());

        Ok(file_data)
    }

    pub(crate) fn parse_file_info(data: &[u8], encoding: TextEncoding) -> Result<FileInfo, String> {
        // FileNameWithInfo format:
        // 4 bytes: File type (4-char code)
        // 4 bytes: Creator (4-char code)
        // 4 bytes: File size
        // 4 bytes: Unknown/reserved
        // 2 bytes: Unknown/flags
        // 2 bytes: Name length
        // N bytes: File name

        if data.len() < 20 {
            return Err(format!("FileNameWithInfo data too short: {} bytes", data.len()));
        }

        let file_type = String::from_utf8_lossy(&data[0..4]).to_string();
        let creator = String::from_utf8_lossy(&data[4..8]).to_string();
        let size = u32::from_be_bytes([data[8], data[9], data[10], data[11]]) as u64;
        // Skip bytes 12-15 (unknown/reserved)
        // Skip bytes 16-17 (unknown/flags)
        let name_len = u16::from_be_bytes([data[18], data[19]]) as usize;

        if data.len() < 20 + name_len {
            return Err(format!("FileNameWithInfo name data too short: have {} bytes, need {}", data.len(), 20 + name_len));
        }

        let name = decode_bytes(&data[20..20 + name_len], encoding);

        // Folders have file type "fldr"
        let is_folder = file_type.trim() == "fldr";

        Ok(FileInfo {
            name,
            size,
            is_folder,
            file_type,
            creator,
        })
    }

    pub async fn download_banner(&self) -> Result<(u32, u32), String> {
        println!("Requesting banner download...");

        let transaction = Transaction::new(self.next_transaction_id(), TransactionType::DownloadBanner);
        let transaction_id = transaction.id;

        // Create channel to receive reply
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        // Send transaction
        println!("Sending DownloadBanner transaction...");
        self.send_transaction(&transaction).await?;

        // Wait for reply
        println!("Waiting for DownloadBanner reply...");
        let reply = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .map_err(|_| "Timeout waiting for banner reply".to_string())?
            .ok_or("Channel closed".to_string())?;

        println!("DownloadBanner reply received: error_code={}", reply.error_code);

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Banner download failed: {}", error_msg));
        }

        // Get reference number and transfer size from reply
        let reference_number = reply
            .get_field(FieldType::ReferenceNumber)
            .and_then(|f| f.to_u32().ok())
            .ok_or("No reference number in reply".to_string())?;

        let transfer_size = reply
            .get_field(FieldType::TransferSize)
            .and_then(|f| f.to_u32().ok())
            .ok_or("No transfer size in reply".to_string())?;

        println!("Banner reference number: {}, transfer size: {} bytes", reference_number, transfer_size);

        Ok((reference_number, transfer_size))
    }

    /// Download banner as raw image data (not FILP format)
    /// Banners are sent as raw image data after the HTXF handshake
    pub async fn download_banner_raw(&self, reference_number: u32, transfer_size: u32) -> Result<Vec<u8>, String> {
        println!("Starting banner download (raw data) with reference: {}, size: {} bytes", reference_number, transfer_size);

        // Open a new connection (TCP or TLS) for file transfer
        let (mut transfer_read, mut transfer_write) = self.create_transfer_stream().await?;

        println!("Banner transfer connection established");

        // Send file transfer handshake (same as regular file transfer)
        let mut handshake = Vec::with_capacity(16);
        handshake.extend_from_slice(FILE_TRANSFER_ID); // "HTXF"
        handshake.extend_from_slice(&reference_number.to_be_bytes());
        handshake.extend_from_slice(&0u32.to_be_bytes());
        handshake.extend_from_slice(&0u32.to_be_bytes());

        println!("Sending banner transfer handshake ({} bytes): {:02X?}", handshake.len(), &handshake);
        transfer_write
            .write_all(&handshake)
            .await
            .map_err(|e| format!("Failed to send banner handshake: {}", e))?;

        transfer_write
            .flush()
            .await
            .map_err(|e| format!("Failed to flush handshake: {}", e))?;

        // Wrap in AEAD if active (handshake was plaintext, AEAD starts now)
        let mut transfer_read: TransferReader = if let Some(key) = self.derive_transfer_key(reference_number).await {
            println!("[HOPE-AEAD-FT] Wrapping banner download in AEAD framing");
            TransferReader::Aead(HopeAeadStreamReader::new(transfer_read, &key))
        } else {
            TransferReader::Plain(transfer_read)
        };

        println!("Banner handshake sent, reading raw image data...");

        // Read raw data directly (no FILP header for banners)
        // The server sends the image data immediately after the handshake
        let chunk_size = 65536; // 64KB chunks
        let mut banner_data = Vec::with_capacity(transfer_size as usize);
        let mut bytes_read = 0u32;

        while bytes_read < transfer_size {
            let remaining = transfer_size - bytes_read;
            let to_read = std::cmp::min(remaining, chunk_size) as usize;
            let mut chunk = vec![0u8; to_read];

            transfer_read
                .read_exact(&mut chunk)
                .await
                .map_err(|e| format!("Failed to read banner data: {}", e))?;

            bytes_read += to_read as u32;
            banner_data.extend_from_slice(&chunk);
        }

        println!("Banner download complete: {} bytes received", banner_data.len());

        Ok(banner_data)
    }

    /// Upload a file to the server
    /// - path: Directory path where the file should be uploaded
    /// - file_name: Name of the file to upload
    /// - file_data: The file contents to upload
    /// - progress_callback: Callback for progress updates (bytes_sent, total_bytes)
    pub async fn upload_file<F>(
        &self,
        path: Vec<String>,
        file_name: String,
        file_data: Vec<u8>,
        mut progress_callback: F,
    ) -> Result<(), String>
    where
        F: FnMut(u64, u64),
    {
        println!("Requesting file upload: {} to path {:?}", file_name, path);

        let transaction_id = self.next_transaction_id();
        let mut transaction = Transaction::new(transaction_id, TransactionType::UploadFile);

        if !self.large_file_support.load(Ordering::SeqCst) && file_data.len() as u64 > u32::MAX as u64 - 56 {
            return Err("Upload is too large for a legacy server".into());
        }
        transaction.add_field(TransactionField::from_u16(FieldType::FileTransferOptions, 2));

        // Add file name field
        transaction.add_field(TransactionField {
            field_type: FieldType::FileName,
            data: encode_text(&file_name, self.encoding()),
        });

        // Add file path field if not root
        if let Some(path_data) = encode_file_path(&path, self.encoding()) {
            transaction.add_field(TransactionField {
                field_type: FieldType::FilePath,
                data: path_data,
            });
        }

        // Create channel to receive reply
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        // Send transaction
        println!("Sending UploadFile transaction...");
        self.send_transaction(&transaction).await?;

        // Wait for reply
        println!("Waiting for UploadFile reply...");
        let reply = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .map_err(|_| "Timeout waiting for upload reply".to_string())?
            .ok_or("Channel closed".to_string())?;

        println!("UploadFile reply received: error_code={}", reply.error_code);

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Upload failed: {}", error_msg));
        }

        // Get reference number from reply
        let reference_number = reply
            .get_field(FieldType::ReferenceNumber)
            .and_then(|f| f.to_u32().ok())
            .ok_or("No reference number in reply".to_string())?;

        println!("Upload reference number: {}", reference_number);

        // Perform the actual file transfer
        let proposed_offset = reply.get_field(FieldType::Offset64).and_then(|f| f.to_u64().ok()).unwrap_or(0);
        let digest = if self.large_file_support.load(Ordering::SeqCst) {
            reply.get_field(FieldType::PartialDigest).and_then(|f|
                super::transfer_io::verified_upload_resume(&file_data, proposed_offset, &f.data))
        } else { None };
        let offset = if self.large_file_support.load(Ordering::SeqCst) {
            if digest.is_some() { proposed_offset } else { 0 }
        } else if let Some(resume) = reply.get_field(FieldType::FileResumeData) {
            let offset = super::transfer_io::legacy_resume_offset(&resume.data)?;
            if offset > file_data.len() as u64 { return Err("Server resume offset exceeds local file size".into()); }
            offset
        } else { 0 };
        self.perform_file_upload(reference_number, &file_name, &file_data, offset, digest, &mut progress_callback)
            .await?;

        Ok(())
    }

    pub async fn create_folder(&self, path: Vec<String>, name: String) -> Result<(), String> {
        println!("Creating folder '{}' at path: {:?}", name, path);

        let transaction_id = self.next_transaction_id();
        let mut transaction = Transaction::new(transaction_id, TransactionType::NewFolder);

        // Add folder name
        transaction.add_field(TransactionField {
            field_type: FieldType::FileName,
            data: encode_text(&name, self.encoding()),
        });

        // Add path field if not at root
        if let Some(path_data) = encode_file_path(&path, self.encoding()) {
            transaction.add_field(TransactionField {
                field_type: FieldType::FilePath,
                data: path_data,
            });
        }

        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .map_err(|_| "Timeout waiting for create folder reply".to_string())?
            .ok_or("Channel closed".to_string())?;

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Create folder failed: {}", error_msg));
        }

        println!("Folder '{}' created successfully", name);

        Ok(())
    }

    /// Perform the actual file upload transfer
    async fn perform_file_upload<F>(
        &self,
        reference_number: u32,
        file_name: &str,
        file_data: &[u8],
        resume_offset: u64,
        resume_digest: Option<[u8; 40]>,
        progress_callback: &mut F,
    ) -> Result<(), String>
    where
        F: FnMut(u64, u64),
    {
        let large_file_mode = self.large_file_support.load(Ordering::SeqCst);
        println!("Starting file upload transfer: {} ({} bytes, large file mode: {})", file_name, file_data.len(), large_file_mode);

        // Open a new connection (TCP or TLS) for file transfer
        let (_transfer_read, mut transfer_write) = self.create_transfer_stream().await?;

        println!("Upload transfer connection established");

        // Calculate total transfer size
        // FILP header (24) + INFO fork header (16) + INFO fork data (0) + DATA fork header (16) + DATA fork data
        let info_fork_size: u64 = 0;
        let data_fork_size = file_data.len() as u64;
        let total_size: u64 = if large_file_mode { data_fork_size - resume_offset } else { 56 + data_fork_size - resume_offset };
        if !large_file_mode && total_size > u32::MAX as u64 {
            return Err("File is too large for this legacy server".into());
        }

        // Send file transfer handshake
        let mut handshake = Vec::with_capacity(if large_file_mode { 24 } else { 16 });
        handshake.extend_from_slice(FILE_TRANSFER_ID); // "HTXF"
        handshake.extend_from_slice(&reference_number.to_be_bytes());

        if large_file_mode && total_size > u32::MAX as u64 {
            // Large file: legacy field = 0, set SIZE64 flag, append 8-byte length
            handshake.extend_from_slice(&0u32.to_be_bytes());
            let flags = HTXF_FLAG_LARGE_FILE | HTXF_FLAG_SIZE64 | if resume_digest.is_some() { HTXF_FLAG_RESUME } else { 0 };
            handshake.extend_from_slice(&flags.to_be_bytes());
            handshake.extend_from_slice(&total_size.to_be_bytes());
        } else if large_file_mode {
            // Large file mode but fits in 32 bits
            handshake.extend_from_slice(&(total_size as u32).to_be_bytes());
            let flags = HTXF_FLAG_LARGE_FILE | if resume_digest.is_some() { HTXF_FLAG_RESUME } else { 0 };
            handshake.extend_from_slice(&flags.to_be_bytes());
        } else {
            // Legacy mode
            handshake.extend_from_slice(&(total_size as u32).to_be_bytes());
            handshake.extend_from_slice(&0u32.to_be_bytes());
        }

        if let Some(digest) = resume_digest { handshake.extend_from_slice(&digest); }

        println!("Sending upload handshake ({} bytes): {:02X?}", handshake.len(), &handshake);
        transfer_write
            .write_all(&handshake)
            .await
            .map_err(|e| format!("Failed to send upload handshake: {}", e))?;

        transfer_write
            .flush()
            .await
            .map_err(|e| format!("Failed to flush handshake: {}", e))?;

        // Wrap in AEAD if active (handshake was plaintext, AEAD starts now)
        let mut transfer_write: TransferWriter = if let Some(key) = self.derive_transfer_key(reference_number).await {
            println!("[HOPE-AEAD-FT] Wrapping upload in AEAD framing");
            TransferWriter::Aead(HopeAeadStreamWriter::new(transfer_write, &key))
        } else {
            TransferWriter::Plain(transfer_write)
        };

        println!("Upload handshake sent");

        if !large_file_mode {
        // Legacy uploads carry a FILP wrapper; negotiated large-file uploads are raw.
        let mut filp_header = Vec::with_capacity(24);
        filp_header.extend_from_slice(b"FILP");
        filp_header.extend_from_slice(&1u16.to_be_bytes());
        filp_header.extend_from_slice(&[0u8; 16]);
        filp_header.extend_from_slice(&2u16.to_be_bytes()); // INFO + DATA

        transfer_write
            .write_all(&filp_header)
            .await
            .map_err(|e| format!("Failed to send FILP header: {}", e))?;

        // Build fork headers based on mode
        // Large file mode: type (4) + high32 (4) + compression (4) + low32 (4)
        // Legacy mode:     type (4) + compression (4) + reserved (4) + size (4)
        let build_fork_header = |fork_type: &[u8; 4], size: u64| -> Vec<u8> {
            let mut hdr = Vec::with_capacity(16);
            hdr.extend_from_slice(fork_type);
            if large_file_mode {
                hdr.extend_from_slice(&((size >> 32) as u32).to_be_bytes()); // high 32
                hdr.extend_from_slice(&0u32.to_be_bytes()); // compression
                hdr.extend_from_slice(&(size as u32).to_be_bytes()); // low 32
            } else {
                hdr.extend_from_slice(&0u32.to_be_bytes()); // compression
                hdr.extend_from_slice(&0u32.to_be_bytes()); // reserved
                hdr.extend_from_slice(&(size as u32).to_be_bytes()); // size
            }
            hdr
        };

        // INFO fork header (empty)
        let info_fork_header = build_fork_header(b"INFO", info_fork_size);
        transfer_write
            .write_all(&info_fork_header)
            .await
            .map_err(|e| format!("Failed to send INFO fork header: {}", e))?;

        // DATA fork header
        let data_fork_header = build_fork_header(b"DATA", data_fork_size - resume_offset);
        transfer_write
            .write_all(&data_fork_header)
            .await
            .map_err(|e| format!("Failed to send DATA fork header: {}", e))?;

        }

        // Send DATA fork (the actual file data) in chunks with progress tracking
        let chunk_size: u64 = 65536;
        let mut bytes_sent: u64 = resume_offset;
        progress_callback(bytes_sent, data_fork_size);
        let mut last_reported_progress: u64 = 0;

        while bytes_sent < data_fork_size {
            let remaining = data_fork_size - bytes_sent;
            let to_send = std::cmp::min(remaining, chunk_size) as usize;
            let chunk = &file_data[bytes_sent as usize..(bytes_sent as usize + to_send)];

            transfer_write
                .write_all(chunk)
                .await
                .map_err(|e| format!("Failed to send file data: {}", e))?;

            bytes_sent += to_send as u64;

            let current_progress = (bytes_sent as f64 / data_fork_size as f64 * 100.0) as u64;
            if current_progress >= last_reported_progress + 2 || bytes_sent == data_fork_size {
                progress_callback(bytes_sent, data_fork_size);
                last_reported_progress = current_progress;
            }
        }

        transfer_write
            .flush()
            .await
            .map_err(|e| format!("Failed to flush file data: {}", e))?;

        println!("File upload complete: {} bytes sent", bytes_sent);

        Ok(())
    }

    /// Delete a file or folder on the server
    pub async fn delete_file(&self, path: Vec<String>, file_name: String) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DeleteFile);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Delete failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for delete reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for delete reply".to_string())
            }
        }
    }

    /// Move a file or folder to a new location on the server
    pub async fn move_file(&self, path: Vec<String>, file_name: String, new_path: Vec<String>) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::MoveFile);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        if let Some(new_path_data) = encode_file_path(&new_path, self.encoding()) {
            transaction.add_field(TransactionField::new(FieldType::FileNewPath, new_path_data));
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Move failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for move reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for move reply".to_string())
            }
        }
    }

    /// Get file info from the server
    pub async fn get_file_info(&self, path: Vec<String>, file_name: String) -> Result<FileInfoDetails, String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetFileInfo);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => reply,
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Channel closed while waiting for file info reply".to_string());
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for file info reply".to_string());
            }
        };

        if reply.error_code != 0 {
            let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Get file info failed: {}", error_msg));
        }

        let file_name = reply.get_field(FieldType::FileName).and_then(|f| f.to_string_with(self.encoding()).ok()).unwrap_or_default();
        let file_type = reply.get_field(FieldType::FileTypeString).and_then(|f| f.to_string_with(self.encoding()).ok()).unwrap_or_default();
        let creator = reply.get_field(FieldType::FileCreatorString).and_then(|f| f.to_string_with(self.encoding()).ok()).unwrap_or_default();
        let file_size = read_extended_size(&reply, FieldType::FileSize64, FieldType::FileSize).unwrap_or(0);
        let comment = reply.get_field(FieldType::FileComment).and_then(|f| f.to_string_with(self.encoding()).ok()).unwrap_or_default();
        let create_date = reply.get_field(FieldType::FileCreateDate).and_then(|f| crate::protocol::dates::decode_date_field(&f.data));
        let modify_date = reply.get_field(FieldType::FileModifyDate).and_then(|f| crate::protocol::dates::decode_date_field(&f.data));

        Ok(FileInfoDetails {
            file_name,
            file_type,
            creator,
            file_size,
            comment,
            create_date,
            modify_date,
            modify_date_raw: reply.get_field(FieldType::FileModifyDate).and_then(|f| f.data.as_slice().try_into().ok()),
        })
    }

    /// Set file info (rename or update comment)
    pub async fn set_file_info(&self, path: Vec<String>, file_name: String, new_name: Option<String>, comment: Option<String>) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SetFileInfo);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        if let Some(name) = new_name {
            transaction.add_field(self.text_field(FieldType::FileNewName, &name));
        }

        if let Some(cmt) = comment {
            transaction.add_field(self.text_field(FieldType::FileComment, &cmt));
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Set file info failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for set file info reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for set file info reply".to_string())
            }
        }
    }

    /// Create a file alias (shortcut) on the server
    pub async fn make_file_alias(&self, path: Vec<String>, file_name: String, new_path: Vec<String>) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::MakeFileAlias);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        if let Some(new_path_data) = encode_file_path(&new_path, self.encoding()) {
            transaction.add_field(TransactionField::new(FieldType::FileNewPath, new_path_data));
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Make alias failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for make alias reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for make alias reply".to_string())
            }
        }
    }

    /// Query download queue position without starting a transfer
    pub async fn download_info(&self, reference_number: u32) -> Result<u16, String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DownloadInfo);
        transaction.add_field(TransactionField::from_u32(FieldType::ReferenceNumber, reference_number));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Download info failed: {}", error_msg));
                }
                let waiting_count = reply
                    .get_field(FieldType::WaitingCount)
                    .and_then(|f| f.to_u16().ok())
                    .unwrap_or(0);
                Ok(waiting_count)
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for download info reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for download info reply".to_string())
            }
        }
    }

    /// Download an entire folder from the server
    pub async fn download_folder(&self, path: Vec<String>, file_name: String) -> Result<(u32, u64, u64), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DownloadFolder);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(30), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Download folder failed: {}", error_msg));
                }
                let reference_number = reply
                    .get_field(FieldType::ReferenceNumber)
                    .and_then(|f| f.to_u32().ok())
                    .ok_or("No reference number in reply".to_string())?;
                let transfer_size = read_extended_size(&reply, FieldType::TransferSize64, FieldType::TransferSize)
                    .ok_or("No transfer size in reply".to_string())?;
                let item_count = read_extended_size(&reply, FieldType::FolderItemCount64, FieldType::FolderItemCount)
                    .ok_or("Missing folder item count")?;
                Ok((reference_number, transfer_size, item_count))
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for download folder reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for download folder reply".to_string())
            }
        }
    }

    /// Upload an entire folder to the server
    pub async fn upload_folder(&self, path: Vec<String>, file_name: String, item_count: u64, total_size: u64) -> Result<u32, String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::UploadFolder);
        transaction.add_field(self.text_field(FieldType::FileName, &file_name));
        transaction.add_field(TransactionField::from_u32(FieldType::TransferSize, total_size.min(u32::MAX as u64) as u32));
        if self.large_file_support.load(Ordering::SeqCst) {
            transaction.add_field(TransactionField::from_u64(FieldType::TransferSize64, total_size));
        } else if total_size > u32::MAX as u64 {
            return Err("Folder is too large for this legacy server".into());
        }
        if self.large_file_support.load(Ordering::SeqCst) {
            transaction.add_field(TransactionField::from_u64(FieldType::FolderItemCount64, item_count));
        } else if item_count > u16::MAX as u64 {
            return Err("Folder contains too many items for a legacy server".into());
        }
        transaction.add_field(TransactionField::from_u16(FieldType::FolderItemCount, item_count.min(u16::MAX as u64) as u16));

        if !path.is_empty() {
            if let Some(path_data) = encode_file_path(&path, self.encoding()) {
                transaction.add_field(TransactionField::new(FieldType::FilePath, path_data));
            }
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(30), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Upload folder failed: {}", error_msg));
                }
                let reference_number = reply
                    .get_field(FieldType::ReferenceNumber)
                    .and_then(|f| f.to_u32().ok())
                    .ok_or("No reference number in reply".to_string())?;
                Ok(reference_number)
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for upload folder reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for upload folder reply".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::protocol::types::{TextEncoding, encode_text};
    use super::HotlineClient;
    use openssl::asn1::Asn1Time;
    use openssl::bn::BigNum;
    use openssl::hash::MessageDigest;
    use openssl::nid::Nid;
    use openssl::pkey::{PKey, Private};
    use openssl::rsa::Rsa;
    use openssl::ssl::{SslAcceptor, SslMethod, SslVersion};
    use openssl::x509::{X509NameBuilder, X509};
    use std::net::TcpListener;
    use std::thread;

    fn build_self_signed_cert() -> Result<(PKey<Private>, X509), String> {
        let rsa = Rsa::generate(2048).map_err(|e| format!("rsa generate failed: {}", e))?;
        let pkey = PKey::from_rsa(rsa).map_err(|e| format!("pkey create failed: {}", e))?;

        let mut name_builder =
            X509NameBuilder::new().map_err(|e| format!("name builder failed: {}", e))?;
        name_builder
            .append_entry_by_nid(Nid::COMMONNAME, "localhost")
            .map_err(|e| format!("set CN failed: {}", e))?;
        let name = name_builder.build();

        let mut builder = X509::builder().map_err(|e| format!("x509 builder failed: {}", e))?;
        builder
            .set_version(2)
            .map_err(|e| format!("set version failed: {}", e))?;

        let mut serial = BigNum::new().map_err(|e| format!("serial bignum failed: {}", e))?;
        serial
            .rand(64, openssl::bn::MsbOption::MAYBE_ZERO, false)
            .map_err(|e| format!("serial rand failed: {}", e))?;
        let serial = serial
            .to_asn1_integer()
            .map_err(|e| format!("serial to asn1 failed: {}", e))?;
        builder
            .set_serial_number(&serial)
            .map_err(|e| format!("set serial failed: {}", e))?;

        builder
            .set_subject_name(&name)
            .map_err(|e| format!("set subject failed: {}", e))?;
        builder
            .set_issuer_name(&name)
            .map_err(|e| format!("set issuer failed: {}", e))?;
        builder
            .set_pubkey(&pkey)
            .map_err(|e| format!("set pubkey failed: {}", e))?;
        let not_before =
            Asn1Time::days_from_now(0).map_err(|e| format!("not_before failed: {}", e))?;
        builder
            .set_not_before(&not_before)
            .map_err(|e| format!("set not_before failed: {}", e))?;
        let not_after =
            Asn1Time::days_from_now(1).map_err(|e| format!("not_after failed: {}", e))?;
        builder
            .set_not_after(&not_after)
            .map_err(|e| format!("set not_after failed: {}", e))?;

        builder
            .sign(&pkey, MessageDigest::sha256())
            .map_err(|e| format!("cert sign failed: {}", e))?;

        Ok((pkey, builder.build()))
    }

    fn spawn_tls12_server() -> Result<(u16, thread::JoinHandle<Result<(), String>>), String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("bind test server failed: {}", e))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("local_addr failed: {}", e))?
            .port();

        let (pkey, cert) = build_self_signed_cert()?;

        let mut builder = SslAcceptor::mozilla_intermediate_v5(SslMethod::tls())
            .map_err(|e| format!("acceptor builder failed: {}", e))?;
        builder
            .set_private_key(&pkey)
            .map_err(|e| format!("set private key failed: {}", e))?;
        builder
            .set_certificate(&cert)
            .map_err(|e| format!("set certificate failed: {}", e))?;
        builder
            .check_private_key()
            .map_err(|e| format!("check private key failed: {}", e))?;
        builder
            .set_min_proto_version(Some(SslVersion::TLS1_2))
            .map_err(|e| format!("set min version failed: {}", e))?;
        builder
            .set_max_proto_version(Some(SslVersion::TLS1_2))
            .map_err(|e| format!("set max version failed: {}", e))?;

        let acceptor = builder.build();
        let handle = thread::spawn(move || {
            let (stream, _) = listener
                .accept()
                .map_err(|e| format!("accept failed: {}", e))?;
            let _ = acceptor
                .accept(stream)
                .map_err(|e| format!("tls accept failed: {}", e))?;
            Ok(())
        });

        Ok((port, handle))
    }

    fn test_tls_bookmark(port: u16) -> crate::protocol::types::Bookmark {
        crate::protocol::types::Bookmark {
            id: "test".to_string(),
            name: "Test".to_string(),
            address: "127.0.0.1".to_string(),
            port: port - 1,
            login: "guest".to_string(),
            password: None,
            has_password: false,
            icon: None,
            auto_connect: false,
            tls: true,
            hope: false,
            bookmark_type: Some(crate::protocol::types::BookmarkType::Server),
        }
    }

    #[tokio::test]
    async fn create_transfer_stream_uses_modern_tls_for_tls12_server() {
        let (transfer_port, server) = spawn_tls12_server().expect("failed to start tls12 server");
        let client = HotlineClient::new(test_tls_bookmark(transfer_port), true);

        let result = client.create_transfer_stream().await;
        assert!(
            result.is_ok(),
            "transfer TLS should succeed against TLS1.2-only server, got: {:?}",
            result.err()
        );

        server
            .join()
            .expect("tls12 server thread panicked")
            .expect("tls12 server failed");
    }

    // ─── Path encoding ────────────────────────────────────────────────────

    #[test]
    fn encode_file_path_exact_wire_layout() {
        // count(2) then per component: 0x00 0x00 + len(1) + bytes
        let path = vec!["abc".to_string(), "de".to_string()];
        let encoded = super::encode_file_path(&path, TextEncoding::Macintosh).expect("non-empty path");
        let expected: Vec<u8> = vec![
            0x00, 0x02, // component count
            0x00, 0x00, 0x03, b'a', b'b', b'c',
            0x00, 0x00, 0x02, b'd', b'e',
        ];
        assert_eq!(encoded, expected);
    }

    #[test]
    fn encode_file_path_empty_is_none() {
        assert_eq!(super::encode_file_path(&[], TextEncoding::Macintosh), None);
    }

    #[test]
    fn encode_file_path_truncates_components_to_255_bytes() {
        let long = "x".repeat(300);
        let encoded = super::encode_file_path(&[long], TextEncoding::Macintosh).expect("non-empty path");
        assert_eq!(&encoded[0..2], &[0x00, 0x01]); // count
        assert_eq!(encoded[4], 255); // 1-byte length capped
        assert_eq!(encoded.len(), 2 + 3 + 255);
    }

    #[test]
    fn encode_path_component_prefers_macroman() {
        // é is representable in MacRoman as 0x8E
        assert_eq!(encode_text("é", TextEncoding::Macintosh), vec![0x8E]);
        // Unmappable characters fall back to raw UTF-8
        assert_eq!(encode_text("→", TextEncoding::Utf8), "→".as_bytes().to_vec());
    }

    // ─── HTXF download / flattened FILP parsing ───────────────────────────

    use std::io::{Read, Write};

    /// Fake HTXF server: accepts one transfer connection, validates the
    /// 16-byte handshake, then streams a two-fork flattened file (an INFO
    /// fork the client must skip and a DATA fork it must return).
    fn spawn_htxf_download_server(
        payload: &'static [u8],
        reference_number: u32,
    ) -> Result<(u16, thread::JoinHandle<Result<(), String>>), String> {
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind: {}", e))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("local_addr: {}", e))?
            .port();
        let handle = thread::spawn(move || -> Result<(), String> {
            let (mut stream, _) =
                listener.accept().map_err(|e| format!("accept: {}", e))?;

            let mut handshake = [0u8; 16];
            stream
                .read_exact(&mut handshake)
                .map_err(|e| format!("read handshake: {}", e))?;
            if &handshake[0..4] != b"HTXF" {
                return Err(format!("bad transfer magic: {:?}", &handshake[0..4]));
            }
            let got_ref = u32::from_be_bytes([
                handshake[4], handshake[5], handshake[6], handshake[7],
            ]);
            if got_ref != reference_number {
                return Err(format!("wrong reference number: {}", got_ref));
            }

            let info: &[u8] = b"opaque INFO fork bytes"; // client skips these
            let mut filp = Vec::new();
            filp.extend_from_slice(b"FILP");
            filp.extend_from_slice(&1u16.to_be_bytes()); // version
            filp.extend_from_slice(&[0u8; 16]); // reserved
            filp.extend_from_slice(&2u16.to_be_bytes()); // fork count

            // INFO fork: type(4) + compression(4) + reserved(4) + size(4) + data
            filp.extend_from_slice(b"INFO");
            filp.extend_from_slice(&0u32.to_be_bytes());
            filp.extend_from_slice(&0u32.to_be_bytes());
            filp.extend_from_slice(&(info.len() as u32).to_be_bytes());
            filp.extend_from_slice(info);

            // DATA fork
            filp.extend_from_slice(b"DATA");
            filp.extend_from_slice(&0u32.to_be_bytes());
            filp.extend_from_slice(&0u32.to_be_bytes());
            filp.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            filp.extend_from_slice(payload);

            stream
                .write_all(&filp)
                .map_err(|e| format!("write FILP: {}", e))?;
            stream.flush().map_err(|e| format!("flush: {}", e))?;
            Ok(())
        });
        Ok((port, handle))
    }

    #[tokio::test]
    async fn perform_file_transfer_parses_flattened_filp_download() {
        const PAYLOAD: &[u8] = b"Hello, flattened fork format!";
        let (transfer_port, server) =
            spawn_htxf_download_server(PAYLOAD, 0xCAFE).expect("server start");
        let mut bookmark = test_tls_bookmark(transfer_port);
        bookmark.tls = false;
        let client = HotlineClient::new(bookmark, false);

        let data = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            client.perform_file_transfer(0xCAFE, PAYLOAD.len() as u64, |_, _| {}),
        )
        .await
        .expect("transfer timed out")
        .expect("transfer failed");

        assert_eq!(
            data, PAYLOAD,
            "downloaded bytes must be exactly the DATA fork payload"
        );
        server.join().expect("server thread panicked").expect("server failed");
    }
}

/// Detailed file info returned by GetFileInfo
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileInfoDetails {
    pub file_name: String,
    pub file_type: String,
    pub creator: String,
    pub file_size: u64,
    pub comment: String,
    pub create_date: Option<String>,
    pub modify_date: Option<String>,
    #[serde(skip)]
    pub modify_date_raw: Option<[u8; 8]>,
}

/// Prefer an explicitly supplied extended value, including zero. A legacy
/// folder count can be 16 or 32 bits depending on the server.
fn read_extended_size(reply: &Transaction, extended: FieldType, legacy: FieldType) -> Option<u64> {
    reply.get_field(extended).and_then(|f| f.to_u64().ok()).or_else(|| {
        reply.get_field(legacy).and_then(|f| f.to_u32().ok().map(u64::from)
            .or_else(|| f.to_u16().ok().map(u64::from)))
    })
}

#[cfg(test)]
mod extended_metadata_tests {
    use super::*;
    #[test]
    fn file_and_folder_sizes_prefer_extended_values_without_truncation() {
        for (wide, old) in [(FieldType::FileSize64, FieldType::FileSize),
            (FieldType::TransferSize64, FieldType::TransferSize),
            (FieldType::FolderItemCount64, FieldType::FolderItemCount)] {
            let mut reply = Transaction::new(1, TransactionType::GetFileInfo);
            reply.add_field(TransactionField::from_u32(old, u32::MAX));
            reply.add_field(TransactionField::from_u64(wide, 1u64 << 40));
            assert_eq!(read_extended_size(&reply, wide, old), Some(1u64 << 40));
        }
    }
    #[test]
    fn legacy_sizes_and_zero_extended_values_are_preserved() {
        let mut reply = Transaction::new(1, TransactionType::DownloadFolder);
        reply.add_field(TransactionField::from_u16(FieldType::FolderItemCount, 42));
        assert_eq!(read_extended_size(&reply, FieldType::FolderItemCount64, FieldType::FolderItemCount), Some(42));
        reply.add_field(TransactionField::from_u64(FieldType::FolderItemCount64, 0));
        assert_eq!(read_extended_size(&reply, FieldType::FolderItemCount64, FieldType::FolderItemCount), Some(0));
    }
}

#[cfg(test)]
mod upload_wire_tests {
    use super::*;
    #[tokio::test]
    async fn upload_framing_matches_negotiation_and_resume_length() {
        for (large, offset) in [(false, 0u64), (false, 2), (true, 0), (true, 2)] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut header = [0; 16];
                stream.read_exact(&mut header).await.unwrap();
                let length = u32::from_be_bytes(header[8..12].try_into().unwrap());
                let flags = u32::from_be_bytes(header[12..16].try_into().unwrap());
                assert_eq!(flags, if large { 1 | if large && offset > 0 { 4 } else { 0 } } else { 0 });
                if large && offset > 0 {
                    let mut digest = [0; 40];
                    stream.read_exact(&mut digest).await.unwrap();
                    assert_eq!(digest, [42; 40]);
                }
                let mut payload = Vec::new();
                stream.read_to_end(&mut payload).await.unwrap();
                assert_eq!(payload.len(), length as usize);
                if large { assert_eq!(&payload, &b"abcdef"[offset as usize..]); }
                else { assert_eq!(&payload[..4], b"FILP"); assert_eq!(&payload[56..], &b"abcdef"[offset as usize..]); }
            });
            let bookmark = serde_json::from_value(serde_json::json!({
                "id":"transfer-test", "name":"test", "address":"127.0.0.1", "port":port-1,
                "login":"guest", "tls":false, "hope":false, "autoConnect":false
            })).unwrap();
            let client = HotlineClient::new(bookmark, false);
            client.large_file_support.store(large, Ordering::SeqCst);
            client.perform_file_upload(1, "test", b"abcdef", offset,
                if large && offset > 0 { Some([42; 40]) } else { None }, &mut |_, _| {}).await.unwrap();
            tokio::time::timeout(Duration::from_secs(5), server).await.unwrap().unwrap();
        }
    }
}
