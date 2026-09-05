//! Bounded, streaming transfer decoding shared by single-file and folder downloads.
use super::hope_aead::TransferReader;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use std::time::Duration;

async fn read_exact(reader: &mut TransferReader, bytes: &mut [u8]) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(60), reader.read_exact(bytes)).await
        .map_err(|_| "Transfer stalled for 60 seconds".to_string())?
        .map_err(|e| format!("Incomplete transfer: {e}"))
}

/// Encode DATA-fork resume offsets. INFO and resource forks are requested anew.
pub(super) fn resume_data(offset: u64) -> Vec<u8> {
    let mut data = vec![0; 42];
    data[..4].copy_from_slice(b"RFLT");
    data[4..6].copy_from_slice(&1u16.to_be_bytes());
    data[40..42].copy_from_slice(&1u16.to_be_bytes());
    data.extend_from_slice(b"DATA");
    data.extend_from_slice(&(offset.min(u32::MAX as u64) as u32).to_be_bytes());
    data.extend_from_slice(&[0; 8]);
    data
}

async fn copy_bytes<W: AsyncWrite + Unpin, F: FnMut(u64)>(
    reader: &mut TransferReader, output: &mut W, count: u64, progress: &mut F,
) -> Result<(), String> {
    let mut remaining = count;
    let mut buffer = [0; 65536];
    while remaining > 0 {
        let n = remaining.min(buffer.len() as u64) as usize;
        // read() preserves even a short final chunk when the connection drops.
        let read = tokio::time::timeout(Duration::from_secs(60), reader.read(&mut buffer[..n])).await
            .map_err(|_| "Transfer stalled for 60 seconds".to_string())?
            .map_err(|e| format!("Transfer read failed: {e}"))?;
        if read == 0 { return Err("Connection closed before the transfer finished".into()); }
        output.write_all(&buffer[..read]).await.map_err(|e| format!("Saving download failed: {e}"))?;
        remaining -= read as u64;
        progress(count - remaining);
    }
    Ok(())
}

/// Decode a complete FILP object to DATA bytes. Other forks are consumed without
/// allocating their declared size. A known expected DATA length detects servers
/// that ignored a resume request before any bytes can be appended to the partial.
pub(super) async fn receive_file<W: AsyncWrite + Unpin, F: FnMut(u64)>(
    reader: &mut TransferReader, output: &mut W, large: bool, expected: Option<u64>,
    allow_raw: bool, wire_budget: Option<u64>, mut progress: F,
) -> Result<u64, String> {
    let mut magic = [0; 4];
    let mut got = 0;
    while got < 4 {
        let n = tokio::time::timeout(Duration::from_secs(60), reader.read(&mut magic[got..])).await
            .map_err(|_| "Transfer stalled for 60 seconds".to_string())?
            .map_err(|e| e.to_string())?;
        if n == 0 { break; }
        got += n;
    }
    let filp = got == 4 && &magic == b"FILP";
    let bare_fork = got == 4 && matches!(&magic, b"DATA" | b"INFO" | b"MACR");
    if !filp && !bare_fork {
        let size = expected.filter(|_| allow_raw).ok_or("Missing FILP header")?;
        if got as u64 > size { return Err("Raw file exceeds its advertised size".into()); }
        output.write_all(&magic[..got]).await.map_err(|e| e.to_string())?;
        copy_bytes(reader, output, size - got as u64, &mut |n| progress(got as u64 + n)).await?;
        progress(size);
        return Ok(size);
    }
    let fork_count = if filp {
        let mut header = [0; 20];
        read_exact(reader, &mut header).await?;
        if header[..2] != [0, 1] { return Err("Unsupported FILP version".into()); }
        u16::from_be_bytes([header[18], header[19]])
    } else { 1 };
    let mut wire_used = if filp { 24u64 } else { 0 };
    let mut total = 0;
    let mut found_data = false;
    for index in 0..fork_count {
        let mut header = [0; 16];
        if bare_fork && index == 0 {
            header[..4].copy_from_slice(&magic);
            read_exact(reader, &mut header[4..]).await?;
        } else { read_exact(reader, &mut header).await?; }
        let low = u32::from_be_bytes(header[12..16].try_into().unwrap()) as u64;
        let high = if large { u32::from_be_bytes(header[4..8].try_into().unwrap()) as u64 } else { 0 };
        let size = high << 32 | low;
        wire_used = wire_used.checked_add(16).and_then(|n| n.checked_add(size)).ok_or("Transfer size overflow")?;
        if wire_budget.is_some_and(|limit| wire_used > limit) { return Err("Folder file exceeds its transfer size".into()); }
        let compression = if large { &header[8..12] } else { &header[4..8] };
        if compression != [0; 4] { return Err("Compressed file forks are unsupported".into()); }
        if &header[..4] == b"DATA" {
            if found_data { return Err("Duplicate DATA fork".into()); }
            if expected.is_some_and(|n| n != size) {
                return Err("Server sent an unexpected file size; it may not support resume".into());
            }
            found_data = true;
            copy_bytes(reader, output, size, &mut progress).await?;
            total = size;
        } else {
            // Consume metadata/resource bytes with a fixed buffer, never a size-based allocation.
            copy_bytes(reader, &mut tokio::io::sink(), size, &mut |_| {}).await?;
        }
    }
    if wire_budget.is_some_and(|limit| wire_used != limit) { return Err("Folder transfer size mismatch".into()); }
    if !found_data { return Err("Transfer has no DATA fork".into()); }
    progress(total);
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn filp(data: &[u8], declared: u32) -> Vec<u8> {
        let mut result = b"FILP\0\x01".to_vec();
        result.extend_from_slice(&[0; 16]);
        result.extend_from_slice(&1u16.to_be_bytes());
        result.extend_from_slice(b"DATA");
        result.extend_from_slice(&[0; 8]);
        result.extend_from_slice(&declared.to_be_bytes());
        result.extend_from_slice(data);
        result
    }
    #[tokio::test]
    async fn empty_and_short_files_are_exact() {
        for bytes in [vec![], vec![1], vec![1, 2, 3], vec![1; 100]] {
            for raw in [false, true] {
                let wire = if raw { bytes.clone() } else { filp(&bytes, bytes.len() as u32) };
                let mut reader = TransferReader::Plain(Box::new(std::io::Cursor::new(wire)));
                let mut output = Vec::new();
                receive_file(&mut reader, &mut output, false, Some(bytes.len() as u64), true, None, |_| {}).await.unwrap();
                assert_eq!(output, bytes);
            }
        }
    }
    #[tokio::test]
    async fn failure_preserves_partial_bytes_and_rejects_ignored_resume() {
        let mut reader = TransferReader::Plain(Box::new(std::io::Cursor::new(filp(b"abc", 10))));
        let mut output = Vec::new();
        assert!(receive_file(&mut reader, &mut output, false, Some(10), false, None, |_| {}).await.is_err());
        assert_eq!(output, b"abc");
        let mut reader = TransferReader::Plain(Box::new(std::io::Cursor::new(filp(b"abcdefghij", 10))));
        assert!(receive_file(&mut reader, &mut output, false, Some(7), false, None, |_| {}).await.is_err());
        assert_eq!(output, b"abc");
    }
    #[test]
    fn resume_wire_layout_clamps_legacy_offset() {
        let data = resume_data(u32::MAX as u64 + 42);
        assert_eq!(data.len(), 58);
        assert_eq!(&data[..6], b"RFLT\0\x01");
        assert_eq!(&data[40..48], b"\0\x01DATA\xff\xff");
        assert_eq!(&data[46..50], &u32::MAX.to_be_bytes());
    }
}

/// Validate a server's large-upload digest before allowing append mode.
pub(super) fn verified_upload_resume(data: &[u8], offset: u64, digest: &[u8]) -> Option<[u8; 40]> {
    use sha2::{Digest, Sha256};
    let offset_usize = usize::try_from(offset).ok()?;
    if offset == 0 || offset_usize > data.len() || digest.len() != 40 { return None; }
    let window = offset.min(65536);
    if u64::from_be_bytes(digest[..8].try_into().ok()?) != window { return None; }
    let mut hash = Sha256::new();
    hash.update(offset.to_be_bytes());
    hash.update(&data[offset_usize - window as usize..offset_usize]);
    if hash.finalize().as_slice() != &digest[8..] { return None; }
    digest.try_into().ok()
}

pub(super) fn legacy_resume_offset(data: &[u8]) -> Result<u64, String> {
    if data.len() < 42 || &data[..6] != b"RFLT\0\x01" { return Err("Invalid folder resume data".into()); }
    let count = u16::from_be_bytes(data[40..42].try_into().unwrap()) as usize;
    if data.len() != 42 + count * 16 { return Err("Truncated folder resume data".into()); }
    let mut offset = None;
    for entry in data[42..].chunks_exact(16) {
        if &entry[..4] == b"DATA" {
            if offset.is_some() { return Err("Duplicate DATA resume entry".into()); }
            offset = Some(u32::from_be_bytes(entry[4..8].try_into().unwrap()) as u64);
        }
    }
    Ok(offset.unwrap_or(0))
}

#[cfg(test)]
mod resume_tests {
    use super::*;
    use sha2::{Digest, Sha256};
    #[test]
    fn resume_digest_is_bound_to_offset_window_and_bytes() {
        let data = vec![42; 100_000];
        let offset = 90_000u64;
        let mut digest = 65536u64.to_be_bytes().to_vec();
        let mut hash = Sha256::new();
        hash.update(offset.to_be_bytes());
        hash.update(&data[offset as usize-65536..offset as usize]);
        digest.extend_from_slice(&hash.finalize());
        assert!(verified_upload_resume(&data, offset, &digest).is_some());
        assert!(verified_upload_resume(&data, offset-1, &digest).is_none());
        assert!(verified_upload_resume(&data, 100_001, &digest).is_none());
        assert!(verified_upload_resume(&data, offset, &[]).is_none());
        let mut changed = data.clone(); changed[offset as usize-1] = 99;
        assert!(verified_upload_resume(&changed, offset, &digest).is_none());
        assert_eq!(legacy_resume_offset(&resume_data(1234)).unwrap(), 1234);
        assert!(legacy_resume_offset(b"RFLT").is_err());
    }
}
