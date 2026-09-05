// Tauri commands - these are callable from the frontend

use crate::protocol::types::Bookmark;
use crate::protocol::tracker::TrackerClient;
use crate::state::AppState;
use tauri::{Manager, State};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRelease {
    pub tag_name: String,
    pub display_version: String,
    pub version_number: f64,
    pub build_number: u32,
    pub notes: String,
    pub download_url: String,
    pub asset_name: String,
    pub published_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubAsset {
    browser_download_url: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub server_id: String,
    pub tls: bool,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUser {
    pub id: u16,
    pub name: String,
    pub icon: u16,
    pub flags: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinChatResult {
    pub subject: String,
    pub users: Vec<ChatUser>,
}

#[tauri::command]
pub async fn connect_to_server(
    bookmark: Bookmark,
    username: String,
    user_icon_id: u16,
    auto_detect_tls: Option<bool>,
    allow_legacy_tls: Option<bool>,
    state: State<'_, AppState>,
) -> Result<ConnectResult, String> {
    println!("Command: connect_to_server to {}:{} as {}", bookmark.address, bookmark.port, username);
    state.connect_server(bookmark, username, user_icon_id, auto_detect_tls.unwrap_or(false), allow_legacy_tls.unwrap_or(false)).await
}

#[tauri::command]
pub fn cancel_connection(
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: cancel_connection");
    state.cancel_connecting();
    Ok(())
}

#[tauri::command]
pub async fn disconnect_from_server(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: disconnect_from_server {}", server_id);
    state.disconnect_server(&server_id).await
}

#[tauri::command]
pub async fn update_user_info(
    username: String,
    icon_id: u16,
    color: Option<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.update_user_info_all_servers(&username, icon_id, color).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMediaInput {
    pub handle: String,
    pub mime: String,
}

impl From<ChatMediaInput> for crate::protocol::client::chat::ChatMediaAttachment {
    fn from(input: ChatMediaInput) -> Self {
        Self {
            handle_hex: input.handle,
            mime: input.mime,
        }
    }
}

#[tauri::command]
pub async fn send_chat_message(
    server_id: String,
    message: String,
    media: Option<ChatMediaInput>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: send_chat_message to {}: {} (media: {})", server_id, message, media.is_some());
    state.send_chat_with_media(&server_id, message, media.map(Into::into)).await
}

#[tauri::command]
pub async fn send_private_message(
    server_id: String,
    user_id: u16,
    message: String,
    media: Option<ChatMediaInput>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: send_private_message to user {} on {}: {} (media: {})", user_id, server_id, message, media.is_some());
    state.send_private_message_with_media(&server_id, user_id, message, media.map(Into::into)).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedMedia {
    /// Base64-encoded canonical bytes (Tauri IPC handles binary best as base64)
    pub bytes_base64: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn upload_media(
    server_id: String,
    bytes_base64: String,
    declared_mime: String,
    state: State<'_, AppState>,
) -> Result<crate::protocol::client::media::MediaMetadata, String> {
    let bytes = STANDARD.decode(&bytes_base64).map_err(|e| format!("Invalid base64: {}", e))?;
    state.upload_media(&server_id, bytes, declared_mime).await
}

#[tauri::command]
pub async fn download_media(
    server_id: String,
    handle: String,
    state: State<'_, AppState>,
) -> Result<DownloadedMedia, String> {
    let (bytes, mime, width, height) = state.download_media(&server_id, handle).await?;
    Ok(DownloadedMedia {
        bytes_base64: STANDARD.encode(&bytes),
        mime,
        width,
        height,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineMediaStatus {
    pub server_supports: bool,
    pub can_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limits: Option<crate::protocol::client::media::MediaLimits>,
}

#[tauri::command]
pub async fn get_inline_media_status(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<InlineMediaStatus, String> {
    let (server_supports, can_send, limits) = state.inline_media_status(&server_id).await?;
    Ok(InlineMediaStatus { server_supports, can_send, limits: Some(limits) })
}

#[tauri::command]
pub async fn set_inline_media_enabled(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.set_inline_media_enabled(enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn get_message_board(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    println!("Command: get_message_board for {}", server_id);
    state.get_message_board(&server_id).await
}

#[tauri::command]
pub async fn post_message_board(
    server_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: post_message_board to {}: {} chars", server_id, message.len());
    state.post_message_board(&server_id, message).await
}

#[tauri::command]
pub async fn get_bookmarks(state: State<'_, AppState>) -> Result<Vec<Bookmark>, String> {
    state.get_bookmarks().await
}

#[tauri::command]
pub async fn save_bookmark(
    bookmark: Bookmark,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: save_bookmark {}", bookmark.name);
    state.save_bookmark(bookmark).await
}

#[tauri::command]
pub async fn delete_bookmark(id: String, state: State<'_, AppState>) -> Result<(), String> {
    println!("Command: delete_bookmark {}", id);
    state.delete_bookmark(&id).await
}

#[tauri::command]
pub async fn reorder_bookmarks(
    bookmarks: Vec<Bookmark>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.reorder_bookmarks(bookmarks).await
}

#[tauri::command]
pub async fn add_default_bookmarks(
    state: State<'_, AppState>,
) -> Result<Vec<Bookmark>, String> {
    state.add_default_bookmarks().await
}

#[tauri::command]
pub async fn get_file_list(
    server_id: String,
    path: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: get_file_list for server {} path {:?}", server_id, path);
    state.get_file_list(&server_id, path).await
}

#[tauri::command]
pub async fn download_file(
    server_id: String,
    path: Vec<String>,
    file_name: String,
    file_size: u64,
    download_folder: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    println!("Command: download_file {} (size: {} bytes)", file_name, file_size);
    state.download_file(&server_id, path, file_name, file_size, download_folder).await
}

#[tauri::command]
pub async fn download_folder(server_id: String, path: Vec<String>, file_name: String, download_folder: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    state.download_folder(&server_id, path, file_name, download_folder).await
}

#[tauri::command]
pub async fn upload_folder(server_id: String, path: Vec<String>, state: State<'_, AppState>) -> Result<bool, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    { let _ = (server_id, path, state); Err("Folder upload is available on desktop".into()) }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let root = tokio::task::spawn_blocking(|| rfd::FileDialog::new().set_title("Choose Folder to Upload").pick_folder())
            .await.map_err(|e| e.to_string())?;
        if let Some(root) = root { state.upload_folder(&server_id, path, root).await?; Ok(true) } else { Ok(false) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    pub bytes_base64: String,
    pub mime: String,
    pub filename: String,
    pub byte_size: u32,
}

#[tauri::command]
pub async fn pick_image_for_chat() -> Result<Option<PickedImage>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Err("Image picker is not available on mobile yet".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let path = tokio::task::spawn_blocking(|| {
            rfd::FileDialog::new()
                .set_title("Choose Image to Attach")
                .add_filter("Images", &["jpg", "jpeg", "png", "gif"])
                .pick_file()
        })
        .await
        .map_err(|e| format!("Dialog error: {}", e))?;

        let path = match path {
            Some(p) => p,
            None => return Ok(None),
        };

        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Failed to read image: {}", e))?;
        let filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string());
        let mime = match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()) {
            Some(ref e) if e == "jpg" || e == "jpeg" => "image/jpeg",
            Some(ref e) if e == "png" => "image/png",
            Some(ref e) if e == "gif" => "image/gif",
            _ => "application/octet-stream",
        };
        let byte_size = bytes.len() as u32;

        Ok(Some(PickedImage {
            bytes_base64: STANDARD.encode(&bytes),
            mime: mime.to_string(),
            filename,
            byte_size,
        }))
    }
}

#[tauri::command]
pub async fn pick_download_folder() -> Result<Option<String>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Err("Download folder selection is not available on mobile".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let result = tokio::task::spawn_blocking(|| {
            rfd::FileDialog::new()
                .set_title("Choose Download Folder")
                .pick_folder()
                .map(|p| p.to_string_lossy().to_string())
        })
        .await
        .map_err(|e| format!("Dialog error: {}", e))?;
        Ok(result)
    }
}

#[tauri::command]
pub async fn upload_file(
    server_id: String,
    path: Vec<String>,
    file_name: String,
    file_data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: upload_file {} ({} bytes)", file_name, file_data.len());
    state.upload_file(&server_id, path, file_name, file_data).await
}

#[tauri::command]
pub async fn get_news_categories(
    server_id: String,
    path: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::protocol::types::NewsCategory>, String> {
    println!("Command: get_news_categories for {} path {:?}", server_id, path);
    state.get_news_categories(&server_id, path).await
}

#[tauri::command]
pub async fn get_news_articles(
    server_id: String,
    path: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::protocol::types::NewsArticle>, String> {
    println!("Command: get_news_articles for {} path {:?}", server_id, path);
    state.get_news_articles(&server_id, path).await
}

#[tauri::command]
pub async fn get_news_article_data(
    server_id: String,
    article_id: u32,
    path: Vec<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    println!("Command: get_news_article_data for {} article {} path {:?}", server_id, article_id, path);
    state.get_news_article_data(&server_id, article_id, path).await
}

#[tauri::command]
pub async fn post_news_article(
    server_id: String,
    title: String,
    text: String,
    path: Vec<String>,
    parent_id: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: post_news_article to {} path {:?}", server_id, path);
    state.post_news_article(&server_id, title, text, path, parent_id).await
}

#[tauri::command]
pub async fn send_broadcast(
    server_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: send_broadcast to {}: {}", server_id, message);
    state.send_broadcast(&server_id, message).await
}

#[tauri::command]
pub async fn create_folder(
    server_id: String,
    path: Vec<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: create_folder '{}' at path {:?} on {}", name, path, server_id);
    state.create_folder(&server_id, path, name).await
}

#[tauri::command]
pub async fn create_news_category(
    server_id: String,
    path: Vec<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: create_news_category '{}' at path {:?} on {}", name, path, server_id);
    state.create_news_category(&server_id, path, name).await
}

#[tauri::command]
pub async fn create_news_folder(
    server_id: String,
    path: Vec<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: create_news_folder '{}' at path {:?} on {}", name, path, server_id);
    state.create_news_folder(&server_id, path, name).await
}

#[tauri::command]
pub async fn delete_news_item(
    server_id: String,
    path: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: delete_news_item at path {:?} on {}", path, server_id);
    state.delete_news_item(&server_id, path).await
}

#[tauri::command]
pub async fn delete_news_article(
    server_id: String,
    path: Vec<String>,
    article_id: u32,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: delete_news_article {} at path {:?} on {}", article_id, path, server_id);
    state.delete_news_article(&server_id, path, article_id, recursive).await
}

#[tauri::command]
pub async fn get_pending_agreement(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    println!("Command: get_pending_agreement for {}", server_id);
    Ok(state.get_pending_agreement(&server_id).await)
}

#[tauri::command]
pub async fn accept_agreement(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("Command: accept_agreement for {}", server_id);
    state.accept_agreement(&server_id).await
}

#[tauri::command]
pub async fn download_banner(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    println!("Command: download_banner for {}", server_id);
    let banner_path = state.download_banner(&server_id).await?;
    
    // Read the file and convert to base64 data URL
    let file_data = std::fs::read(&banner_path)
        .map_err(|e| format!("Failed to read banner file: {}", e))?;
    
    println!("Banner file read, {} bytes", file_data.len());
    
    // Detect image format from file signature
    let mime_type = if file_data.len() >= 4 && &file_data[0..4] == [0xFF, 0xD8, 0xFF, 0xE0] {
        "image/jpeg"
    } else if file_data.len() >= 8 && &file_data[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        "image/png"
    } else if file_data.len() >= 6 && &file_data[0..6] == [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] {
        "image/gif"
    } else {
        // Check for JPEG with different header
        if file_data.len() >= 3 && &file_data[0..3] == [0xFF, 0xD8, 0xFF] {
            "image/jpeg"
        } else {
            "image/png" // Default to PNG
        }
    };
    
    println!("Detected image format: {}", mime_type);
    
    // Convert to base64 data URL
    use base64::{Engine as _, engine::general_purpose};
    let base64 = general_purpose::STANDARD.encode(&file_data);
    let data_url = format!("data:{};base64,{}", mime_type, base64);
    
    println!("Banner converted to data URL, length: {} bytes", data_url.len());
    
    Ok(data_url)
}

#[derive(serde::Serialize)]
pub struct PreviewData {
    pub mime: String,
    pub data: String,
    pub is_text: bool,
}

fn guess_mime_from_extension(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") { "image/png" }
    else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") { "image/jpeg" }
    else if lower.ends_with(".gif") { "image/gif" }
    else if lower.ends_with(".bmp") { "image/bmp" }
    else if lower.ends_with(".tif") || lower.ends_with(".tiff") { "image/tiff" }
    else if lower.ends_with(".webp") { "image/webp" }
    else if lower.ends_with(".svg") { "image/svg+xml" }
    else if lower.ends_with(".mp3") { "audio/mpeg" }
    else if lower.ends_with(".wav") { "audio/wav" }
    else if lower.ends_with(".ogg") || lower.ends_with(".oga") { "audio/ogg" }
    else if lower.ends_with(".flac") { "audio/flac" }
    else if lower.ends_with(".m4a") { "audio/mp4" }
    else if lower.ends_with(".aac") { "audio/aac" }
    else if lower.ends_with(".mp4") || lower.ends_with(".m4v") { "video/mp4" }
    else if lower.ends_with(".webm") { "video/webm" }
    else if lower.ends_with(".ogv") { "video/ogg" }
    else if lower.ends_with(".mov") { "video/quicktime" }
    else if lower.ends_with(".avi") { "video/x-msvideo" }
    else if lower.ends_with(".txt") { "text/plain" }
    else if lower.ends_with(".json") { "application/json" }
    else if lower.ends_with(".xml") { "application/xml" }
    else if lower.ends_with(".html") || lower.ends_with(".htm") { "text/html" }
    else if lower.ends_with(".css") { "text/css" }
    else if lower.ends_with(".js") { "text/javascript" }
    else { "application/octet-stream" }
}

fn detect_mime_from_content(data: &[u8]) -> Option<&'static str> {
    if data.len() < 4 {
        return None;
    }

    // Image formats
    if data.len() >= 8 && &data[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some("image/png");
    }
    if data.len() >= 3 && &data[0..3] == [0xFF, 0xD8, 0xFF] {
        return Some("image/jpeg");
    }
    if data.len() >= 6 && &data[0..6] == [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] || 
       data.len() >= 6 && &data[0..6] == [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] {
        return Some("image/gif");
    }
    if data.len() >= 2 && &data[0..2] == [0x42, 0x4D] {
        return Some("image/bmp");
    }
    if data.len() >= 4 && &data[0..4] == [0x52, 0x49, 0x46, 0x46] && 
       data.len() >= 12 && &data[8..12] == [0x57, 0x45, 0x42, 0x50] {
        return Some("image/webp");
    }

    // Audio formats
    // MP3: ID3v2 (starts with "ID3") or frame sync (0xFF 0xFB/0xFA/0xF3/0xF2)
    if data.len() >= 3 && &data[0..3] == [0x49, 0x44, 0x33] {
        return Some("audio/mpeg");
    }
    if data.len() >= 2 && data[0] == 0xFF && (data[1] & 0xE0) == 0xE0 {
        return Some("audio/mpeg");
    }
    // WAV: RIFF header with WAVE
    if data.len() >= 12 && &data[0..4] == [0x52, 0x49, 0x46, 0x46] && 
       &data[8..12] == [0x57, 0x41, 0x56, 0x45] {
        return Some("audio/wav");
    }
    // OGG: starts with "OggS"
    if data.len() >= 4 && &data[0..4] == [0x4F, 0x67, 0x67, 0x53] {
        return Some("audio/ogg");
    }
    // FLAC: starts with "fLaC"
    if data.len() >= 4 && &data[0..4] == [0x66, 0x4C, 0x61, 0x43] {
        return Some("audio/flac");
    }
    // MP4/M4A: ftyp box at offset 4
    if data.len() >= 12 && &data[4..8] == [0x66, 0x74, 0x79, 0x70] {
        // Check for audio (m4a) or video (mp4) variants
        if data.len() >= 20 {
            let brand = &data[8..12];
            if brand == b"M4A " || brand == b"mp41" || brand == b"isom" {
                // Could be audio or video, check more
                if data.len() >= 24 {
                    let brand2 = &data[20..24];
                    if brand2 == b"M4A " {
                        return Some("audio/mp4");
                    }
                }
                // Default to video/mp4 for now, extension will refine
                return Some("video/mp4");
            }
        }
        return Some("video/mp4");
    }

    // Video formats
    // WebM: starts with 0x1A 0x45 0xDF 0xA3
    if data.len() >= 4 && &data[0..4] == [0x1A, 0x45, 0xDF, 0xA3] {
        return Some("video/webm");
    }
    // QuickTime/MOV: ftyp box
    if data.len() >= 12 && &data[4..8] == [0x66, 0x74, 0x79, 0x70] {
        if data.len() >= 20 {
            let brand = &data[8..12];
            if brand == b"qt  " {
                return Some("video/quicktime");
            }
        }
    }
    // AVI: starts with "RIFF" and "AVI " at offset 8
    if data.len() >= 12 && &data[0..4] == [0x52, 0x49, 0x46, 0x46] && 
       &data[8..12] == [0x41, 0x56, 0x49, 0x20] {
        return Some("video/x-msvideo");
    }

    None
}

fn guess_mime(path: &str, data: Option<&[u8]>) -> &'static str {
    // First try to detect from file content (magic bytes)
    if let Some(data) = data {
        if let Some(mime) = detect_mime_from_content(data) {
            return mime;
        }
    }
    
    // Fall back to extension-based detection
    guess_mime_from_extension(path)
}

/// Read a downloaded file into a data payload for safe previewing (avoids asset:// CORS issues)
#[tauri::command]
pub async fn read_preview_file(path: String, app: tauri::AppHandle) -> Result<PreviewData, String> {
    use std::fs;

    // Validate the path is within allowed directories (downloads, app data)
    let canonical = fs::canonicalize(&path)
        .map_err(|e| format!("Invalid path: {}", e))?;

    let allowed_dirs: Vec<std::path::PathBuf> = [
        app.path().download_dir().ok(),
        app.path().app_data_dir().ok(),
        app.path().home_dir().ok().map(|h| h.join("Downloads")),
        app.path().document_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .collect();

    let is_allowed = allowed_dirs.iter().any(|dir| canonical.starts_with(dir));
    if !is_allowed {
        return Err("Access denied: path is outside allowed directories".to_string());
    }

    // Read file bytes first for content-based MIME detection
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    
    // Detect MIME type from content (magic bytes) first, then fall back to extension
    let mime = guess_mime(&path, Some(&bytes)).to_string();
    let is_text = mime.starts_with("text/") || 
                  mime == "application/json" || 
                  mime == "application/xml" ||
                  mime == "text/html" ||
                  mime == "text/css" ||
                  mime == "text/javascript";

    if is_text {
        // Try to read as UTF-8 text
        match String::from_utf8(bytes.clone()) {
            Ok(text) => {
                return Ok(PreviewData { mime, data: text, is_text: true });
            }
            Err(_) => {
                // If not valid UTF-8, treat as binary and base64 encode
                let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return Ok(PreviewData { mime, data: encoded, is_text: false });
            }
        }
    }

    // For binary files (images, audio, video), base64 encode
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(PreviewData { mime, data: encoded, is_text: false })
}

#[tauri::command]
pub async fn fetch_tracker_servers(
    address: String,
    port: Option<u16>,
    tls: Option<bool>,
    login: Option<String>,
    password: Option<String>,
) -> Result<Vec<crate::protocol::types::TrackerServer>, String> {
    println!("Command: fetch_tracker_servers from {}:{}", address, port.unwrap_or(5498));
    TrackerClient::fetch_servers(&address, port, tls.unwrap_or(false), login.as_deref().unwrap_or("guest"), password.as_deref().unwrap_or("")).await
}

#[tauri::command]
pub async fn get_server_info(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<crate::protocol::types::ServerInfo, String> {
    println!("Command: get_server_info for {}", server_id);
    state.get_server_info(&server_id).await
}

#[tauri::command]
pub async fn get_user_access(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    state.get_user_access(&server_id).await
}

/// Response for the get_chat_history command.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryResponse {
    pub entries: Vec<ChatHistoryEntry>,
    pub has_more: bool,
}

/// A single chat history entry serialized for the frontend.
/// message_id is a string to avoid JavaScript precision loss on u64.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryEntry {
    pub message_id: String,
    pub timestamp: i64,
    pub is_action: bool,
    pub is_server_msg: bool,
    pub is_deleted: bool,
    pub icon_id: u16,
    pub nick: String,
    pub message: String,
}

#[tauri::command]
pub async fn get_chat_history(
    server_id: String,
    before: Option<String>,
    after: Option<String>,
    limit: Option<u16>,
    state: State<'_, AppState>,
) -> Result<ChatHistoryResponse, String> {
    println!("Command: get_chat_history for {} (before={:?}, after={:?}, limit={:?})", server_id, before, after, limit);

    // Parse cursor strings to u64 (frontend sends strings to avoid precision loss)
    let before_u64 = before.as_deref()
        .map(|s| s.parse::<u64>().map_err(|e| format!("Invalid 'before' cursor: {}", e)))
        .transpose()?;
    let after_u64 = after.as_deref()
        .map(|s| s.parse::<u64>().map_err(|e| format!("Invalid 'after' cursor: {}", e)))
        .transpose()?;

    let (entries, has_more) = state.get_chat_history(&server_id, before_u64, after_u64, limit).await?;

    let response_entries = entries.into_iter().map(|e| {
        let is_action = e.is_action();
        let is_server_msg = e.is_server_msg();
        let is_deleted = e.is_deleted();
        ChatHistoryEntry {
            message_id: e.message_id,
            timestamp: e.timestamp,
            is_action,
            is_server_msg,
            is_deleted,
            icon_id: e.icon_id,
            nick: e.nick,
            message: e.message,
        }
    }).collect();

    Ok(ChatHistoryResponse {
        entries: response_entries,
        has_more,
    })
}

#[tauri::command]
pub async fn delete_file(
    server_id: String,
    path: Vec<String>,
    file_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.delete_file(&server_id, path, file_name).await
}

#[tauri::command]
pub async fn move_file(
    server_id: String,
    path: Vec<String>,
    file_name: String,
    new_path: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.move_file(&server_id, path, file_name, new_path).await
}

#[tauri::command]
pub async fn get_file_info(
    server_id: String,
    path: Vec<String>,
    file_name: String,
    state: State<'_, AppState>,
) -> Result<crate::protocol::client::files::FileInfoDetails, String> {
    state.get_file_info(&server_id, path, file_name).await
}

#[tauri::command]
pub async fn set_file_info(
    server_id: String,
    path: Vec<String>,
    file_name: String,
    new_name: Option<String>,
    comment: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.set_file_info(&server_id, path, file_name, new_name, comment).await
}

#[tauri::command]
pub async fn get_client_info(
    server_id: String,
    user_id: u16,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.get_client_info(&server_id, user_id).await
}

#[tauri::command]
pub async fn disconnect_user(
    server_id: String,
    user_id: u16,
    options: Option<u16>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.disconnect_user(&server_id, user_id, options).await
}

#[tauri::command]
pub async fn invite_to_new_chat(
    server_id: String,
    user_id: u16,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    state.invite_to_new_chat(&server_id, user_id).await
}

#[tauri::command]
pub async fn invite_to_chat(
    server_id: String,
    chat_id: u32,
    user_id: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.invite_to_chat(&server_id, chat_id, user_id).await
}

#[tauri::command]
pub async fn reject_chat_invite(
    server_id: String,
    chat_id: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.reject_chat_invite(&server_id, chat_id).await
}

#[tauri::command]
pub async fn join_chat(
    server_id: String,
    chat_id: u32,
    state: State<'_, AppState>,
) -> Result<JoinChatResult, String> {
    let (subject, users) = state.join_chat(&server_id, chat_id).await?;
    Ok(JoinChatResult {
        subject,
        users: users.into_iter().map(|(id, name, icon, flags, color)| {
            use crate::protocol::client::color_u32_to_css;
            let color = color.and_then(|c| if c == 0xFFFFFFFF { None } else { Some(color_u32_to_css(c)) });
            ChatUser { id, name, icon, flags, color }
        }).collect(),
    })
}

#[tauri::command]
pub async fn leave_chat(
    server_id: String,
    chat_id: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.leave_chat(&server_id, chat_id).await
}

#[tauri::command]
pub async fn set_chat_subject(
    server_id: String,
    chat_id: u32,
    subject: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.set_chat_subject(&server_id, chat_id, subject).await
}

#[tauri::command]
pub async fn send_private_chat(
    server_id: String,
    chat_id: u32,
    message: String,
    media: Option<ChatMediaInput>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.send_private_chat_message(&server_id, chat_id, message, media.map(Into::into)).await
}

#[tauri::command]
pub async fn test_connection(address: String, port: u16) -> Result<String, String> {
    println!("Command: test_connection to {}:{}", address, port);

    // Create a test bookmark
    let bookmark = Bookmark {
        id: "test".to_string(),
        name: "Test".to_string(),
        address,
        port,
        login: "guest".to_string(),
        password: Some("".to_string()),
        has_password: false,
        icon: Some(414),
        auto_connect: false,
        tls: false,
        hope: false,
        bookmark_type: None,
    };

    // Create client and connect
    let client = crate::protocol::HotlineClient::new(bookmark, false);
    client.connect().await?;

    Ok("Connected successfully!".to_string())
}

#[tauri::command]
pub async fn check_for_updates() -> Result<Option<UpdateRelease>, String> {
    println!("Command: check_for_updates");
    
    // GitHub releases API URL for fuzzywalrus/hotline
    let releases_url = "https://api.github.com/repos/fuzzywalrus/hotline/releases?per_page=10";
    
    // Fetch releases from GitHub
    let client = reqwest::Client::new();
    let response = client
        .get(releases_url)
        .header("User-Agent", "Hotline-Navigator")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }
    
    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {}", e))?;
    
    // Get current version from package.json (we'll pass it from frontend)
    // For now, we'll parse the first release and return it
    // The frontend will handle version comparison
    
    if releases.is_empty() {
        return Ok(None);
    }
    
    // Parse the latest release
    let latest = &releases[0];
    
    // Find platform-specific asset
    let platform_asset = latest.assets.iter()
        .find(|asset| {
            let name = asset.name.to_lowercase();

            #[cfg(target_os = "macos")]
            { name.contains(".dmg") || name.contains("macos") || name.contains("universal") || name.contains("darwin") }

            #[cfg(target_os = "windows")]
            { name.contains(".msi") || name.contains(".exe") || name.contains("windows") || name.contains("win64") }

            #[cfg(target_os = "linux")]
            { name.contains(".deb") || name.contains(".appimage") || name.contains("linux") }

            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            { false }
        });

    let platform_name = if cfg!(target_os = "macos") { "macOS" }
        else if cfg!(target_os = "windows") { "Windows" }
        else if cfg!(target_os = "linux") { "Linux" }
        else { "this platform" };

    let asset = platform_asset.ok_or(format!("No {} release asset found", platform_name))?;
    
    // Parse version from tag_name (e.g., "v0.1.0" or "0.1.0")
    let tag_name = latest.tag_name.trim_start_matches('v');
    let version_parts: Vec<&str> = tag_name.split('.').collect();
    
    let version_number = if version_parts.len() >= 2 {
        format!("{}.{}", version_parts[0], version_parts[1])
            .parse::<f64>()
            .unwrap_or(0.0)
    } else {
        0.0
    };
    
    let build_number = if version_parts.len() >= 3 {
        version_parts[2].parse::<u32>().unwrap_or(0)
    } else {
        0
    };
    
    let display_version = tag_name.to_string();
    
    Ok(Some(UpdateRelease {
        tag_name: latest.tag_name.clone(),
        display_version,
        version_number,
        build_number,
        notes: latest.body.clone().unwrap_or_default(),
        download_url: asset.browser_download_url.clone(),
        asset_name: asset.name.clone(),
        published_at: latest.published_at.clone(),
    }))
}

// --- Link preview (OpenGraph) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreviewData {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImageData {
    pub bytes_base64: String,
    pub mime: String,
}

/// Check whether an IP address belongs to a private/internal range.
fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()                                      // 127.0.0.0/8
                || v4.is_private()                                // 10/8, 172.16/12, 192.168/16
                || v4.is_link_local()                             // 169.254/16
                || v4.is_broadcast()                              // 255.255.255.255
                || v4.is_multicast()
                || v4.octets()[0] == 0
                || v4.octets()[0] >= 240
                || v4.is_unspecified()                            // 0.0.0.0
                || *v4 == Ipv4Addr::new(0, 0, 0, 0)
                || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64  // 100.64/10 (CGNAT)
                || v4.octets()[0] == 192 && v4.octets()[1] == 0 && v4.octets()[2] == 0  // 192.0.0/24
        }
        IpAddr::V6(v6) => {
            v6.is_multicast() || v6.is_loopback()                                      // ::1
                || v6.is_unspecified()                            // ::
                || *v6 == Ipv6Addr::LOCALHOST
                || {
                    let segs = v6.segments();
                    (segs[0] & 0xfe00) == 0xfc00                  // fc00::/7 (ULA)
                        || ((segs[0] & 0xffc0) == 0xfe80)                    // fe80::/10 (link-local)
                        || (segs[0] == 0 && segs[1] == 0 && segs[2] == 0
                            && segs[3] == 0 && segs[4] == 0 && segs[5] == 0xffff) // ::ffff:0:0/96 (v4-mapped, check inner)
                            && is_private_ip(&IpAddr::V4(std::net::Ipv4Addr::new(
                                (segs[6] >> 8) as u8, segs[6] as u8,
                                (segs[7] >> 8) as u8, segs[7] as u8,
                            )))
                }
        }
    }
}

/// Resolve once and pin the checked addresses to this request. Redirects must
/// repeat this process; proxies are disabled because they resolve independently.
async fn public_url_response(url: &str, accept: &str) -> Result<(reqwest::Response, reqwest::Url), String> {
    let mut current = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    for _ in 0..5 {
        if !matches!(current.scheme(), "http" | "https") {
            return Err("Only HTTP and HTTPS previews are supported".into());
        }
        let host = current.host_str().ok_or("URL has no host")?;
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let port = current.port_or_known_default().ok_or("URL has no port")?;
        let addrs: Vec<std::net::SocketAddr> = tokio::time::timeout(
            std::time::Duration::from_secs(5), tokio::net::lookup_host((host, port)),
        ).await.map_err(|_| "DNS resolution timed out")?
            .map_err(|e| format!("DNS resolution failed: {e}"))?.collect();
        validate_public_addresses(&addrs)?;
        let client = pinned_preview_client(host, &addrs)?;
        let response = client.get(current.clone())
            .header("User-Agent", concat!("HotlineNavigator/", env!("CARGO_PKG_VERSION")))
            .header("Accept", accept).send().await
            .map_err(|e| format!("Request failed: {e}"))?;
        if response.status().is_redirection() {
            let location = response.headers().get("location")
                .and_then(|v| v.to_str().ok()).ok_or("Redirect has no valid location")?;
            current = current.join(location).map_err(|e| format!("Invalid redirect: {e}"))?;
            continue;
        }
        return Ok((response, current));
    }
    Err("Too many redirects".into())
}

fn validate_public_addresses(addrs: &[std::net::SocketAddr]) -> Result<(), String> {
    if addrs.is_empty() || addrs.iter().any(|addr| is_private_ip(&addr.ip())) {
        return Err("URL has no public-only destination".into());
    }
    Ok(())
}

fn pinned_preview_client(host: &str, addrs: &[std::net::SocketAddr]) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, addrs).build().map_err(|e| format!("HTTP client error: {e}"))
}

/// Read no more than the cap into memory. HTML needs only a prefix; images
/// must be complete and are rejected as soon as they exceed the cap.
async fn read_preview_body(mut response: reqwest::Response, cap: usize, prefix: bool) -> Result<Vec<u8>, String> {
    if !prefix && response.content_length().is_some_and(|len| len > cap as u64) {
        return Err("Preview exceeds download size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Read error: {e}"))? {
        let remaining = cap - bytes.len();
        if chunk.len() > remaining && !prefix {
            return Err("Preview exceeds download size limit".into());
        }
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if prefix && bytes.len() == cap { break; }
    }
    Ok(bytes)
}

fn is_supported_external_image_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
    )
}

#[tauri::command]
pub async fn fetch_link_preview(url: String) -> Result<LinkPreviewData, String> {
    let (response, final_url) = public_url_response(&url, "text/html").await?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    // Only parse HTML responses
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.contains("text/html") {
        return Ok(LinkPreviewData {
            url,
            title: None,
            description: None,
            image: None,
            site_name: None,
        });
    }

    // Read up to 64KB to find OG tags (they're in <head>)
    let bytes = read_preview_body(response, 65536, true).await?;
    let html = String::from_utf8_lossy(&bytes);

    fn extract_meta(html: &str, property: &str) -> Option<String> {
        // Match <meta property="og:X" content="..."> or <meta content="..." property="og:X">
        let prop_pattern = format!("property=\"{}\"", property);
        let name_pattern = format!("name=\"{}\"", property);

        for line in html.split('<') {
            let lower = line.to_lowercase();
            if !lower.starts_with("meta ") {
                continue;
            }
            if !lower.contains(&prop_pattern) && !lower.contains(&name_pattern) {
                continue;
            }
            // Extract content="..."
            if let Some(start) = line.find("content=\"").or_else(|| line.find("content='")) {
                let quote = line.as_bytes()[start + 8] as char;
                let val_start = start + 9;
                if let Some(end) = line[val_start..].find(quote) {
                    let value = &line[val_start..val_start + end];
                    if !value.is_empty() {
                        return Some(html_decode(value));
                    }
                }
            }
        }
        None
    }

    fn html_decode(s: &str) -> String {
        s.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&#x27;", "'")
    }

    // Also try to extract <title> as fallback
    fn extract_title(html: &str) -> Option<String> {
        let lower = html.to_lowercase();
        let start = lower.find("<title")?.checked_add(6)?;
        let after_tag = lower[start..].find('>')? + start + 1;
        let end = lower[after_tag..].find("</title")? + after_tag;
        let title = html[after_tag..end].trim();
        if title.is_empty() { None } else { Some(html_decode(title).to_string()) }
    }

    let og_title = extract_meta(&html, "og:title");
    let og_description = extract_meta(&html, "og:description");
    let og_image = extract_meta(&html, "og:image");
    let og_site_name = extract_meta(&html, "og:site_name");

    // Fallbacks
    let title = og_title.or_else(|| extract_meta(&html, "twitter:title")).or_else(|| extract_title(&html));
    let description = og_description.or_else(|| extract_meta(&html, "twitter:description")).or_else(|| extract_meta(&html, "description"));
    let image = og_image.or_else(|| extract_meta(&html, "twitter:image"))
        .and_then(|image| final_url.join(&image).ok())
        .filter(|image| matches!(image.scheme(), "http" | "https"))
        .map(|image| image.to_string());

    Ok(LinkPreviewData {
        url,
        title,
        description,
        image,
        site_name: og_site_name,
    })
}

#[tauri::command]
pub async fn fetch_external_image(url: String) -> Result<ExternalImageData, String> {
    const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

    let (response, current_url) = public_url_response(&url, "image/*").await?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    if let Some(len) = response.content_length() {
        if len as usize > MAX_IMAGE_BYTES {
            return Err("Image is larger than the 8 MB preview limit".to_string());
        }
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .map(str::trim)
        .unwrap_or("")
        .to_string();

    let bytes = read_preview_body(response, MAX_IMAGE_BYTES, false).await?;

    let detected_mime = detect_mime_from_content(&bytes)
        .or_else(|| {
            if content_type.starts_with("image/") {
                Some(content_type.as_str())
            } else {
                None
            }
        })
        .unwrap_or_else(|| guess_mime(current_url.as_str(), Some(&bytes)));

    if !is_supported_external_image_mime(detected_mime) {
        return Err(format!("Unsupported image type: {}", detected_mime));
    }

    Ok(ExternalImageData {
        bytes_base64: STANDARD.encode(&bytes),
        mime: detected_mime.to_string(),
    })
}

// --- Mnemosyne HTTP proxy (bypasses CORS) ---

#[tauri::command]
pub async fn mnemosyne_fetch(url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status().as_u16();
    if status == 429 {
        return Err("Rate limit exceeded. Please wait a moment before trying again.".into());
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid JSON response: {e}"))?;

    if status >= 400 {
        if let Some(msg) = body.pointer("/error/message").and_then(|v| v.as_str()) {
            return Err(msg.to_string());
        }
        return Err(format!("HTTP {status}"));
    }

    Ok(body)
}

#[tauri::command]
pub fn bookmark_vault_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "protectedExists": dir.join("bookmark-passwords-v2.hold").try_exists().map_err(|e| e.to_string())?,
        "legacyExists": dir.join("bookmark-passwords.hold").try_exists().map_err(|e| e.to_string())?,
    }))
}

#[tauri::command]
pub fn finish_bookmark_vault_migration(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if !dir.join("bookmark-passwords-v2.hold").is_file() {
        return Err("Protected password vault has not been saved".into());
    }
    match std::fs::remove_file(dir.join("bookmark-passwords.hold")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove legacy password vault: {e}")),
    }
}

#[cfg(test)]
mod preview_security_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn rejects_private_mixed_and_mapped_destinations() {
        for ip in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "0.1.2.3", "::1", "::ffff:127.0.0.1", "febf::1", "fc00::1"] {
            let addr = std::net::SocketAddr::new(ip.parse().unwrap(), 80);
            assert!(validate_public_addresses(&["8.8.8.8:80".parse().unwrap(), addr]).is_err(), "{ip}");
        }
        assert!(validate_public_addresses(&[]).is_err());
        assert!(validate_public_addresses(&["8.8.8.8:80".parse().unwrap()]).is_ok());
    }

    // Local fixture deliberately bypasses address validation to exercise the
    // production pinning and streaming code without touching public services.
    async fn fixture() -> reqwest::Response {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).await.unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n8\r\nabcdefgh\r\n8\r\nijklmnop\r\n0\r\n\r\n").await.unwrap();
        });
        // This hostname has no DNS record; success proves the supplied address
        // is used while the original hostname remains in the URL.
        pinned_preview_client("pinned.invalid", &[addr]).unwrap()
            .get(format!("http://pinned.invalid:{}/", addr.port())).send().await.unwrap()
    }

    #[tokio::test]
    async fn enforces_cap_without_content_length() {
        assert!(read_preview_body(fixture().await, 10, false).await.is_err());
        assert_eq!(read_preview_body(fixture().await, 10, true).await.unwrap(), b"abcdefghij");
        assert_eq!(read_preview_body(fixture().await, 16, false).await.unwrap(), b"abcdefghijklmnop");
    }

    #[tokio::test]
    async fn rejects_private_urls_and_schemes_before_connecting() {
        assert!(public_url_response("http://127.0.0.1:1/", "image/*").await.is_err());
        assert!(public_url_response("file:///etc/passwd", "image/*").await.is_err());
    }
}

#[tauri::command]
pub async fn discover_server(address: String, port: u16) -> Result<crate::protocol::discovery::Descriptor, String> {
    crate::protocol::discovery::discover(&address, port).await
}
