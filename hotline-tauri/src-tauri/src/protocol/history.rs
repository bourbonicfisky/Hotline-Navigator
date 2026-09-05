/// Parser for the Chat History Extension binary entry format (DATA_HISTORY_ENTRY, 0x0F05).
///
/// Each entry is a packed binary struct — not standard Hotline TLV:
///
/// | Offset   | Size | Field       |
/// |----------|------|-------------|
/// | 0        | 8    | message_id  | uint64 BE
/// | 8        | 8    | timestamp   | int64 BE (Unix epoch seconds)
/// | 16       | 2    | flags       | uint16 BE
/// | 18       | 2    | icon_id     | uint16 BE
/// | 20       | 2    | nick_len    | uint16 BE
/// | 22       | N    | nick        | nick_len bytes
/// | 22+N     | 2    | msg_len     | uint16 BE
/// | 24+N     | M    | message     | msg_len bytes
/// | 24+N+M   | ...  | sub-fields  | mini-TLV (skip unknown types)
///
/// Minimum size: 24 bytes (empty nick and empty message).

use serde::Serialize;

/// A single parsed chat history entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// Server-assigned message ID as string (u64 → string to avoid JS precision loss).
    pub message_id: String,
    /// Unix epoch seconds (UTC).
    pub timestamp: i64,
    /// Raw flags bitfield.
    pub flags: u16,
    /// Sender's icon ID at the time the message was sent.
    pub icon_id: u16,
    /// Sender's display nickname.
    pub nick: String,
    /// Chat message text.
    pub message: String,
}

impl HistoryEntry {
    /// Flag bit 0: message was a `/me` emote.
    pub fn is_action(&self) -> bool {
        self.flags & 0x0001 != 0
    }

    /// Flag bit 1: message originated from the server (admin broadcast).
    pub fn is_server_msg(&self) -> bool {
        self.flags & 0x0002 != 0
    }

    /// Flag bit 2: message was deleted by an administrator (tombstone).
    pub fn is_deleted(&self) -> bool {
        self.flags & 0x0004 != 0
    }
}

/// Read a big-endian u16 from a byte slice at the given offset.
fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([data[offset], data[offset + 1]])
}

/// Read a big-endian u64 from a byte slice at the given offset.
fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[offset..offset + 8]);
    u64::from_be_bytes(buf)
}

/// Read a big-endian i64 from a byte slice at the given offset.
fn read_i64(data: &[u8], offset: usize) -> i64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[offset..offset + 8]);
    i64::from_be_bytes(buf)
}

use super::types::{TextEncoding, decode_bytes};

/// Parse a single `DATA_HISTORY_ENTRY` field's raw bytes into a `HistoryEntry`.
///
/// Returns an error if the data is too short or has inconsistent length fields.
/// Unknown mini-TLV sub-fields are silently skipped (forward compatibility).
pub fn parse_history_entry(data: &[u8]) -> Result<HistoryEntry, String> {
    parse_history_entry_with(data, TextEncoding::Macintosh)
}

pub fn parse_history_entry_with(data: &[u8], encoding: TextEncoding) -> Result<HistoryEntry, String> {
    let data_len = data.len();

    // Fixed header requires at least 22 bytes (before nick, which could be 0-length,
    // plus 2 bytes for msg_len = 24 minimum).
    if data_len < 24 {
        return Err(format!("History entry too short: {} bytes (minimum 24)", data_len));
    }

    let message_id = read_u64(data, 0);
    let timestamp = read_i64(data, 8);
    let flags = read_u16(data, 16);
    let icon_id = read_u16(data, 18);
    let nick_len = read_u16(data, 20) as usize;

    // Validate nick fits: 22 + nick_len + 2 (msg_len field) <= data_len
    if 22 + nick_len + 2 > data_len {
        return Err(format!(
            "History entry too short for nick + msg_len: need {}, have {}",
            22 + nick_len + 2,
            data_len
        ));
    }

    let nick = decode_bytes(&data[22..22 + nick_len], encoding);
    let msg_len = read_u16(data, 22 + nick_len) as usize;

    // Validate message fits
    if 24 + nick_len + msg_len > data_len {
        return Err(format!(
            "History entry too short for message body: need {}, have {}",
            24 + nick_len + msg_len,
            data_len
        ));
    }

    let message = decode_bytes(&data[24 + nick_len..24 + nick_len + msg_len], encoding);

    // Optional sub-fields after the message body — skip all (no types defined in v1).
    // We parse them only to validate structure; a future version could extract known types.
    let mut offset = 24 + nick_len + msg_len;
    while offset + 4 <= data_len {
        let _sub_type = read_u16(data, offset);
        let sub_len = read_u16(data, offset + 2) as usize;
        if offset + 4 + sub_len > data_len {
            break; // malformed sub-field, stop parsing
        }
        offset += 4 + sub_len;
    }

    Ok(HistoryEntry {
        message_id: message_id.to_string(),
        timestamp,
        flags,
        icon_id,
        nick,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macroman_history_matches_the_unnegotiated_session() {
        let data = build_entry(1, 100, 0, 1, b"Ren\x8ee", b"Caf\x8e");
        let entry = parse_history_entry(&data).unwrap();
        assert_eq!(entry.nick, "Renée");
        assert_eq!(entry.message, "Café");
    }

    #[test]
    fn history_decodes_utf8_and_normalizes_newlines() {
        let data = build_entry(u64::MAX, 100, 0, 1, "日本語".as_bytes(), "café\r\nこんにちは".as_bytes());
        let entry = parse_history_entry_with(&data, TextEncoding::Utf8).unwrap();
        assert_eq!(entry.nick, "日本語");
        assert_eq!(entry.message, "café\nこんにちは");
        assert_eq!(entry.message_id, u64::MAX.to_string());
    }

    /// Build a minimal history entry for testing.
    fn build_entry(msg_id: u64, ts: i64, flags: u16, icon: u16, nick: &[u8], msg: &[u8]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&msg_id.to_be_bytes());
        data.extend_from_slice(&ts.to_be_bytes());
        data.extend_from_slice(&flags.to_be_bytes());
        data.extend_from_slice(&icon.to_be_bytes());
        data.extend_from_slice(&(nick.len() as u16).to_be_bytes());
        data.extend_from_slice(nick);
        data.extend_from_slice(&(msg.len() as u16).to_be_bytes());
        data.extend_from_slice(msg);
        data
    }

    #[test]
    fn test_parse_normal_entry() {
        let data = build_entry(1000, 1729137536, 0, 128, b"greg", b"Hello everyone");
        let entry = parse_history_entry(&data).unwrap();
        assert_eq!(entry.message_id, "1000");
        assert_eq!(entry.timestamp, 1729137536);
        assert_eq!(entry.flags, 0);
        assert_eq!(entry.icon_id, 128);
        assert_eq!(entry.nick, "greg");
        assert_eq!(entry.message, "Hello everyone");
        assert!(!entry.is_action());
        assert!(!entry.is_server_msg());
        assert!(!entry.is_deleted());
    }

    #[test]
    fn test_parse_emote_entry() {
        let data = build_entry(1001, 1729137540, 0x0001, 128, b"greg", b"dances");
        let entry = parse_history_entry(&data).unwrap();
        assert!(entry.is_action());
        assert!(!entry.is_server_msg());
    }

    #[test]
    fn test_parse_server_msg() {
        let data = build_entry(1002, 1729137545, 0x0002, 0, b"", b"Server restarting");
        let entry = parse_history_entry(&data).unwrap();
        assert!(entry.is_server_msg());
        assert_eq!(entry.nick, "");
    }

    #[test]
    fn test_parse_tombstone() {
        let data = build_entry(1003, 1729137550, 0x0004, 0, b"", b"");
        let entry = parse_history_entry(&data).unwrap();
        assert!(entry.is_deleted());
        assert_eq!(entry.nick, "");
        assert_eq!(entry.message, "");
    }

    #[test]
    fn test_parse_too_short() {
        let data = vec![0u8; 10];
        assert!(parse_history_entry(&data).is_err());
    }

    #[test]
    fn test_parse_with_unknown_subfields() {
        let mut data = build_entry(1004, 1729137555, 0, 128, b"alice", b"hi");
        // Append an unknown sub-field: type=0x0099, length=3, data=[0xAA, 0xBB, 0xCC]
        data.extend_from_slice(&0x0099u16.to_be_bytes());
        data.extend_from_slice(&0x0003u16.to_be_bytes());
        data.extend_from_slice(&[0xAA, 0xBB, 0xCC]);
        let entry = parse_history_entry(&data).unwrap();
        assert_eq!(entry.nick, "alice");
        assert_eq!(entry.message, "hi");
    }
}
