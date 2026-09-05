mod downloads;

// Application state management

use crate::protocol::{types::Bookmark, HotlineClient};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

pub struct AppState {
    clients: Arc<RwLock<HashMap<String, HotlineClient>>>,
    bookmarks: Arc<RwLock<Vec<Bookmark>>>,
    bookmarks_path: PathBuf,
    app_handle: AppHandle,
    pending_agreements: Arc<RwLock<HashMap<String, String>>>, // server_id -> agreement_text
    /// Generation counter for connection attempts. Each new connect_server() call
    /// increments this. An in-flight connection checks if its generation still matches;
    /// if not, another connection was started and this one should abort.
    connect_generation: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf, app_handle: AppHandle) -> Self {
        // Ensure app data directory exists
        if let Err(e) = fs::create_dir_all(&app_data_dir) {
            eprintln!("Failed to create app data directory: {}", e);
        }

        let bookmarks_path = app_data_dir.join("bookmarks.json");

        // Load existing bookmarks
        let bookmarks = Self::load_bookmarks(&bookmarks_path).unwrap_or_default();

        Self {
            clients: Arc::new(RwLock::new(HashMap::new())),
            bookmarks: Arc::new(RwLock::new(bookmarks)),
            bookmarks_path,
            app_handle,
            pending_agreements: Arc::new(RwLock::new(HashMap::new())),
            connect_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    fn load_bookmarks(path: &PathBuf) -> Result<Vec<Bookmark>, String> {
        let mut bookmarks: Vec<Bookmark> = if !path.exists() {
            Vec::new()
        } else {
            let data = fs::read_to_string(path)
                .map_err(|e| format!("Failed to read bookmarks: {}", e))?;

            serde_json::from_str::<Vec<Bookmark>>(&data)
                .map_err(|e| format!("Failed to parse bookmarks: {}", e))?
        };

        use crate::protocol::constants::{DEFAULT_SERVER_PORT, DEFAULT_TLS_PORT, DEFAULT_TRACKER_PORT};
        use crate::protocol::types::BookmarkType;

        let mut needs_save = false;

        // Define default trackers: (id, name, address, port)
        let default_trackers = vec![
            ("default-tracker-hltracker", "Featured Servers", "hltracker.com", DEFAULT_TRACKER_PORT),
            ("default-tracker-mainecyber", "Maine Cyber", "tracked.mainecyber.com", DEFAULT_TRACKER_PORT),
            ("default-tracker-preterhuman", "Preterhuman", "tracker.preterhuman.net", DEFAULT_TRACKER_PORT),
        ];

        // Define default servers: (id, name, address, port, tls, hope)
        let default_servers = vec![
            ("default-server-bigredh", "Hotline Central Hub", "server.bigredh.com", DEFAULT_SERVER_PORT, false, false),
            ("default-server-system7", "System7 Today", "hotline.system7today.com", DEFAULT_SERVER_PORT, false, false),
            ("default-server-macdomain", "MacDomain", "62.116.228.143", DEFAULT_SERVER_PORT, false, false),
            ("default-server-applearchive", "Apple Media Archive & Hotline Navigator", "hotline.semihosted.xyz", DEFAULT_TLS_PORT, true, true),
        ];

        // Fix any existing default trackers that lost their type
        for bookmark in bookmarks.iter_mut() {
            for (id, name, address, port) in &default_trackers {
                if bookmark.id == *id || (bookmark.address == *address && bookmark.port == *port) {
                    if !matches!(bookmark.bookmark_type, Some(BookmarkType::Tracker)) {
                        bookmark.bookmark_type = Some(BookmarkType::Tracker);
                        bookmark.id = id.to_string();
                        bookmark.name = name.to_string();
                        needs_save = true;
                    }
                }
            }
        }
        
        // Fix any existing default servers that lost their type or need TLS/HOPE update
        for bookmark in bookmarks.iter_mut() {
            for (id, name, address, _port, tls, hope) in &default_servers {
                if bookmark.id == *id || (bookmark.address == *address) {
                    if !matches!(bookmark.bookmark_type, Some(BookmarkType::Server)) {
                        bookmark.bookmark_type = Some(BookmarkType::Server);
                        bookmark.id = id.to_string();
                        bookmark.name = name.to_string();
                        needs_save = true;
                    }
                    // Update TLS setting if it changed
                    if bookmark.tls != *tls {
                        bookmark.tls = *tls;
                        bookmark.port = if *tls { DEFAULT_TLS_PORT } else { DEFAULT_SERVER_PORT };
                        needs_save = true;
                    }
                    // Update HOPE setting if it changed
                    if bookmark.hope != *hope {
                        bookmark.hope = *hope;
                        needs_save = true;
                    }
                }
            }
        }
        
        // Only add defaults on first load (empty bookmarks file)
        if bookmarks.is_empty() {
            // Add default trackers
            for (id, name, address, port) in &default_trackers {
                let tracker = Bookmark {
                    id: id.to_string(),
                    name: name.to_string(),
                    address: address.to_string(),
                    port: *port,
                    login: "guest".to_string(),
                    password: None,
                    has_password: false,
                    icon: None,
                    auto_connect: false,
                    tls: false,
                    hope: false,
                    bookmark_type: Some(BookmarkType::Tracker),
                };
                bookmarks.push(tracker);
            }

            // Add default servers
            for (id, name, address, port, tls, hope) in &default_servers {
                let server = Bookmark {
                    id: id.to_string(),
                    name: name.to_string(),
                    address: address.to_string(),
                    port: *port,
                    login: "guest".to_string(),
                    password: None,
                    has_password: false,
                    icon: None,
                    auto_connect: false,
                    tls: *tls,
                    hope: *hope,
                    bookmark_type: Some(BookmarkType::Server),
                };
                bookmarks.push(server);
            }
            needs_save = true;
        }
        
        // Save if we made any changes
        if needs_save {
            let json = serde_json::to_string_pretty(&bookmarks)
                .map_err(|e| format!("Failed to serialize bookmarks: {}", e))?;
            fs::write(path, json)
                .map_err(|e| format!("Failed to write bookmarks: {}", e))?;
        }

        Ok(bookmarks)
    }

    fn save_bookmarks_to_disk(&self, bookmarks: &[Bookmark]) -> Result<(), String> {
        // Strip plaintext passwords before writing — passwords live in Stronghold vault
        let sanitized: Vec<Bookmark> = bookmarks.iter().map(|b| {
            let mut clean = b.clone();
            if clean.password.is_some() {
                clean.has_password = true;
                clean.password = None;
            }
            clean
        }).collect();

        let json = serde_json::to_string_pretty(&sanitized)
            .map_err(|e| format!("Failed to serialize bookmarks: {}", e))?;

        fs::write(&self.bookmarks_path, json)
            .map_err(|e| format!("Failed to write bookmarks: {}", e))?;

        Ok(())
    }

    /// Bump the connection generation, causing any in-flight connection to detect
    /// it's been superseded and abort.
    pub fn cancel_connecting(&self) {
        let gen = self.connect_generation.fetch_add(1, Ordering::SeqCst);
        println!("Cancelling in-flight connection (was generation {})", gen);
    }

    pub async fn connect_server(&self, bookmark: Bookmark, username: String, user_icon_id: u16, auto_detect_tls: bool, allow_legacy_tls: bool) -> Result<crate::commands::ConnectResult, String> {
        // Don't allow connecting to trackers - they use a different protocol
        if matches!(bookmark.bookmark_type, Some(crate::protocol::types::BookmarkType::Tracker)) {
            return Err("Cannot connect to tracker. Trackers are used to browse servers, not to connect directly.".to_string());
        }

        // Claim a new generation — any older in-flight connection will see the mismatch
        let my_generation = self.connect_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let generation_ref = Arc::clone(&self.connect_generation);

        let bookmark = bookmark;
        let server_id = bookmark.id.clone();

        // Helper to check if this connection attempt has been superseded
        let check_cancelled = || -> Result<(), String> {
            if generation_ref.load(Ordering::SeqCst) != my_generation {
                Err("Connection cancelled".to_string())
            } else {
                Ok(())
            }
        };

        // Auto-detect TLS: when enabled and the bookmark isn't already TLS, try
        // connecting directly on port+100 (the Mobius TLS convention). If TLS fails
        // or times out, fall back to plain on the original port. We intentionally
        // skip a separate probe step — probing consumed a connection slot on the
        // server and caused the real connection to be rejected.
        let (client, final_tls, final_port) = if auto_detect_tls && !bookmark.tls {
            let tls_port = bookmark.port + 100;
            println!("Auto-detect TLS: trying {}:{} (TLS)...", bookmark.address, tls_port);

            let mut tls_bookmark = bookmark.clone();
            tls_bookmark.tls = true;
            tls_bookmark.port = tls_port;

            let tls_client = HotlineClient::new(tls_bookmark, allow_legacy_tls);
            tls_client.set_user_info(username.clone(), user_icon_id).await;

            match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                tls_client.connect(),
            ).await {
                Ok(Ok(())) => {
                    check_cancelled()?;
                    println!("Auto-detect TLS: connected via TLS on port {}", tls_port);
                    (tls_client, true, tls_port)
                }
                Ok(Err(e)) => {
                    check_cancelled()?;
                    println!("Auto-detect TLS: TLS failed ({}), falling back to plain on port {}", e, bookmark.port);
                    let client = HotlineClient::new(bookmark.clone(), allow_legacy_tls);
                    client.set_user_info(username, user_icon_id).await;
                    check_cancelled()?;
                    client.connect().await?;
                    (client, false, bookmark.port)
                }
                Err(_) => {
                    check_cancelled()?;
                    println!("Auto-detect TLS: timed out, falling back to plain on port {}", bookmark.port);
                    let client = HotlineClient::new(bookmark.clone(), allow_legacy_tls);
                    client.set_user_info(username, user_icon_id).await;
                    check_cancelled()?;
                    client.connect().await?;
                    (client, false, bookmark.port)
                }
            }
        } else {
            let client = HotlineClient::new(bookmark.clone(), allow_legacy_tls);
            client.set_user_info(username, user_icon_id).await;
            check_cancelled()?;
            client.connect().await?;
            (client, bookmark.tls, bookmark.port)
        };

        check_cancelled()?;

        // Get the event receiver from the client BEFORE storing it
        // (once stored, we can't move it)
        let mut event_rx = {
            let mut rx_guard = client.event_rx.lock().await;
            rx_guard.take().ok_or("Event receiver already taken")?
        };

        // Store client in clients map BEFORE starting event loop
        // This ensures it's available when StatusChanged events fire
        {
            let mut clients = self.clients.write().await;
            clients.insert(server_id.clone(), client);
        }

        // Start event forwarding task
        let app_handle = self.app_handle.clone();
        let server_id_clone = server_id.clone();
        let state_clone = Arc::clone(&self.pending_agreements);
        let clients_clone = Arc::clone(&self.clients);
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                use crate::protocol::client::HotlineEvent;

                match event {
                    HotlineEvent::GifIconChanged { user_id } => {
                        let _ = app_handle.emit(&format!("gif-icon-changed-{}", server_id_clone), serde_json::json!({"userId": user_id}));
                    }
                    HotlineEvent::ChatMessage { user_id, user_name, message, media } => {
                        let payload = serde_json::json!({
                            "userId": user_id,
                            "userName": user_name,
                            "message": message,
                            "media": media,
                        });
                        let _ = app_handle.emit(&format!("chat-message-{}", server_id_clone), payload);
                    }
                    HotlineEvent::UserJoined { user_id, user_name, icon, flags, color } => {
                        let payload = serde_json::json!({
                            "userId": user_id,
                            "userName": user_name,
                            "iconId": icon,
                            "flags": flags,
                            "color": color,
                        });
                        let _ = app_handle.emit(&format!("user-joined-{}", server_id_clone), payload);
                    }
                    HotlineEvent::UserLeft { user_id } => {
                        let payload = serde_json::json!({
                            "userId": user_id,
                        });
                        let _ = app_handle.emit(&format!("user-left-{}", server_id_clone), payload);
                    }
                    HotlineEvent::UserChanged { user_id, user_name, icon, flags, color } => {
                        let payload = serde_json::json!({
                            "userId": user_id,
                            "userName": user_name,
                            "iconId": icon,
                            "flags": flags,
                            "color": color,
                        });
                        let _ = app_handle.emit(&format!("user-changed-{}", server_id_clone), payload);
                    }
                    HotlineEvent::DisconnectMessage(msg) => {
                        let payload = serde_json::json!({
                            "message": msg,
                        });
                        let _ = app_handle.emit(&format!("disconnect-message-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ServerMessage(msg) => {
                        println!("Server broadcast message: {}", msg);
                        let payload = serde_json::json!({
                            "message": msg,
                        });
                        let _ = app_handle.emit(&format!("broadcast-message-{}", server_id_clone), payload);
                    }
                    HotlineEvent::AgreementRequired(agreement) => {
                        println!("State: Received AgreementRequired event, agreement length: {}", agreement.len());
                        
                        // Store agreement in pending_agreements
                        {
                            let mut pending = state_clone.write().await;
                            pending.insert(server_id_clone.clone(), agreement.clone());
                            println!("State: Stored agreement for server {}", server_id_clone);
                        }
                        
                        let payload = serde_json::json!({
                            "agreement": agreement,
                        });
                        let event_name = format!("agreement-required-{}", server_id_clone);
                        println!("State: Emitting event: {}", event_name);
                        match app_handle.emit(&event_name, payload) {
                            Ok(_) => println!("State: Event emitted successfully"),
                            Err(e) => println!("State: Failed to emit event: {:?}", e),
                        }
                    }
                    HotlineEvent::FileList { files, path } => {
                        let payload = serde_json::json!({
                            "files": files.iter().map(|f| serde_json::json!({
                                "name": f.name,
                                "size": f.size,
                                "isFolder": f.is_folder,
                                "fileType": f.file_type,
                                "creator": f.creator,
                            })).collect::<Vec<_>>(),
                            "path": path,
                        });
                        let _ = app_handle.emit(&format!("file-list-{}", server_id_clone), payload);
                    }
                    HotlineEvent::NewMessageBoardPost(message) => {
                        let payload = serde_json::json!({
                            "message": message,
                        });
                        let _ = app_handle.emit(&format!("message-board-post-{}", server_id_clone), payload);
                    }
                    HotlineEvent::PrivateMessage { user_id, message, media } => {
                        let payload = serde_json::json!({
                            "userId": user_id,
                            "message": message,
                            "media": media,
                        });
                        let _ = app_handle.emit(&format!("private-message-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ChatInvite { chat_id, user_id, user_name } => {
                        let payload = serde_json::json!({
                            "chatId": chat_id,
                            "userId": user_id,
                            "userName": user_name,
                        });
                        let _ = app_handle.emit(&format!("chat-invite-{}", server_id_clone), payload);
                    }
                    HotlineEvent::PrivateChatMessage { chat_id, user_id, user_name, message, media } => {
                        let payload = serde_json::json!({
                            "chatId": chat_id,
                            "userId": user_id,
                            "userName": user_name,
                            "message": message,
                            "media": media,
                        });
                        let _ = app_handle.emit(&format!("private-chat-message-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ChatUserJoined { chat_id, user_id, user_name, icon, flags, color } => {
                        let payload = serde_json::json!({
                            "chatId": chat_id,
                            "userId": user_id,
                            "userName": user_name,
                            "icon": icon,
                            "flags": flags,
                            "color": color,
                        });
                        let _ = app_handle.emit(&format!("chat-user-joined-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ChatUserLeft { chat_id, user_id } => {
                        let payload = serde_json::json!({
                            "chatId": chat_id,
                            "userId": user_id,
                        });
                        let _ = app_handle.emit(&format!("chat-user-left-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ChatSubjectChanged { chat_id, subject } => {
                        let payload = serde_json::json!({
                            "chatId": chat_id,
                            "subject": subject,
                        });
                        let _ = app_handle.emit(&format!("chat-subject-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ServerBannerUpdate { banner_type, url } => {
                        let payload = serde_json::json!({
                            "bannerType": banner_type,
                            "url": url,
                        });
                        let _ = app_handle.emit(&format!("server-banner-{}", server_id_clone), payload);
                    }
                    HotlineEvent::ProtocolLog { level, message } => {
                        let payload = serde_json::json!({
                            "level": level,
                            "message": message,
                        });
                        let _ = app_handle.emit(&format!("protocol-log-{}", server_id_clone), payload);
                    }
                    HotlineEvent::StatusChanged(status) => {
                        let payload = serde_json::json!({
                            "status": status,
                        });
                        let _ = app_handle.emit(&format!("status-changed-{}", server_id_clone), payload);

                        // Emit user access permissions when we're logged in
                        // This ensures we only emit after login is complete and user_access is set
                        if matches!(status, crate::protocol::types::ConnectionStatus::LoggedIn) {
                            // Get user access from the client (non-blocking, already logged in)
                            if let Some(client) = clients_clone.read().await.get(&server_id_clone) {
                                let user_access = client.get_user_access();
                                // As a decimal string: u64 bitmaps overflow the
                                // 53-bit JSON number precision in the webview.
                                let access_payload = serde_json::json!({
                                    "access": user_access.to_string(),
                                });
                                let _ = app_handle.emit(&format!("user-access-{}", server_id_clone), access_payload);
                            }
                        }
                    }
                    HotlineEvent::AccessUpdated { access, server_supports, can_send_media } => {
                        // Mid-session access change: refresh the full permission
                        // bitmap and the inline-media status so the UI updates
                        // live without a reconnect. The event carries everything
                        // needed, so no clients lock here (a disconnect in
                        // flight holds it for writing).
                        let access_payload = serde_json::json!({
                            "access": access.to_string(),
                        });
                        let _ = app_handle.emit(&format!("user-access-{}", server_id_clone), access_payload);
                        let payload = crate::commands::InlineMediaStatus {
                            server_supports,
                            can_send: can_send_media,
                            limits: None,
                        };
                        let _ = app_handle.emit(
                            &format!("inline-media-status-{}", server_id_clone),
                            payload,
                        );
                    }
                }
            }
            println!("Event forwarding task ended for server {}", server_id_clone);
        });

        Ok(crate::commands::ConnectResult {
            server_id,
            tls: final_tls,
            port: final_port,
        })
    }

    pub async fn disconnect_server(&self, server_id: &str) -> Result<(), String> {
        let mut clients = self.clients.write().await;

        if let Some(client) = clients.get(server_id) {
            client.disconnect().await?;
            clients.remove(server_id);
            Ok(())
        } else {
            Err("Server not found".to_string())
        }
    }

    pub async fn update_user_info_all_servers(&self, username: &str, icon_id: u16, color: Option<u32>) -> Result<(), String> {
        let clients = self.clients.read().await;
        let mut errors = Vec::new();

        for (server_id, client) in clients.iter() {
            if let Err(e) = client.send_set_client_user_info(username, icon_id, color).await {
                errors.push(format!("{}: {}", server_id, e));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!("Some servers failed: {}", errors.join(", ")))
        }
    }

    pub async fn send_chat(&self, server_id: &str, message: String) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.send_chat(message).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn send_chat_with_media(
        &self,
        server_id: &str,
        message: String,
        media: Option<crate::protocol::client::chat::ChatMediaAttachment>,
    ) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.send_chat_with_media(message, media).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn send_private_message(&self, server_id: &str, user_id: u16, message: String) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.send_private_message(user_id, message).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn send_private_message_with_media(
        &self,
        server_id: &str,
        user_id: u16,
        message: String,
        media: Option<crate::protocol::client::chat::ChatMediaAttachment>,
    ) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.send_private_message_with_media(user_id, message, media).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn upload_media(
        &self,
        server_id: &str,
        bytes: Vec<u8>,
        declared_mime: String,
    ) -> Result<crate::protocol::client::media::MediaMetadata, String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            crate::protocol::client::media::upload_media(client, bytes, declared_mime).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn download_media(
        &self,
        server_id: &str,
        handle_hex: String,
    ) -> Result<(Vec<u8>, String, u32, u32), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            let handle = crate::protocol::client::media::handle_from_hex(&handle_hex)?;
            let entry = crate::protocol::client::media::download_media(client, handle).await?;
            Ok((entry.bytes, entry.mime, entry.width, entry.height))
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn inline_media_status(
        &self,
        server_id: &str,
    ) -> Result<(bool, bool, crate::protocol::client::media::MediaLimits), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            Ok((client.inline_media_supported(), client.can_send_media(), *client.media_limits.read().await))
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn set_inline_media_enabled(&self, enabled: bool) {
        let clients = self.clients.read().await;
        for client in clients.values() {
            client.set_inline_media_enabled(enabled);
        }
    }

    pub async fn send_broadcast(&self, server_id: &str, message: String) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.send_broadcast(message).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn create_folder(&self, server_id: &str, path: Vec<String>, name: String) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.create_folder(path, name).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn create_news_category(&self, server_id: &str, path: Vec<String>, name: String) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.create_news_category(path, name).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn create_news_folder(&self, server_id: &str, path: Vec<String>, name: String) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.create_news_folder(path, name).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn delete_news_item(&self, server_id: &str, path: Vec<String>) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.delete_news_item(path).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn delete_news_article(&self, server_id: &str, path: Vec<String>, article_id: u32, recursive: bool) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.delete_news_article(path, article_id, recursive).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_pending_agreement(&self, server_id: &str) -> Option<String> {
        let pending = self.pending_agreements.read().await;
        pending.get(server_id).cloned()
    }

    pub async fn accept_agreement(&self, server_id: &str) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            // Remove agreement from pending after acceptance
            {
                let mut pending = self.pending_agreements.write().await;
                pending.remove(server_id);
            }
            client.accept_agreement().await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn download_banner(&self, server_id: &str) -> Result<String, String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            // Get reference number and transfer size
            let (reference_number, transfer_size) = client.download_banner().await?;
            
            println!("Banner download info - reference: {}, transferSize: {}", reference_number, transfer_size);

            // Download banner as raw image data (not FILP format)
            let file_data = client.download_banner_raw(reference_number, transfer_size).await?;

            println!("Banner download complete, {} bytes received", file_data.len());

            // Save banner to app data directory
            let banner_path = self.bookmarks_path.parent()
                .ok_or("Failed to get app data directory".to_string())?
                .join(format!("banner-{}.png", server_id));
            
            std::fs::write(&banner_path, &file_data)
                .map_err(|e| format!("Failed to save banner: {}", e))?;

            println!("Banner saved to: {:?}", banner_path);

            // Return path as string
            banner_path.to_str()
                .ok_or("Failed to convert banner path to string".to_string())
                .map(|s| s.to_string())
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_message_board(&self, server_id: &str) -> Result<Vec<String>, String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.get_message_board().await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn post_message_board(&self, server_id: &str, message: String) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.post_message_board(message).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_file_list(&self, server_id: &str, path: Vec<String>) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.get_file_list(path).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    fn download_directory(&self, download_folder: Option<String>) -> Result<PathBuf, String> {
        Ok(if let Some(ref folder) = download_folder {
                std::path::PathBuf::from(folder)
            } else if cfg!(target_os = "ios") {
                self.app_handle
                    .path()
                    .document_dir()
                    .or_else(|_| {
                        self.app_handle
                            .path()
                            .app_data_dir()
                            .map(|dir| dir.join("Downloads"))
                    })
                    .map_err(|e| format!("Failed to get documents directory: {}", e))?
            } else if cfg!(target_os = "android") {
                self.app_handle
                    .path()
                    .download_dir()
                    .or_else(|_| {
                        self.app_handle
                            .path()
                            .app_data_dir()
                            .map(|dir| dir.join("Downloads"))
                    })
                    .map_err(|e| format!("Failed to get downloads directory: {}", e))?
            } else {
                self.app_handle
                    .path()
                    .download_dir()
                    .or_else(|_| {
                        self.app_handle
                            .path()
                            .home_dir()
                            .map(|dir| dir.join("Downloads"))
                    })
                    .or_else(|_| {
                        self.app_handle
                            .path()
                            .app_data_dir()
                            .map(|dir| dir.join("Downloads"))
                    })
                    .map_err(|e| format!("Failed to get downloads directory: {}", e))?
            })
    }

    pub async fn download_folder(&self, server_id: &str, path: Vec<String>, name: String, destination: Option<String>) -> Result<String, String> {
        let clients = self.clients.read().await;
        let client = clients.get(server_id).ok_or("Server not connected")?;
        let base = self.download_directory(destination)?;
        tokio::fs::create_dir_all(&base).await.map_err(|e| e.to_string())?;
        let safe_name: String = name.chars().map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '?' | '*' | '|') { '_' } else { c }).collect();
        if safe_name.is_empty() || safe_name == "." || safe_name == ".." { return Err("Invalid folder name".into()); }
        let (reference, _, count) = client.download_folder(path, name.clone()).await?;
        let mut root = None;
        for counter in 0..10000 {
            let candidate = base.join(if counter == 0 { safe_name.clone() } else { format!("{safe_name} ({counter})") });
            match tokio::fs::create_dir(&candidate).await {
                Ok(()) => { root = Some(candidate); break; }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e.to_string()),
            }
        }
        let root = root.ok_or("Cannot find an unused folder name")?;
        client.receive_folder(reference, count, &root, |done, total| {
            let progress = if total == 0 { 100 } else { done * 100 / total };
            let _ = self.app_handle.emit(&format!("download-progress-{server_id}"), serde_json::json!({
                "fileName": name, "bytesRead": done, "totalBytes": total, "progress": progress,
            }));
        }).await.map_err(|e| format!("{e}. Completed files remain in {}", root.display()))?;
        Ok(format!("Downloaded to: {}", root.display()))
    }

    pub async fn upload_folder(&self, server_id: &str, path: Vec<String>, root: PathBuf) -> Result<(), String> {
        let clients = self.clients.read().await;
        let client = clients.get(server_id).ok_or("Server not connected")?;
        let name = root.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        client.send_folder(path, root, |done, total| {
            let progress = if total == 0 { 100 } else { done * 100 / total };
            let _ = self.app_handle.emit(&format!("upload-progress-{server_id}"), serde_json::json!({
                "fileName": name, "bytesSent": done, "totalBytes": total, "progress": progress,
            }));
        }).await
    }

    pub async fn download_file(&self, server_id: &str, path: Vec<String>, file_name: String, file_size: u64, download_folder: Option<String>) -> Result<String, String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            // Get downloads directory: use user preference if set, otherwise fall back to system default
            let downloads_dir = self.download_directory(download_folder)?;

            // Ensure downloads directory exists
            fs::create_dir_all(&downloads_dir)
                .map_err(|e| format!("Failed to create downloads directory: {}", e))?;

            // Sanitize filename for filesystem (handle unicode and invalid characters)
            // Replace invalid path characters with underscore
            let sanitized_name = file_name
                .chars()
                .map(|c| {
                    if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                        '_'
                    } else {
                        c
                    }
                })
                .collect::<String>();
            
            let sanitized_name = if sanitized_name.is_empty() || sanitized_name == "." || sanitized_name == ".." {
                "download".to_string()
            } else { sanitized_name };

            // Bind a retained partial to the remote file's identity and modification date.
            // Without a date, restart rather than risk appending to a changed file.
            use sha2::{Digest, Sha256};
            use tokio::io::{AsyncSeekExt, AsyncWriteExt};
            let info = client.get_file_info(path.clone(), file_name.clone()).await.ok();
            let resumable = info.as_ref().and_then(|i| i.modify_date.as_ref()).is_some();
            let total = info.as_ref().map(|i| i.file_size).unwrap_or(file_size);
            let identity = serde_json::to_vec(&(client.transfer_identity(), &path, &file_name,
                total, info.as_ref().and_then(|i| i.modify_date_raw.as_ref()))).map_err(|e| e.to_string())?;
            let partial_dir = self.app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("PartialDownloads");
            tokio::fs::create_dir_all(&partial_dir).await.map_err(|e| e.to_string())?;
            let partial_path = partial_dir.join(format!("{:x}.part", Sha256::digest(&identity)));
            let _guard = downloads::DownloadGuard::acquire(partial_path.clone())?;
            if let Ok(meta) = tokio::fs::symlink_metadata(&partial_path).await {
                if !meta.is_file() { return Err("Partial download is not a regular file".into()); }
            }
            let mut partial = tokio::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true)
                .open(&partial_path).await.map_err(|e| e.to_string())?;
            let mut offset = partial.metadata().await.map_err(|e| e.to_string())?.len();
            if !resumable || offset > total {
                partial.set_len(0).await.map_err(|e| e.to_string())?;
                offset = 0;
            }
            for attempt in 0..2 {
                partial.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| e.to_string())?;
                let request = client.download_file_at(path.clone(), file_name.clone(), offset).await;
                let (reference, server_size) = match request {
                    Ok(value) => value,
                    Err(_) if offset > 0 && attempt == 0 => {
                        partial.set_len(0).await.map_err(|e| e.to_string())?;
                        offset = 0;
                        continue;
                    }
                    Err(e) => return Err(e),
                };
                let expected = server_size.or_else(|| if total > 0 { Some(total) } else { None });
                let remaining = expected.map(|size| size.checked_sub(offset).ok_or("Remote file is smaller than the partial"))
                    .transpose()?;
                let result = client.receive_file_to_disk(reference, remaining, offset, &mut partial, |read, total| {
                    let progress = if total > 0 { (read as f64 / total as f64 * 100.0) as u32 } else { 0 };
                    let _ = self.app_handle.emit(&format!("download-progress-{}", server_id), serde_json::json!({
                        "fileName": file_name, "bytesRead": read, "totalBytes": total, "progress": progress,
                    }));
                }).await;
                partial.flush().await.map_err(|e| e.to_string())?;
                match result {
                    Ok(_) => break,
                    Err(e) if offset > 0 && attempt == 0 && e.contains("unexpected file size") => {
                        partial.set_len(0).await.map_err(|e| e.to_string())?;
                        offset = 0;
                    }
                    Err(e) => return Err(format!("{e}. Download again to retry; partial data has been saved.")),
                }
            }
            partial.sync_all().await.map_err(|e| e.to_string())?;

            // Reserve a new destination atomically, preserving any existing user file.
            let base = downloads_dir.join(&sanitized_name);
            let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
            let ext = base.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
            let mut destination = None;
            for counter in 0..10000 {
                let candidate = if counter == 0 { base.clone() } else { downloads_dir.join(format!("{stem} ({counter}){ext}")) };
                match tokio::fs::OpenOptions::new().write(true).create_new(true).open(&candidate).await {
                    Ok(file) => { destination = Some((candidate, file)); break; }
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => return Err(e.to_string()),
                }
            }
            let (file_path, mut output) = destination.ok_or("Cannot find an unused download filename")?;
            partial.seek(std::io::SeekFrom::Start(0)).await.map_err(|e| e.to_string())?;
            if let Err(e) = tokio::io::copy(&mut partial, &mut output).await {
                drop(output);
                let _ = tokio::fs::remove_file(&file_path).await;
                return Err(format!("Could not finish saving download: {e}"));
            }
            output.sync_all().await.map_err(|e| e.to_string())?;
            drop(partial);
            let _ = tokio::fs::remove_file(&partial_path).await;

            Ok(format!("Downloaded to: {}", file_path.display()))
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_gif_icons(&self, server_id: &str) -> Result<Vec<crate::protocol::client::avatars::GifIcon>, String> {
        let clients = self.clients.read().await;
        clients.get(server_id).ok_or("Server not connected")?.get_gif_icons().await
    }
    pub async fn get_gif_icon(&self, server_id: &str, user_id: u16) -> Result<crate::protocol::client::avatars::GifIcon, String> {
        let clients = self.clients.read().await;
        clients.get(server_id).ok_or("Server not connected")?.get_gif_icon(user_id).await
    }
    pub async fn set_gif_icon(&self, server_id: &str, bytes: Vec<u8>) -> Result<(), String> {
        let clients = self.clients.read().await;
        clients.get(server_id).ok_or("Server not connected")?.set_gif_icon(bytes).await
    }

    pub async fn get_bookmarks(&self) -> Result<Vec<Bookmark>, String> {
        let bookmarks = self.bookmarks.read().await;
        Ok(bookmarks.clone())
    }

    pub async fn get_server_info(&self, server_id: &str) -> Result<crate::protocol::types::ServerInfo, String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.get_server_info().await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_user_access(&self, server_id: &str) -> Result<u64, String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            Ok(client.get_user_access())
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_chat_history(
        &self,
        server_id: &str,
        before: Option<u64>,
        after: Option<u64>,
        limit: Option<u16>,
    ) -> Result<(Vec<crate::protocol::history::HistoryEntry>, bool), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.get_chat_history(0, before, after, limit).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn delete_file(&self, server_id: &str, path: Vec<String>, file_name: String) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.delete_file(path, file_name).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn move_file(&self, server_id: &str, path: Vec<String>, file_name: String, new_path: Vec<String>) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.move_file(path, file_name, new_path).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_file_info(&self, server_id: &str, path: Vec<String>, file_name: String) -> Result<crate::protocol::client::files::FileInfoDetails, String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.get_file_info(path, file_name).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn set_file_info(&self, server_id: &str, path: Vec<String>, file_name: String, new_name: Option<String>, comment: Option<String>) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.set_file_info(path, file_name, new_name, comment).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_client_info(&self, server_id: &str, user_id: u16) -> Result<String, String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.get_client_info(user_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn disconnect_user(&self, server_id: &str, user_id: u16, options: Option<u16>) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.disconnect_user(user_id, options).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn invite_to_new_chat(&self, server_id: &str, user_id: u16) -> Result<u32, String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.invite_to_new_chat(user_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn invite_to_chat(&self, server_id: &str, chat_id: u32, user_id: u16) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.invite_to_chat(chat_id, user_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn reject_chat_invite(&self, server_id: &str, chat_id: u32) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.reject_chat_invite(chat_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn join_chat(&self, server_id: &str, chat_id: u32) -> Result<(String, Vec<(u16, String, u16, u16, Option<u32>)>), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.join_chat(chat_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn leave_chat(&self, server_id: &str, chat_id: u32) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.leave_chat(chat_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn set_chat_subject(&self, server_id: &str, chat_id: u32, subject: String) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.set_chat_subject(chat_id, subject).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn send_private_chat_message(&self, server_id: &str, chat_id: u32, message: String, media: Option<crate::protocol::client::chat::ChatMediaAttachment>) -> Result<(), String> {
        let clients = self.clients.read().await;
        if let Some(client) = clients.get(server_id) {
            client.send_private_chat_message_with_media(chat_id, message, media).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn save_bookmark(&self, bookmark: Bookmark) -> Result<(), String> {
        let mut bookmarks = self.bookmarks.write().await;

        // Check if bookmark already exists, update it
        if let Some(existing) = bookmarks.iter_mut().find(|b| b.id == bookmark.id) {
            *existing = bookmark;
        } else {
            bookmarks.push(bookmark);
        }

        // Persist to disk
        self.save_bookmarks_to_disk(&bookmarks)?;

        Ok(())
    }

    pub async fn delete_bookmark(&self, id: &str) -> Result<(), String> {
        let mut bookmarks = self.bookmarks.write().await;
        bookmarks.retain(|b| b.id != id);

        // Persist to disk
        self.save_bookmarks_to_disk(&bookmarks)?;

        Ok(())
    }

    pub async fn reorder_bookmarks(&self, new_bookmarks: Vec<Bookmark>) -> Result<(), String> {
        let mut bookmarks = self.bookmarks.write().await;
        
        // Validate that all bookmarks exist (prevent data loss)
        let existing_ids: std::collections::HashSet<String> = bookmarks.iter().map(|b| b.id.clone()).collect();
        let new_ids: std::collections::HashSet<String> = new_bookmarks.iter().map(|b| b.id.clone()).collect();
        
        if existing_ids != new_ids {
            return Err("Bookmark reorder failed: bookmark count or IDs don't match".to_string());
        }
        
        *bookmarks = new_bookmarks;

        // Persist to disk
        self.save_bookmarks_to_disk(&bookmarks)?;

        Ok(())
    }

    pub async fn add_default_bookmarks(&self) -> Result<Vec<Bookmark>, String> {
        use crate::protocol::constants::{DEFAULT_SERVER_PORT, DEFAULT_TLS_PORT, DEFAULT_TRACKER_PORT};
        use crate::protocol::types::BookmarkType;

        let mut bookmarks = self.bookmarks.write().await;

        // Define default trackers: (id, name, address, port)
        let default_trackers = vec![
            ("default-tracker-hltracker", "Featured Servers", "hltracker.com", DEFAULT_TRACKER_PORT),
            ("default-tracker-mainecyber", "Maine Cyber", "tracked.mainecyber.com", DEFAULT_TRACKER_PORT),
            ("default-tracker-preterhuman", "Preterhuman", "tracker.preterhuman.net", DEFAULT_TRACKER_PORT),
        ];

        // Define default servers: (id, name, address, port, tls, hope)
        let default_servers = vec![
            ("default-server-bigredh", "Hotline Central Hub", "server.bigredh.com", DEFAULT_SERVER_PORT, false, false),
            ("default-server-system7", "System7 Today", "hotline.system7today.com", DEFAULT_SERVER_PORT, false, false),
            ("default-server-macdomain", "MacDomain", "62.116.228.143", DEFAULT_SERVER_PORT, false, false),
            ("default-server-applearchive", "Apple Media Archive & Hotline Navigator", "hotline.semihosted.xyz", DEFAULT_TLS_PORT, true, true),
        ];

        let mut added_count = 0;

        // Add missing default trackers
        for (id, name, address, port) in &default_trackers {
            let has_tracker = bookmarks.iter().any(|b: &Bookmark| {
                b.address == *address
                && b.port == *port
                && matches!(b.bookmark_type, Some(BookmarkType::Tracker))
            });

            if !has_tracker {
                let tracker = Bookmark {
                    id: id.to_string(),
                    name: name.to_string(),
                    address: address.to_string(),
                    port: *port,
                    login: "guest".to_string(),
                    password: None,
                    has_password: false,
                    icon: None,
                    auto_connect: false,
                    tls: false,
                    hope: false,
                    bookmark_type: Some(BookmarkType::Tracker),
                };
                bookmarks.push(tracker);
                added_count += 1;
            }
        }

        // Add missing default servers
        for (id, name, address, port, tls, hope) in &default_servers {
            let has_server = bookmarks.iter().any(|b: &Bookmark| {
                b.address == *address
                && matches!(b.bookmark_type, Some(BookmarkType::Server))
            });

            if !has_server {
                let server = Bookmark {
                    id: id.to_string(),
                    name: name.to_string(),
                    address: address.to_string(),
                    port: *port,
                    login: "guest".to_string(),
                    password: None,
                    has_password: false,
                    icon: None,
                    auto_connect: false,
                    tls: *tls,
                    hope: *hope,
                    bookmark_type: Some(BookmarkType::Server),
                };
                bookmarks.push(server);
                added_count += 1;
            }
        }
        
        if added_count > 0 {
            // Persist to disk
            self.save_bookmarks_to_disk(&bookmarks)?;
        }
        
        let result = bookmarks.clone();
        Ok(result)
    }

    pub async fn get_news_categories(&self, server_id: &str, path: Vec<String>) -> Result<Vec<crate::protocol::types::NewsCategory>, String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.get_news_categories(path).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_news_articles(&self, server_id: &str, path: Vec<String>) -> Result<Vec<crate::protocol::types::NewsArticle>, String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.get_news_articles(path).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn get_news_article_data(&self, server_id: &str, article_id: u32, path: Vec<String>) -> Result<String, String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.get_news_article_data(article_id, path).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn post_news_article(&self, server_id: &str, title: String, text: String, path: Vec<String>, parent_id: u32) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            client.post_news_article(title, text, path, parent_id).await
        } else {
            Err("Server not connected".to_string())
        }
    }

    pub async fn upload_file(
        &self,
        server_id: &str,
        path: Vec<String>,
        file_name: String,
        file_data: Vec<u8>,
    ) -> Result<(), String> {
        let clients = self.clients.read().await;

        if let Some(client) = clients.get(server_id) {
            let app_handle = self.app_handle.clone();
            let server_id_clone = server_id.to_string();
            let file_name_clone = file_name.clone();
            let _total_bytes = file_data.len() as u64;

            client.upload_file(
                path,
                file_name,
                file_data,
                move |bytes_sent, total_bytes| {
                    let progress = (bytes_sent as f64 / total_bytes as f64 * 100.0) as u32;
                    let payload = serde_json::json!({
                        "fileName": file_name_clone,
                        "bytesSent": bytes_sent,
                        "totalBytes": total_bytes,
                        "progress": progress,
                    });
                    let _ = app_handle.emit(&format!("upload-progress-{}", server_id_clone), payload);
                }
            ).await?;

            Ok(())
        } else {
            Err("Server not connected".to_string())
        }
    }
}
