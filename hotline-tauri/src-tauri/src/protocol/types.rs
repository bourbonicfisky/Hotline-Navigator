// Hotline protocol types
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BookmarkType {
    Server,
    Tracker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub login: String,
    /// Password — used for IPC transit. Stripped before writing to disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// True when a password is stored in the secure vault.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<u16>,
    #[serde(default)]
    pub auto_connect: bool,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub hope: bool,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub bookmark_type: Option<BookmarkType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerServer {
    pub address: String,
    pub port: u16,
    pub users: u16,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub description: String,
    pub version: String,
    #[serde(rename = "hopeEnabled", default)]
    pub hope_enabled: bool,
    #[serde(rename = "hopeTransport", default)]
    pub hope_transport: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agreement: Option<String>,
    /// Server supports chat history extension (capability bit 4).
    #[serde(rename = "chatHistorySupported", default)]
    pub chat_history_supported: bool,
    /// Server retention policy: max messages (0 = unlimited). Informational only.
    #[serde(rename = "historyMaxMsgs", skip_serializing_if = "Option::is_none")]
    pub history_max_msgs: Option<u32>,
    /// Server retention policy: max days (0 = unlimited). Informational only.
    #[serde(rename = "historyMaxDays", skip_serializing_if = "Option::is_none")]
    pub history_max_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: u32,
    pub name: String,
    pub icon: u16,
    pub flags: u16,
    pub is_admin: bool,
    pub is_idle: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    LoggingIn,
    LoggedIn,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsCategory {
    #[serde(rename = "type")]
    pub category_type: u16, // 2 = bundle (folder), 3 = category
    pub count: u16,         // Number of items inside
    pub name: String,
    pub path: Vec<String>,  // Full path to this category
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsArticle {
    pub id: u32,
    pub parent_id: u32,     // 0 if root article
    pub flags: u32,
    pub title: String,
    pub poster: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    pub path: Vec<String>,  // Path to containing category
}

/// Wire text encoding selected by the server's capability reply.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TextEncoding {
    #[default]
    Macintosh,
    Utf8,
}

impl TextEncoding {
    pub fn negotiated(capabilities: u64) -> Self {
        if capabilities & super::constants::CAPABILITY_TEXT_ENCODING != 0 {
            Self::Utf8
        } else {
            Self::Macintosh
        }
    }
}

pub fn decode_bytes(data: &[u8], encoding: TextEncoding) -> String {
    let text = match encoding {
        TextEncoding::Utf8 => String::from_utf8_lossy(data),
        TextEncoding::Macintosh => encoding_rs::MACINTOSH.decode(data).0,
    };
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn encode_text(text: &str, encoding: TextEncoding) -> Vec<u8> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    if encoding == TextEncoding::Utf8 {
        return normalized.into_bytes();
    }
    // encoding_rs emits numeric HTML references for unmappable characters.
    // Hotline requires a single '?' instead, while preserving other text.
    let mut bytes = Vec::with_capacity(text.len());
    for ch in normalized.chars() {
        if ch == '\n' { bytes.push(b'\r'); continue; }
        let mut buf = [0; 4];
        let (encoded, _, unmappable) = encoding_rs::MACINTOSH.encode(ch.encode_utf8(&mut buf));
        if unmappable { bytes.push(b'?'); } else { bytes.extend_from_slice(&encoded); }
    }
    bytes
}

#[cfg(test)]
mod text_encoding_tests {
    use super::*;

    #[test]
    fn conversion_uses_session_encoding_without_guessing() {
        assert_eq!(decode_bytes(b"\xc3\xa9", TextEncoding::Utf8), "é");
        assert_eq!(decode_bytes(b"\xc3\xa9", TextEncoding::Macintosh), "√©");
        for encoding in [TextEncoding::Macintosh, TextEncoding::Utf8] {
            assert_eq!(decode_bytes(&encode_text("åäö café", encoding), encoding), "åäö café");
        }
        assert_eq!(encode_text("café 日本語", TextEncoding::Macintosh), b"caf\x8e ???");
        assert_eq!(decode_bytes(&encode_text("日本語", TextEncoding::Utf8), TextEncoding::Utf8), "日本語");
        assert_eq!(decode_bytes(b"a\r\nb\rc\nd", TextEncoding::Utf8), "a\nb\nc\nd");
        assert_eq!(decode_bytes(b"\xff", TextEncoding::Utf8), "�");
    }

    #[test]
    fn utf8_requires_server_confirmation() {
        assert_eq!(TextEncoding::negotiated(0), TextEncoding::Macintosh);
        assert_eq!(TextEncoding::negotiated(0xfffd), TextEncoding::Macintosh);
        assert_eq!(TextEncoding::negotiated(2), TextEncoding::Utf8);
    }
}
