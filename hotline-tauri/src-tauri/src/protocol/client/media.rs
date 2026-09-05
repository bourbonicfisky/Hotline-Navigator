// Inline-media extension (capability bit 3, fogWraith spec).
//
// Implements:
// - Session-scoped media-handle cache (LRU bounded by total bytes)
// - Companion-fields invariant validation on incoming chat
// - Upload state machine (single-shot ≤60 KB and chunked)
// - Download state machine (single-shot and chunked)
// - Magic-byte sanity check on received bytes

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};

use super::HotlineClient;
use crate::protocol::constants::{FieldType, TransactionType};
use crate::protocol::transaction::{Transaction, TransactionField};

/// Single-shot upload threshold. Hotline fields use 16-bit length encoding
/// (max 65,535 bytes per field). Round down to leave headroom for the rest
/// of the transaction (header, other fields).
pub const SINGLE_SHOT_THRESHOLD: usize = 60 * 1024;

/// Default cache cap (64 MB). Configurable per-instance; this is the default.
pub const DEFAULT_CACHE_CAP_BYTES: u64 = 64 * 1024 * 1024;

/// Secondary cap on number of cached handles. This keeps metadata overhead
/// bounded even if a server sends many tiny-but-distinct payloads.
pub const DEFAULT_CACHE_CAP_ENTRIES: usize = 4_096;

/// Spec recommends 30s idle timeout for chunked uploads.
pub const CHUNK_REPLY_TIMEOUT: Duration = Duration::from_secs(30);

/// Per-handle hard cap for downloaded bytes. Spec recommends 256 KB server-side;
/// we accept up to this defensive cap to bound memory if a server misbehaves.
pub const MAX_DOWNLOAD_BYTES: u64 = 4 * 1024 * 1024;

/// Server-advertised limits are bounded by local defensive ceilings. Missing
/// fields use protocol defaults; zero limits are honored (uploads disabled).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaLimits {
    pub max_bytes: u32,
    pub max_dimension: u32,
    pub max_pixels: u32,
    pub chunk_size: u32,
    pub max_frames: u32,
    pub max_duration_ms: u32,
}
impl Default for MediaLimits {
    fn default() -> Self {
        Self { max_bytes: 256 * 1024, max_dimension: 2048,
            max_pixels: 2048 * 2048, chunk_size: SINGLE_SHOT_THRESHOLD as u32,
            max_frames: 150, max_duration_ms: 15_000 }
    }
}
impl MediaLimits {
    pub fn from_reply(reply: &Transaction) -> Self {
        let d = Self::default();
        let value = |field, fallback, cap| reply.get_field(field)
            .and_then(|f| f.to_u32().ok()).unwrap_or(fallback).min(cap);
        Self {
            max_bytes: value(FieldType::ChatMediaMaxBytes, d.max_bytes, MAX_DOWNLOAD_BYTES as u32),
            max_dimension: value(FieldType::ChatMediaMaxDimension, d.max_dimension, 4096),
            max_pixels: value(FieldType::ChatMediaMaxPixels, d.max_pixels, 4096 * 4096),
            chunk_size: value(FieldType::ChatMediaChunkSize, d.chunk_size, SINGLE_SHOT_THRESHOLD as u32).max(1),
            max_frames: value(FieldType::ChatMediaMaxFrames, d.max_frames, 150),
            max_duration_ms: value(FieldType::ChatMediaMaxDurationMs, d.max_duration_ms, 15_000),
        }
    }
}

/// Inspect and decode with local memory/dimension bounds. Count animation frames
/// incrementally instead of collecting them in memory. Do not trust wire dimensions.
pub fn validate_image(bytes: &[u8], mime: &str, limits: MediaLimits) -> Result<(u32, u32), String> {
    use image::{AnimationDecoder, ImageDecoder, ImageFormat, ImageReader};
    use std::io::Cursor;
    if bytes.len() > limits.max_bytes as usize {
        return Err(format!("Image exceeds the server's {} KB limit", limits.max_bytes / 1024));
    }
    let format = match mime {
        "image/png" => ImageFormat::Png,
        "image/jpeg" | "image/jpg" => ImageFormat::Jpeg,
        "image/gif" => ImageFormat::Gif,
        _ => return Err("Choose a PNG, JPEG, or GIF image".into()),
    };
    if let Some((width, height)) = probe_dimensions(bytes, mime) {
        if width > limits.max_dimension || height > limits.max_dimension
            || u64::from(width) * u64::from(height) > u64::from(limits.max_pixels) {
            return Err("Image exceeds dimension or pixel limits; resize it before attaching".into());
        }
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut decode_limits = image::Limits::default();
    decode_limits.max_image_width = Some(limits.max_dimension);
    decode_limits.max_image_height = Some(limits.max_dimension);
    decode_limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(decode_limits.clone());
    let decoder = reader.into_decoder().map_err(|e| format!("Invalid image: {e}"))?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > u64::from(limits.max_pixels) {
        return Err("Image exceeds the server's pixel limit; resize it before attaching".into());
    }
    drop(decoder);
    if format == ImageFormat::Gif {
        let mut decoder = image::codecs::gif::GifDecoder::new(Cursor::new(bytes))
            .map_err(|e| format!("Invalid GIF: {e}"))?;
        decoder.set_limits(decode_limits).map_err(|e| e.to_string())?;
        validate_animation(decoder.into_frames(), limits)?;
    } else if format == ImageFormat::Png {
        let mut decoder = image::codecs::png::PngDecoder::new(Cursor::new(bytes))
            .map_err(|e| format!("Invalid PNG: {e}"))?;
        decoder.set_limits(decode_limits.clone()).map_err(|e| e.to_string())?;
        if decoder.is_apng().map_err(|e| e.to_string())? {
            validate_animation(decoder.apng().map_err(|e| e.to_string())?.into_frames(), limits)?;
        } else {
            image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
        }
    } else {
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        reader.limits(decode_limits);
        reader.decode().map_err(|e| format!("Invalid image: {e}"))?;
    }
    Ok((width, height))
}

fn validate_animation(frames: image::Frames<'_>, limits: MediaLimits) -> Result<(), String> {
    let started = Instant::now();
    let mut duration = 0.0;
    for (index, frame) in frames.enumerate() {
        if index >= limits.max_frames as usize || started.elapsed() > Duration::from_secs(2) {
            return Err("Animation exceeds frame or decode-time limits".into());
        }
        let frame = frame.map_err(|e| format!("Invalid animation: {e}"))?;
        let (num, den) = frame.delay().numer_denom_ms();
        duration += f64::from(num) / f64::from(den.max(1));
        if duration > f64::from(limits.max_duration_ms) {
            return Err("Animation exceeds the server's duration limit".into());
        }
    }
    Ok(())
}

async fn validate_image_async(bytes: Vec<u8>, mime: String, limits: MediaLimits) -> Result<(Vec<u8>, (u32, u32)), String> {
    tokio::task::spawn_blocking(move || {
        let dimensions = validate_image(&bytes, &mime, limits)?;
        Ok((bytes, dimensions))
    }).await.map_err(|e| format!("Image validation failed: {e}"))?
}

pub type MediaHandle = Vec<u8>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaMetadata {
    /// Hex-encoded handle for transport across IPC boundaries.
    pub handle: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "byteSize")]
    pub byte_size: u32,
}

#[derive(Debug)]
pub struct MediaEntry {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub byte_size: u32,
    pub last_accessed: Instant,
}

/// LRU-by-access-time cache bounded by total bytes.
pub struct MediaCache {
    entries: HashMap<MediaHandle, MediaEntry>,
    total_bytes: u64,
    cap_bytes: u64,
    cap_entries: usize,
}

impl MediaCache {
    pub fn new(cap_bytes: u64, cap_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            total_bytes: 0,
            cap_bytes,
            cap_entries,
        }
    }

    pub fn get(&mut self, handle: &MediaHandle) -> Option<&MediaEntry> {
        if let Some(entry) = self.entries.get_mut(handle) {
            entry.last_accessed = Instant::now();
            Some(&*entry)
        } else {
            None
        }
    }

    pub fn insert(&mut self, handle: MediaHandle, entry: MediaEntry) {
        // If replacing, subtract the old size first.
        if let Some(old) = self.entries.get(&handle) {
            self.total_bytes = self.total_bytes.saturating_sub(old.bytes.len() as u64);
        }
        self.total_bytes = self.total_bytes.saturating_add(entry.bytes.len() as u64);
        self.entries.insert(handle, entry);
        self.evict_to_cap();
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }

    pub fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    fn evict_to_cap(&mut self) {
        while self.total_bytes > self.cap_bytes || self.entries.len() > self.cap_entries {
            // Find oldest entry by last_accessed
            let oldest_handle = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.last_accessed)
                .map(|(h, _)| h.clone());
            match oldest_handle {
                Some(h) => {
                    if let Some(removed) = self.entries.remove(&h) {
                        self.total_bytes =
                            self.total_bytes.saturating_sub(removed.bytes.len() as u64);
                    }
                }
                None => break,
            }
        }
    }
}

/// Companion-fields invariant: MEDIA_ID and MEDIA_TYPE on chat transactions
/// must both be present or both absent. Returns true if valid.
pub fn validate_media_invariant(tx: &Transaction) -> bool {
    let has_id = tx.get_field(FieldType::ChatMediaId).is_some();
    let has_type = tx.get_field(FieldType::ChatMediaType).is_some();
    has_id == has_type
}

/// Extract media metadata from an incoming chat transaction. Returns Some only
/// when both companion fields are present; the parser is the gate.
pub fn extract_chat_media(tx: &Transaction) -> Option<MediaMetadata> {
    let handle_bytes = tx.get_field(FieldType::ChatMediaId)?.data.clone();
    let mime = tx.get_field(FieldType::ChatMediaType)?.to_string().ok()?;
    let width = tx
        .get_field(FieldType::ChatMediaWidth)
        .and_then(|f| f.to_u32().ok())
        .unwrap_or(0);
    let height = tx
        .get_field(FieldType::ChatMediaHeight)
        .and_then(|f| f.to_u32().ok())
        .unwrap_or(0);
    let byte_size = tx
        .get_field(FieldType::ChatMediaBytes)
        .and_then(|f| f.to_u32().ok())
        .unwrap_or(0);
    Some(MediaMetadata {
        handle: hex::encode(&handle_bytes),
        mime,
        width,
        height,
        byte_size,
    })
}

/// Decode a hex-encoded handle back to bytes.
pub fn handle_from_hex(hex_str: &str) -> Result<MediaHandle, String> {
    hex::decode(hex_str).map_err(|e| format!("Invalid handle hex: {}", e))
}

/// Magic-byte sniff. Defense-in-depth: ensure server-canonicalized bytes start
/// with the magic for the declared MIME. If mismatch, reject.
pub fn validate_magic_bytes(bytes: &[u8], mime: &str) -> Result<(), String> {
    let lower = mime.to_ascii_lowercase();
    let ok = match lower.as_str() {
        // Reject implausibly short payloads even if the first few marker bytes match.
        "image/jpeg" | "image/jpg" => bytes.len() >= 16 && bytes[..3] == [0xFF, 0xD8, 0xFF],
        "image/png" => {
            bytes.len() >= 24
                && bytes[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        }
        "image/gif" => {
            bytes.len() >= 10
                && bytes[..6] == *b"GIF87a"
                || bytes.len() >= 10 && bytes[..6] == *b"GIF89a"
        }
        _ => return Err(format!("Unsupported canonical MIME: {}", mime)),
    };
    if ok {
        Ok(())
    } else {
        Err(format!("Magic bytes do not match declared MIME: {}", mime))
    }
}

// ───── Upload ─────────────────────────────────────────────────────

pub async fn upload_media(
    client: &HotlineClient,
    bytes: Vec<u8>,
    declared_mime: String,
) -> Result<MediaMetadata, String> {
    if !client.inline_media_supported() {
        return Err("Server does not support inline media".to_string());
    }
    if !client.can_send_media() {
        return Err("Account does not have permission to send media".to_string());
    }
    if bytes.is_empty() {
        return Err("Empty payload".to_string());
    }

    let limits = *client.media_limits.read().await;
    let (bytes, _) = validate_image_async(bytes, declared_mime.clone(), limits).await?;
    if bytes.len() <= limits.chunk_size as usize {
        single_shot_upload(client, bytes, declared_mime).await
    } else {
        chunked_upload(client, bytes, declared_mime, limits.chunk_size as usize).await
    }
}

async fn single_shot_upload(
    client: &HotlineClient,
    bytes: Vec<u8>,
    declared_mime: String,
) -> Result<MediaMetadata, String> {
    let mut tx = Transaction::new(client.next_transaction_id(), TransactionType::UploadMedia);
    tx.add_field(TransactionField::new(FieldType::ChatMediaPayload, bytes));
    tx.add_field(TransactionField::from_string(
        FieldType::ChatMediaDeclaredType,
        &declared_mime,
    ));
    tx.add_field(TransactionField::from_u8(FieldType::ChatMediaPartFinal, 1));

    let reply = await_reply(client, tx, CHUNK_REPLY_TIMEOUT).await?;
    parse_upload_metadata(&reply)
}

async fn chunked_upload(
    client: &HotlineClient,
    bytes: Vec<u8>,
    declared_mime: String,
    chunk_size: usize,
) -> Result<MediaMetadata, String> {
    let chunks: Vec<&[u8]> = bytes.chunks(chunk_size).collect();
    let total = chunks.len();
    if total > u16::MAX as usize {
        return Err(format!("Image too large: {} chunks exceeds u16", total));
    }
    let total_u16 = total as u16;

    // Chunk 0: PAYLOAD, PART_COUNT, DECLARED_TYPE
    let mut first = Transaction::new(client.next_transaction_id(), TransactionType::UploadMedia);
    first.add_field(TransactionField::new(
        FieldType::ChatMediaPayload,
        chunks[0].to_vec(),
    ));
    first.add_field(TransactionField::from_string(
        FieldType::ChatMediaDeclaredType,
        &declared_mime,
    ));
    first.add_field(TransactionField::from_u16(
        FieldType::ChatMediaPartCount,
        total_u16,
    ));

    let first_reply = await_reply(client, first, CHUNK_REPLY_TIMEOUT).await?;
    let token = first_reply
        .get_field(FieldType::ChatMediaUploadToken)
        .map(|f| f.data.clone())
        .ok_or_else(|| {
            "Server did not return an upload token; chunked uploads may be unsupported".to_string()
        })?;

    // Chunks 1..total-1
    for i in 1..total {
        let mut chunk_tx =
            Transaction::new(client.next_transaction_id(), TransactionType::UploadMedia);
        chunk_tx.add_field(TransactionField::new(
            FieldType::ChatMediaUploadToken,
            token.clone(),
        ));
        chunk_tx.add_field(TransactionField::new(
            FieldType::ChatMediaPayload,
            chunks[i].to_vec(),
        ));
        chunk_tx.add_field(TransactionField::from_u16(
            FieldType::ChatMediaPartIndex,
            i as u16,
        ));
        let is_last = i == total - 1;
        if is_last {
            chunk_tx.add_field(TransactionField::from_u8(FieldType::ChatMediaPartFinal, 1));
        }

        let reply = await_reply(client, chunk_tx, CHUNK_REPLY_TIMEOUT).await?;

        if is_last {
            return parse_upload_metadata(&reply);
        }
    }

    Err("Chunked upload completed without a final reply".to_string())
}

fn parse_upload_metadata(reply: &Transaction) -> Result<MediaMetadata, String> {
    let handle_bytes = reply
        .get_field(FieldType::ChatMediaId)
        .map(|f| f.data.clone())
        .ok_or_else(|| "Upload reply missing media handle".to_string())?;
    let mime = reply
        .get_field(FieldType::ChatMediaType)
        .and_then(|f| f.to_string().ok())
        .ok_or_else(|| "Upload reply missing canonical MIME".to_string())?;
    let width = reply
        .get_field(FieldType::ChatMediaWidth)
        .and_then(|f| f.to_u32().ok())
        .unwrap_or(0);
    let height = reply
        .get_field(FieldType::ChatMediaHeight)
        .and_then(|f| f.to_u32().ok())
        .unwrap_or(0);
    let byte_size = reply
        .get_field(FieldType::ChatMediaBytes)
        .and_then(|f| f.to_u32().ok())
        .unwrap_or(0);

    Ok(MediaMetadata {
        handle: hex::encode(&handle_bytes),
        mime,
        width,
        height,
        byte_size,
    })
}

// ───── Download ───────────────────────────────────────────────────

pub async fn download_media(
    client: &HotlineClient,
    handle: MediaHandle,
) -> Result<MediaEntry, String> {
    if !client.inline_media_supported() {
        return Err("Server does not support inline media".to_string());
    }

    // Cache hit?
    {
        let mut cache = client.media_cache.lock().await;
        if let Some(entry) = cache.get(&handle) {
            return Ok(MediaEntry {
                bytes: entry.bytes.clone(),
                mime: entry.mime.clone(),
                width: entry.width,
                height: entry.height,
                byte_size: entry.byte_size,
                last_accessed: entry.last_accessed,
            });
        }
    }

    // Single-shot first request
    let mut req = Transaction::new(client.next_transaction_id(), TransactionType::DownloadMedia);
    req.add_field(TransactionField::new(
        FieldType::ChatMediaId,
        handle.clone(),
    ));
    let first_reply = await_reply(client, req, CHUNK_REPLY_TIMEOUT).await?;

    let mime = first_reply
        .get_field(FieldType::ChatMediaType)
        .and_then(|f| f.to_string().ok())
        .ok_or_else(|| "Download reply missing MIME".to_string())?;
    let total = first_reply
        .get_field(FieldType::ChatMediaPartCount)
        .and_then(|f| f.to_u16().ok())
        .unwrap_or(1);

    let mut bytes: Vec<u8> = first_reply
        .get_field(FieldType::ChatMediaPayload)
        .map(|f| f.data.clone())
        .ok_or_else(|| "Download reply missing payload".to_string())?;

    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "Download payload exceeds defensive cap of {} bytes",
            MAX_DOWNLOAD_BYTES
        ));
    }

    // Chunked: fetch remaining chunks
    if total > 1 {
        for i in 1..total {
            let mut chunk_req =
                Transaction::new(client.next_transaction_id(), TransactionType::DownloadMedia);
            chunk_req.add_field(TransactionField::new(
                FieldType::ChatMediaId,
                handle.clone(),
            ));
            chunk_req.add_field(TransactionField::from_u16(
                FieldType::ChatMediaPartIndex,
                i,
            ));
            let chunk_reply = await_reply(client, chunk_req, CHUNK_REPLY_TIMEOUT).await?;
            let chunk_payload = chunk_reply
                .get_field(FieldType::ChatMediaPayload)
                .map(|f| f.data.clone())
                .ok_or_else(|| format!("Chunk {} missing payload", i))?;
            bytes.extend_from_slice(&chunk_payload);
            if (bytes.len() as u64) > MAX_DOWNLOAD_BYTES {
                return Err(format!(
                    "Download exceeded defensive cap of {} bytes mid-stream",
                    MAX_DOWNLOAD_BYTES
                ));
            }
        }
    }

    // Magic-byte sanity check
    validate_magic_bytes(&bytes, &mime)?;

    let limits = *client.media_limits.read().await;
    let (bytes, (width, height)) = validate_image_async(bytes, mime.clone(), limits).await?;
    let byte_size = bytes.len() as u32;

    let entry = MediaEntry {
        bytes,
        mime,
        width,
        height,
        byte_size,
        last_accessed: Instant::now(),
    };

    // Insert into cache (and clone for return)
    let returned = MediaEntry {
        bytes: entry.bytes.clone(),
        mime: entry.mime.clone(),
        width: entry.width,
        height: entry.height,
        byte_size: entry.byte_size,
        last_accessed: entry.last_accessed,
    };
    {
        let mut cache = client.media_cache.lock().await;
        cache.insert(handle, entry);
    }

    Ok(returned)
}

/// Best-effort probe of intrinsic image dimensions from the magic-byte header.
/// Returns None if the format is unrecognized or the header is too short.
/// Used for an early bounds check; the full decoder still validates the image.
fn probe_dimensions(bytes: &[u8], mime: &str) -> Option<(u32, u32)> {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => {
            // PNG IHDR is at offset 16 (8 magic + 8 chunk header), 4 bytes width then 4 bytes height
            if bytes.len() < 24 {
                return None;
            }
            let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
            let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
            Some((width, height))
        }
        "image/gif" => {
            // GIF: width/height at offset 6 as little-endian u16 each
            if bytes.len() < 10 {
                return None;
            }
            let width = u16::from_le_bytes([bytes[6], bytes[7]]) as u32;
            let height = u16::from_le_bytes([bytes[8], bytes[9]]) as u32;
            Some((width, height))
        }
        "image/jpeg" | "image/jpg" => {
            // JPEG dimension probe requires walking SOF segments — skip for now.
            // Server-supplied WIDTH/HEIGHT is the primary source.
            None
        }
        _ => None,
    }
}

// ───── Reply correlation helper ───────────────────────────────────

/// Send a transaction and await its reply, registering with `pending_transactions`.
/// Returns the reply transaction or an error (timeout, error code, transport drop).
async fn await_reply(
    client: &HotlineClient,
    transaction: Transaction,
    timeout: Duration,
) -> Result<Transaction, String> {
    let id = transaction.id;
    let (tx, mut rx) = mpsc::channel(1);
    {
        let mut pending = client.pending_transactions.write().await;
        pending.insert(id, tx);
    }

    if let Err(e) = client.send_transaction(&transaction).await {
        let mut pending = client.pending_transactions.write().await;
        pending.remove(&id);
        return Err(e);
    }

    let result = match tokio::time::timeout(timeout, rx.recv()).await {
        Ok(Some(reply)) => {
            if reply.error_code != 0 {
                let server_text = reply
                    .get_field(FieldType::ErrorText)
                    .and_then(|f| f.to_string().ok())
                    .or_else(|| {
                        reply
                            .get_field(FieldType::Data)
                            .and_then(|f| f.to_string().ok())
                    });
                Err(server_text.unwrap_or_else(|| format!("error code {}", reply.error_code)))
            } else {
                Ok(reply)
            }
        }
        Ok(None) => Err("transport closed".to_string()),
        Err(_) => Err("timeout waiting for reply".to_string()),
    };

    {
        let mut pending = client.pending_transactions.write().await;
        pending.remove(&id);
    }

    result
}

// ───── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_entry(size: usize, last_accessed: Instant) -> MediaEntry {
        MediaEntry {
            bytes: vec![0u8; size],
            mime: "image/jpeg".to_string(),
            width: 100,
            height: 100,
            byte_size: size as u32,
            last_accessed,
        }
    }

    #[test]
    fn cache_inserts_and_retrieves() {
        let mut cache = MediaCache::new(1024, 16);
        let handle: MediaHandle = vec![1, 2, 3];
        cache.insert(handle.clone(), dummy_entry(100, Instant::now()));
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.total_bytes(), 100);
        assert!(cache.get(&handle).is_some());
    }

    #[test]
    fn cache_evicts_oldest_on_cap() {
        let mut cache = MediaCache::new(150, 16);
        let now = Instant::now();
        cache.insert(vec![1], dummy_entry(80, now - Duration::from_secs(10)));
        cache.insert(vec![2], dummy_entry(80, now - Duration::from_secs(5)));
        // 160 > 150 → first inserted (oldest) evicted
        assert_eq!(cache.len(), 1);
        assert!(cache.get(&vec![1]).is_none());
        assert!(cache.get(&vec![2]).is_some());
    }

    #[test]
    fn cache_get_updates_last_accessed() {
        let mut cache = MediaCache::new(10_000, 16);
        let handle: MediaHandle = vec![1];
        let original_time = Instant::now() - Duration::from_secs(60);
        cache.insert(handle.clone(), dummy_entry(100, original_time));
        let _ = cache.get(&handle);
        let updated = cache.entries.get(&handle).unwrap().last_accessed;
        assert!(updated > original_time);
    }

    #[test]
    fn cache_clear_resets_state() {
        let mut cache = MediaCache::new(10_000, 16);
        cache.insert(vec![1], dummy_entry(100, Instant::now()));
        cache.insert(vec![2], dummy_entry(200, Instant::now()));
        cache.clear();
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.total_bytes(), 0);
    }

    #[test]
    fn cache_evicts_oldest_on_entry_cap() {
        let mut cache = MediaCache::new(10_000, 2);
        let now = Instant::now();
        cache.insert(vec![1], dummy_entry(10, now - Duration::from_secs(10)));
        cache.insert(vec![2], dummy_entry(10, now - Duration::from_secs(5)));
        cache.insert(vec![3], dummy_entry(10, now));
        assert_eq!(cache.len(), 2);
        assert!(cache.get(&vec![1]).is_none());
        assert!(cache.get(&vec![2]).is_some());
        assert!(cache.get(&vec![3]).is_some());
    }

    #[test]
    fn validate_magic_jpeg() {
        let bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
        assert!(validate_magic_bytes(&bytes, "image/jpeg").is_ok());
    }

    #[test]
    fn validate_magic_png() {
        let bytes = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        ];
        assert!(validate_magic_bytes(&bytes, "image/png").is_ok());
    }

    #[test]
    fn validate_magic_gif87() {
        assert!(validate_magic_bytes(b"GIF87a\x01\x00\x01\x00", "image/gif").is_ok());
    }

    #[test]
    fn validate_magic_gif89() {
        assert!(validate_magic_bytes(b"GIF89a\x01\x00\x01\x00", "image/gif").is_ok());
    }

    #[test]
    fn validate_magic_rejects_tiny_jpeg() {
        assert!(validate_magic_bytes(&[0xFF, 0xD8, 0xFF], "image/jpeg").is_err());
    }

    #[test]
    fn validate_magic_mismatch() {
        // PNG bytes declared as JPEG
        let png_bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(validate_magic_bytes(&png_bytes, "image/jpeg").is_err());
    }

    #[test]
    fn validate_magic_unsupported_mime() {
        assert!(validate_magic_bytes(b"webp.....", "image/webp").is_err());
    }

    #[test]
    fn handle_hex_roundtrip() {
        let bytes: MediaHandle = vec![0xCA, 0xFE, 0xBA, 0xBE];
        let hex = hex::encode(&bytes);
        assert_eq!(hex, "cafebabe");
        assert_eq!(handle_from_hex(&hex).unwrap(), bytes);
    }

    #[test]
    fn handle_hex_invalid() {
        assert!(handle_from_hex("not-hex").is_err());
    }

    #[test]
    fn probe_png_dimensions() {
        // Minimal PNG with IHDR width=200 height=100
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // 8-byte magic
        // Chunk header: length(4) + type(4)
        bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x0D]); // length 13 (IHDR data)
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&200u32.to_be_bytes()); // width
        bytes.extend_from_slice(&100u32.to_be_bytes()); // height
        bytes.extend_from_slice(&[0x08, 0x06, 0x00, 0x00, 0x00]); // bit depth etc
        let probed = probe_dimensions(&bytes, "image/png").unwrap();
        assert_eq!(probed, (200, 100));
    }

    #[test]
    fn probe_gif_dimensions() {
        // GIF89a + LE width=320 height=240
        let mut bytes = b"GIF89a".to_vec();
        bytes.extend_from_slice(&320u16.to_le_bytes());
        bytes.extend_from_slice(&240u16.to_le_bytes());
        let probed = probe_dimensions(&bytes, "image/gif").unwrap();
        assert_eq!(probed, (320, 240));
    }

    fn build_chat_with_media(handle: &[u8], mime: &str) -> Transaction {
        let mut tx = Transaction::new(1, TransactionType::ChatMessage);
        tx.add_field(TransactionField::from_string(FieldType::Data, "hi"));
        tx.add_field(TransactionField::new(
            FieldType::ChatMediaId,
            handle.to_vec(),
        ));
        tx.add_field(TransactionField::from_string(
            FieldType::ChatMediaType,
            mime,
        ));
        tx
    }

    #[test]
    fn invariant_both_present() {
        let tx = build_chat_with_media(&[1, 2, 3], "image/jpeg");
        assert!(validate_media_invariant(&tx));
    }

    #[test]
    fn invariant_neither_present() {
        let mut tx = Transaction::new(1, TransactionType::ChatMessage);
        tx.add_field(TransactionField::from_string(FieldType::Data, "hi"));
        assert!(validate_media_invariant(&tx));
    }

    #[test]
    fn invariant_only_id() {
        let mut tx = Transaction::new(1, TransactionType::ChatMessage);
        tx.add_field(TransactionField::from_string(FieldType::Data, "hi"));
        tx.add_field(TransactionField::new(FieldType::ChatMediaId, vec![1, 2, 3]));
        assert!(!validate_media_invariant(&tx));
    }

    #[test]
    fn invariant_only_type() {
        let mut tx = Transaction::new(1, TransactionType::ChatMessage);
        tx.add_field(TransactionField::from_string(FieldType::Data, "hi"));
        tx.add_field(TransactionField::from_string(
            FieldType::ChatMediaType,
            "image/jpeg",
        ));
        assert!(!validate_media_invariant(&tx));
    }

    #[test]
    fn extract_metadata() {
        let mut tx = build_chat_with_media(&[0xCA, 0xFE], "image/png");
        tx.add_field(TransactionField::from_u32(FieldType::ChatMediaWidth, 1920));
        tx.add_field(TransactionField::from_u32(FieldType::ChatMediaHeight, 1080));
        tx.add_field(TransactionField::from_u32(FieldType::ChatMediaBytes, 12345));
        let meta = extract_chat_media(&tx).unwrap();
        assert_eq!(meta.handle, "cafe");
        assert_eq!(meta.mime, "image/png");
        assert_eq!(meta.width, 1920);
        assert_eq!(meta.height, 1080);
        assert_eq!(meta.byte_size, 12345);
    }

    #[test]
    fn extract_metadata_missing_fields_yields_zeros() {
        let tx = build_chat_with_media(&[0xCA, 0xFE], "image/png");
        let meta = extract_chat_media(&tx).unwrap();
        assert_eq!(meta.width, 0);
        assert_eq!(meta.height, 0);
        assert_eq!(meta.byte_size, 0);
    }
}

// Suppress unused warning on Mutex when the file is newly added; will be
// referenced from HotlineClient once wired.
#[allow(dead_code)]
type _UnusedMutex = Mutex<()>;
#[allow(dead_code)]
type _UnusedArc<T> = Arc<T>;

#[cfg(test)]
mod limits_tests {
    use super::*;
    #[test]
    fn missing_limits_default_and_advertised_limits_are_bounded() {
        let mut reply = Transaction::new(1, TransactionType::Login);
        assert_eq!(MediaLimits::from_reply(&reply).max_bytes, 256 * 1024);
        reply.add_field(TransactionField::from_u32(FieldType::ChatMediaMaxBytes, 1024));
        reply.add_field(TransactionField::from_u32(FieldType::ChatMediaChunkSize, 100));
        reply.add_field(TransactionField::from_u32(FieldType::ChatMediaMaxDimension, u32::MAX));
        let limits = MediaLimits::from_reply(&reply);
        assert_eq!(limits.max_bytes, 1024);
        assert_eq!(limits.chunk_size, 100);
        assert_eq!(limits.max_dimension, 4096);
    }
    #[test]
    fn validates_real_image_dimensions_not_server_hints() {
        let mut data = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(4, 3).write_to(&mut data, image::ImageFormat::Png).unwrap();
        let data = data.into_inner();
        assert_eq!(validate_image(&data, "image/png", MediaLimits::default()).unwrap(), (4, 3));
        let mut limits = MediaLimits::default();
        limits.max_pixels = 11;
        assert!(validate_image(&data, "image/png", limits).is_err());
        limits.max_pixels = 12;
        limits.max_dimension = 3;
        assert!(validate_image(&data, "image/png", limits).is_err());
        limits = MediaLimits::default();
        limits.max_bytes = 1;
        assert!(validate_image(&data, "image/png", limits).is_err());
    }
    #[test]
    fn animation_frame_and_duration_limits_are_enforced() {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            for _ in 0..2 {
                encoder.encode_frame(image::Frame::from_parts(image::RgbaImage::new(2, 2), 0, 0,
                    image::Delay::from_numer_denom_ms(100, 1))).unwrap();
            }
        }
        assert!(validate_image(&bytes, "image/gif", MediaLimits::default()).is_ok());
        let mut limits = MediaLimits::default();
        limits.max_frames = 1;
        assert!(validate_image(&bytes, "image/gif", limits).is_err());
        limits.max_frames = 2;
        limits.max_duration_ms = 150;
        assert!(validate_image(&bytes, "image/gif", limits).is_err());
    }
}
