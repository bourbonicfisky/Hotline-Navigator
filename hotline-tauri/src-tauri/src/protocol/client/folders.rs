//! Folder transfer framing and confined filesystem paths.
use super::{HotlineClient, hope_aead::{TransferReader, TransferWriter, HopeAeadStreamReader, HopeAeadStreamWriter}};
use crate::protocol::{constants::*, types::{TextEncoding, decode_bytes, encode_text}};
use std::{path::{Path, PathBuf}, sync::atomic::Ordering, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt, AsyncSeekExt};

fn validate_component(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':')) {
        return Err("Folder transfer contains an unsafe path".into());
    }
    Ok(())
}

fn decode_path(bytes: &[u8], encoding: TextEncoding) -> Result<Vec<String>, String> {
    if bytes.len() < 2 { return Err("Truncated folder path".into()); }
    let count = u16::from_be_bytes(bytes[..2].try_into().unwrap()) as usize;
    if count == 0 || count > 128 { return Err("Invalid folder path depth".into()); }
    let mut offset = 2;
    let mut result = Vec::new();
    for _ in 0..count {
        if offset + 3 > bytes.len() { return Err("Truncated folder path".into()); }
        let len = bytes[offset + 2] as usize;
        offset += 3;
        if offset + len > bytes.len() { return Err("Truncated folder name".into()); }
        let name = decode_bytes(&bytes[offset..offset + len], encoding);
        validate_component(&name)?;
        result.push(name);
        offset += len;
    }
    if offset != bytes.len() { return Err("Unexpected folder path bytes".into()); }
    Ok(result)
}

async fn exact(reader: &mut TransferReader, bytes: &mut [u8]) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(60), reader.read_exact(bytes)).await
        .map_err(|_| "Folder transfer stalled".to_string())?.map_err(|e| e.to_string())
}

async fn confined_parent(root: &Path, components: &[String]) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for part in components {
        validate_component(part)?;
        path.push(part);
        match tokio::fs::create_dir(&path).await {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let meta = tokio::fs::symlink_metadata(&path).await.map_err(|e| e.to_string())?;
                if !meta.is_dir() || meta.is_symlink() { return Err("Folder path is not a regular directory".into()); }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(path)
}

impl HotlineClient {
    async fn folder_stream(&self, reference: u32) -> Result<(TransferReader, TransferWriter), String> {
        let (read, mut write) = self.create_transfer_stream().await?;
        let mut header = b"HTXF".to_vec();
        header.extend_from_slice(&reference.to_be_bytes());
        header.extend_from_slice(&0u32.to_be_bytes());
        let flags = if self.large_file_support.load(Ordering::SeqCst) { HTXF_FLAG_LARGE_FILE } else { 0 };
        header.extend_from_slice(&flags.to_be_bytes());
        write.write_all(&header).await.map_err(|e| e.to_string())?;
        write.flush().await.map_err(|e| e.to_string())?;
        Ok(if let Some(key) = self.derive_transfer_key(reference).await {
            (TransferReader::Aead(HopeAeadStreamReader::new(read, &key)), TransferWriter::Aead(HopeAeadStreamWriter::new(write, &key)))
        } else { (TransferReader::Plain(read), TransferWriter::Plain(write)) })
    }

    pub async fn receive_folder<F: FnMut(u64, u64) + Send>(&self, reference: u32, count: u64, root: &Path, mut progress: F) -> Result<(), String> {
        if count > 100_000 { return Err("Folder has too many entries".into()); }
        let (mut read, mut write) = self.folder_stream(reference).await?;
        for index in 0..count {
            let mut size = [0; 2];
            exact(&mut read, &mut size).await?;
            let size = u16::from_be_bytes(size) as usize;
            if size < 4 { return Err("Invalid folder entry header".into()); }
            let mut header = vec![0; size];
            exact(&mut read, &mut header).await?;
            let kind = u16::from_be_bytes(header[..2].try_into().unwrap());
            let parts = decode_path(&header[2..], self.encoding())?;
            if kind == 1 {
                confined_parent(root, &parts).await?;
            } else if kind == 0 {
                let parent = confined_parent(root, &parts[..parts.len()-1]).await?;
                let path = parent.join(parts.last().unwrap());
                let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.map_err(|e| e.to_string())?;
                write.write_all(&1u16.to_be_bytes()).await.map_err(|e| e.to_string())?;
                write.flush().await.map_err(|e| e.to_string())?;
                let mut transfer_size = [0; 4];
                exact(&mut read, &mut transfer_size).await?;
                let result = super::transfer_io::receive_file(&mut read, &mut file,
                    self.large_file_support.load(Ordering::SeqCst), None, false, Some(u32::from_be_bytes(transfer_size) as u64), |_| {}).await;
                if let Err(e) = result {
                    drop(file);
                    let _ = tokio::fs::remove_file(&path).await;
                    return Err(e);
                }
                file.sync_all().await.map_err(|e| e.to_string())?;
            } else { return Err("Unknown folder entry type".into()); }
            progress(index + 1, count);
        }
        Ok(())
    }

    pub async fn send_folder<F: FnMut(u64, u64) + Send>(&self, remote: Vec<String>, root: PathBuf, mut progress: F) -> Result<(), String> {
        let scan_root = root.clone();
        let entries = tokio::task::spawn_blocking(move || scan_folder(&scan_root)).await.map_err(|e| e.to_string())??;
        let name = root.file_name().and_then(|s| s.to_str()).ok_or("Invalid folder name")?.to_string();
        let total_size = entries.iter().try_fold(0u64, |sum, (parts, is_dir, size)| {
            let path_size: u64 = parts.iter().map(|p| 2 + encode_text(p, self.encoding()).len() as u64).sum();
            sum.checked_add(6 + path_size + if *is_dir { 0 } else { 60 + size }).ok_or("Folder transfer size overflow")
        })?;
        let reference = self.upload_folder(remote, name, entries.len() as u64, total_size).await?;
        let (mut read, mut write) = self.folder_stream(reference).await?;
        for (index, (relative, is_dir, size)) in entries.iter().enumerate() {
            let mut header = Vec::new();
            header.extend_from_slice(&(if *is_dir { 1u16 } else { 0 }).to_be_bytes());
            header.extend_from_slice(&(relative.len() as u16).to_be_bytes());
            for part in relative {
                let bytes = encode_text(part, self.encoding());
                if bytes.len() > u16::MAX as usize { return Err("Folder name is too long".into()); }
                header.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
                header.extend_from_slice(&bytes);
            }
            let size_header = u16::try_from(header.len()).map_err(|_| "Folder path is too long")?;
            write.write_all(&size_header.to_be_bytes()).await.map_err(|e| e.to_string())?;
            write.write_all(&header).await.map_err(|e| e.to_string())?;
            write.flush().await.map_err(|e| e.to_string())?;
            if !is_dir {
                let mut action = [0; 2];
                exact(&mut read, &mut action).await?;
                match u16::from_be_bytes(action) {
                    action @ (1 | 2) => {
                        let offset = if action == 2 {
                            let mut length = [0; 2];
                            exact(&mut read, &mut length).await?;
                            let mut data = vec![0; u16::from_be_bytes(length) as usize];
                            exact(&mut read, &mut data).await?;
                            super::transfer_io::legacy_resume_offset(&data)?
                        } else { 0 };
                        let remaining_size = size.checked_sub(offset).ok_or("Server resume offset exceeds local file size")?;
                        let wire_size = u32::try_from(remaining_size + 56).map_err(|_| "File is too large for folder framing; upload it individually")?;
                        write.write_all(&wire_size.to_be_bytes()).await.map_err(|e| e.to_string())?;
                        let mut filp = b"FILP\0\x01".to_vec();
                        filp.extend_from_slice(&[0; 16]);
                        filp.extend_from_slice(&2u16.to_be_bytes());
                        filp.extend_from_slice(b"INFO");
                        filp.extend_from_slice(&[0; 12]);
                        filp.extend_from_slice(b"DATA");
                        filp.extend_from_slice(&[0; 8]);
                        filp.extend_from_slice(&(remaining_size as u32).to_be_bytes());
                        write.write_all(&filp).await.map_err(|e| e.to_string())?;
                        let path = relative.iter().fold(root.clone(), |p, c| p.join(c));
                        let metadata = tokio::fs::symlink_metadata(&path).await.map_err(|e| e.to_string())?;
                        if !metadata.is_file() || metadata.len() != *size { return Err("A file changed during the folder upload".into()); }
                        let mut file = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
                        file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| e.to_string())?;
                        let mut remaining = remaining_size;
                        let mut buffer = [0; 65536];
                        while remaining > 0 {
                            let len = remaining.min(buffer.len() as u64) as usize;
                            file.read_exact(&mut buffer[..len]).await.map_err(|e| e.to_string())?;
                            write.write_all(&buffer[..len]).await.map_err(|e| e.to_string())?;
                            remaining -= len as u64;
                        }
                        write.flush().await.map_err(|e| e.to_string())?;
                    }
                    3 => (),
                    _ => return Err("Unknown folder upload action".into()),
                }
            }
            progress(index as u64 + 1, entries.len() as u64);
        }
        Ok(())
    }
}

type Entry = (Vec<String>, bool, u64);
fn scan_folder(root: &Path) -> Result<Vec<Entry>, String> {
    fn walk(root: &Path, relative: Vec<String>, out: &mut Vec<Entry>) -> Result<(), String> {
        if relative.len() > 128 || out.len() > 100_000 { return Err("Folder is too large or deeply nested".into()); }
        let path = relative.iter().fold(root.to_path_buf(), |p, c| p.join(c));
        let mut children = std::fs::read_dir(path).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        children.sort_by_key(|e| e.file_name());
        for child in children {
            if out.len() >= 100_000 { return Err("Folder has too many entries".into()); }
            let name = child.file_name().into_string().map_err(|_| "Filename is not valid Unicode")?;
            validate_component(&name)?;
            let mut parts = relative.clone(); parts.push(name);
            let meta = std::fs::symlink_metadata(child.path()).map_err(|e| e.to_string())?;
            if meta.is_symlink() || (!meta.is_dir() && !meta.is_file()) { return Err("Folder uploads cannot include links or special files".into()); }
            if meta.is_file() && meta.len() > u32::MAX as u64 - 56 { return Err("File is too large for folder framing; upload it individually".into()); }
            out.push((parts.clone(), meta.is_dir(), meta.len()));
            if meta.is_dir() { walk(root, parts, out)?; }
        }
        Ok(())
    }
    let mut entries = Vec::new();
    walk(root, Vec::new(), &mut entries)?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn folder_download_streams_directories_and_files() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut handshake = [0; 16];
            stream.read_exact(&mut handshake).await.unwrap();
            assert_eq!(&handshake[..4], b"HTXF");
            for (kind, parts) in [(1u16, vec!["sub".to_string()]), (0, vec!["sub".to_string(), "café.txt".to_string()])] {
                let path = crate::protocol::transaction::TransactionField::from_path_with(FieldType::FilePath, &parts, TextEncoding::Utf8).data;
                stream.write_all(&((path.len() + 2) as u16).to_be_bytes()).await.unwrap();
                stream.write_all(&kind.to_be_bytes()).await.unwrap();
                stream.write_all(&path).await.unwrap();
                if kind == 0 {
                    let mut action = [0; 2];
                    stream.read_exact(&mut action).await.unwrap();
                    assert_eq!(action, [0, 1]);
                    stream.write_all(&45u32.to_be_bytes()).await.unwrap();
                    let mut object = b"FILP\0\x01".to_vec();
                    object.extend_from_slice(&[0; 16]);
                    object.extend_from_slice(&1u16.to_be_bytes());
                    object.extend_from_slice(b"DATA");
                    object.extend_from_slice(&[0; 8]);
                    object.extend_from_slice(&5u32.to_be_bytes());
                    object.extend_from_slice(b"hello");
                    stream.write_all(&object).await.unwrap();
                }
            }
        });
        let bookmark = serde_json::from_value(serde_json::json!({
            "id":"folder-test", "name":"test", "address":"127.0.0.1", "port":port-1,
            "login":"guest", "tls":false, "hope":false, "autoConnect":false
        })).unwrap();
        let client = HotlineClient::new(bookmark, false);
        client.utf8_text.store(true, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("hotline-folder-test-{}-{}", std::process::id(), port));
        tokio::fs::create_dir(&root).await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), client.receive_folder(1, 2, &root, |_, _| {})).await.unwrap();
        let bytes = tokio::fs::read(root.join("sub/café.txt")).await;
        tokio::fs::remove_dir_all(&root).await.unwrap();
        result.unwrap();
        assert_eq!(bytes.unwrap(), b"hello");
        server.await.unwrap();
    }

    #[test]
    fn folder_paths_reject_escape_components() {
        for name in ["", ".", "..", "../other", "a/b", "a\\b", "C:", "a\0b"] {
            assert!(validate_component(name).is_err());
        }
        assert!(validate_component("日本語").is_ok());
        let path = crate::protocol::transaction::TransactionField::from_path_with(FieldType::FilePath,
            &["café".into(), "日本語".into()], TextEncoding::Utf8);
        assert_eq!(decode_path(&path.data, TextEncoding::Utf8).unwrap(), ["café", "日本語"]);
        assert!(decode_path(&path.data[..path.data.len()-1], TextEncoding::Utf8).is_err());
    }
}
