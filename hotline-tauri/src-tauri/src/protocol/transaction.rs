// Hotline transaction structures

use super::types::{TextEncoding, decode_bytes, encode_text};
use super::constants::{FieldType, TransactionType, TRANSACTION_HEADER_SIZE};

#[derive(Debug, Clone)]
pub struct TransactionField {
    pub field_type: FieldType,
    pub data: Vec<u8>,
}

impl TransactionField {
    pub fn new(field_type: FieldType, data: Vec<u8>) -> Self {
        Self { field_type, data }
    }

    pub fn from_string(field_type: FieldType, value: &str) -> Self {
        Self::from_string_with(field_type, value, TextEncoding::Macintosh)
    }

    pub fn from_string_with(field_type: FieldType, value: &str, encoding: TextEncoding) -> Self {
        Self { field_type, data: encode_text(value, encoding) }
    }

    pub fn from_encoded_string(field_type: FieldType, value: &str) -> Self {
        // Simple obfuscation (XOR with 0xFF) - Hotline's encoding
        let encoded: Vec<u8> = value.bytes().map(|b| b ^ 0xFF).collect();
        Self {
            field_type,
            data: encoded,
        }
    }

    pub fn from_u8(field_type: FieldType, value: u8) -> Self {
        Self {
            field_type,
            data: vec![value],
        }
    }

    pub fn from_u16(field_type: FieldType, value: u16) -> Self {
        Self {
            field_type,
            data: value.to_be_bytes().to_vec(),
        }
    }

    pub fn from_u32(field_type: FieldType, value: u32) -> Self {
        Self {
            field_type,
            data: value.to_be_bytes().to_vec(),
        }
    }

    pub fn from_u64(field_type: FieldType, value: u64) -> Self {
        Self {
            field_type,
            data: value.to_be_bytes().to_vec(),
        }
    }

    /// Encode a capability bitmask using the smallest width that fits
    /// (per spec: "typically 2 bytes, expandable to 8 bytes (64-bit)").
    /// Servers that only read 2 bytes still see all the bits when they fit.
    pub fn from_capability_bits(field_type: FieldType, value: u64) -> Self {
        let data = if value <= u16::MAX as u64 {
            (value as u16).to_be_bytes().to_vec()
        } else if value <= u32::MAX as u64 {
            (value as u32).to_be_bytes().to_vec()
        } else {
            value.to_be_bytes().to_vec()
        };
        Self { field_type, data }
    }

    pub fn from_path(field_type: FieldType, path: &[String]) -> Self {
        Self::from_path_with(field_type, path, TextEncoding::Macintosh)
    }

    pub fn from_path_with(field_type: FieldType, path: &[String], encoding: TextEncoding) -> Self {
        let mut data = Vec::new();

        // Write count of path components
        data.extend_from_slice(&(path.len() as u16).to_be_bytes());

        // Write each path component with MacRoman encoding
        for component in path {
            let component_bytes = encode_text(component, encoding);

            // Write separator (always 0)
            data.extend_from_slice(&0u16.to_be_bytes());

            // Protocol limits component length to 1 byte (255 max)
            let mut len = component_bytes.len().min(255);
            if encoding == TextEncoding::Utf8 {
                while !component.is_char_boundary(len) { len -= 1; }
            }
            data.push(len as u8);
            data.extend_from_slice(&component_bytes[..len]);
        }

        Self {
            field_type,
            data,
        }
    }

    pub fn to_string(&self) -> Result<String, String> {
        self.to_string_with(TextEncoding::Macintosh)
    }

    pub fn to_string_with(&self, encoding: TextEncoding) -> Result<String, String> {
        Ok(decode_bytes(&self.data, encoding))
    }

    pub fn to_u16(&self) -> Result<u16, String> {
        if self.data.len() != 2 {
            return Err(format!("Invalid u16 size: {}", self.data.len()));
        }
        Ok(u16::from_be_bytes([self.data[0], self.data[1]]))
    }

    pub fn to_u32(&self) -> Result<u32, String> {
        if self.data.len() != 4 {
            return Err(format!("Invalid u32 size: {}", self.data.len()));
        }
        Ok(u32::from_be_bytes([
            self.data[0],
            self.data[1],
            self.data[2],
            self.data[3],
        ]))
    }

    pub fn to_u64(&self) -> Result<u64, String> {
        if self.data.len() != 8 {
            return Err(format!("Invalid u64 size: {}", self.data.len()));
        }
        Ok(u64::from_be_bytes([
            self.data[0],
            self.data[1],
            self.data[2],
            self.data[3],
            self.data[4],
            self.data[5],
            self.data[6],
            self.data[7],
        ]))
    }

    /// Decode a variable-width capability bitmask field (DATA_CAPABILITIES, 0x01F0).
    /// Per the fogWraith Capabilities spec, the field is "variable; typically 2 bytes,
    /// expandable to 8 bytes (64-bit)". Accepts 2-, 4-, or 8-byte fields by right-aligning
    /// the bytes into a u64 with high-order bytes zero-padded. Other widths return an error.
    pub fn to_capability_bits(&self) -> Result<u64, String> {
        let n = self.data.len();
        if n != 2 && n != 4 && n != 8 {
            return Err(format!("Invalid capability field width: {}", n));
        }
        let mut buf = [0u8; 8];
        buf[8 - n..].copy_from_slice(&self.data);
        Ok(u64::from_be_bytes(buf))
    }

    // Encode field for transmission
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(self.field_type as u16).to_be_bytes());
        buf.extend_from_slice(&(self.data.len() as u16).to_be_bytes());
        buf.extend_from_slice(&self.data);
        buf
    }
}

#[derive(Debug, Clone)]
pub struct Transaction {
    pub flags: u8,
    pub is_reply: u8,
    pub transaction_type: TransactionType,
    pub id: u32,
    pub error_code: u32,
    pub fields: Vec<TransactionField>,
}

impl Transaction {
    pub fn new(id: u32, transaction_type: TransactionType) -> Self {
        Self {
            flags: 0,
            is_reply: 0,
            transaction_type,
            id,
            error_code: 0,
            fields: Vec::new(),
        }
    }

    pub fn add_field(&mut self, field: TransactionField) {
        self.fields.push(field);
    }

    pub fn get_field(&self, field_type: FieldType) -> Option<&TransactionField> {
        self.fields
            .iter()
            .find(|f| f.field_type == field_type)
    }

    // Calculate the data size (all encoded fields)
    fn calculate_data_size(&self) -> u32 {
        let mut size = 2; // Field count (u16)
        for field in &self.fields {
            size += 2; // Field type
            size += 2; // Field size
            size += field.data.len(); // Field data
        }
        size as u32
    }

    // Encode transaction for sending
    pub fn encode(&self) -> Vec<u8> {
        let data_size = self.calculate_data_size();
        // Both totalSize and dataSize are the length of the field data (not including header)
        let total_size = data_size;

        let mut buf = Vec::with_capacity((TRANSACTION_HEADER_SIZE as u32 + data_size) as usize);

        // Header (20 bytes)
        buf.push(self.flags);
        buf.push(self.is_reply);
        buf.extend_from_slice(&(self.transaction_type as u16).to_be_bytes());
        buf.extend_from_slice(&self.id.to_be_bytes());
        buf.extend_from_slice(&self.error_code.to_be_bytes());
        buf.extend_from_slice(&total_size.to_be_bytes());
        buf.extend_from_slice(&data_size.to_be_bytes());

        // Fields
        buf.extend_from_slice(&(self.fields.len() as u16).to_be_bytes());
        for field in &self.fields {
            buf.extend_from_slice(&field.encode());
        }

        buf
    }

    // Decode transaction from bytes
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < TRANSACTION_HEADER_SIZE {
            return Err("Transaction data too short".to_string());
        }

        let flags = data[0];
        let is_reply = data[1];
        let transaction_type = TransactionType::from(u16::from_be_bytes([data[2], data[3]]));
        let id = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        let error_code = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
        let total_size = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
        let data_size = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);

        let mut transaction = Transaction {
            flags,
            is_reply,
            transaction_type,
            id,
            error_code,
            fields: Vec::new(),
        };

        // Decode fields
        if data_size > 0 && data.len() >= TRANSACTION_HEADER_SIZE + 2 {
            let field_data = &data[TRANSACTION_HEADER_SIZE..];
            if field_data.len() < 2 {
                return Ok(transaction);
            }

            let field_count = u16::from_be_bytes([field_data[0], field_data[1]]) as usize;
            let mut offset = 2;

            for _ in 0..field_count {
                if offset + 4 > field_data.len() {
                    break;
                }

                let field_type_raw = u16::from_be_bytes([field_data[offset], field_data[offset + 1]]);
                let field_size = u16::from_be_bytes([field_data[offset + 2], field_data[offset + 3]]) as usize;
                offset += 4;

                if offset + field_size > field_data.len() {
                    break;
                }

                let field_data_bytes = field_data[offset..offset + field_size].to_vec();
                offset += field_size;

                transaction.fields.push(TransactionField {
                    field_type: FieldType::from(field_type_raw),
                    data: field_data_bytes,
                });
            }
        }

        Ok(transaction)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::constants::{FieldType, TransactionType, TRANSACTION_HEADER_SIZE};

    // ── TransactionField ──────────────────────────────────────────

    #[test]
    fn field_from_string_roundtrip() {
        let field = TransactionField::from_string(FieldType::UserName, "hello");
        assert_eq!(field.to_string().unwrap(), "hello");
    }

    #[test]
    fn field_from_string_macroman_encoding() {
        // "café" — the é (U+00E9) maps to MacRoman 0x8E
        let field = TransactionField::from_string(FieldType::Data, "café");
        // Should be MacRoman bytes, not UTF-8
        assert_eq!(field.data, vec![0x63, 0x61, 0x66, 0x8E]);
        // Decoding back should still produce the original string
        assert_eq!(field.to_string().unwrap(), "café");
    }

    #[test]
    fn field_from_string_ascii_unchanged() {
        // Pure ASCII is identical in both UTF-8 and MacRoman
        let field = TransactionField::from_string(FieldType::Data, "hello world");
        assert_eq!(field.data, b"hello world");
    }

    #[test]
    fn field_from_string_unmappable_preserves_macroman() {
        // Legacy sessions must not silently switch to UTF-8.
        let field = TransactionField::from_string(FieldType::Data, "日本語");
        assert_eq!(field.data, b"???");
    }

    #[test]
    fn field_from_encoded_string_xor() {
        let field = TransactionField::from_encoded_string(FieldType::UserPassword, "abc");
        // Each byte XOR 0xFF
        assert_eq!(field.data, vec![0x61 ^ 0xFF, 0x62 ^ 0xFF, 0x63 ^ 0xFF]);
    }

    #[test]
    fn field_u16_roundtrip() {
        let field = TransactionField::from_u16(FieldType::UserId, 42);
        assert_eq!(field.to_u16().unwrap(), 42);
    }

    #[test]
    fn field_u16_max() {
        let field = TransactionField::from_u16(FieldType::UserId, u16::MAX);
        assert_eq!(field.to_u16().unwrap(), u16::MAX);
    }

    #[test]
    fn field_u32_roundtrip() {
        let field = TransactionField::from_u32(FieldType::FileSize, 123456);
        assert_eq!(field.to_u32().unwrap(), 123456);
    }

    #[test]
    fn field_u64_roundtrip() {
        let field = TransactionField::from_u64(FieldType::TransferSize, 9_876_543_210);
        assert_eq!(field.to_u64().unwrap(), 9_876_543_210);
    }

    #[test]
    fn field_u16_wrong_size() {
        let field = TransactionField::new(FieldType::UserId, vec![0, 0, 0]);
        assert!(field.to_u16().is_err());
    }

    #[test]
    fn field_u32_wrong_size() {
        let field = TransactionField::new(FieldType::FileSize, vec![0]);
        assert!(field.to_u32().is_err());
    }

    #[test]
    fn field_u64_wrong_size() {
        let field = TransactionField::new(FieldType::TransferSize, vec![0; 4]);
        assert!(field.to_u64().is_err());
    }

    #[test]
    fn field_capability_bits_2_bytes() {
        let field = TransactionField::new(FieldType::Capabilities, vec![0x00, 0x11]);
        assert_eq!(field.to_capability_bits().unwrap(), 0x11);
    }

    #[test]
    fn field_capability_bits_4_bytes() {
        let field = TransactionField::new(
            FieldType::Capabilities,
            vec![0x00, 0x00, 0x00, 0x11],
        );
        assert_eq!(field.to_capability_bits().unwrap(), 0x11);
    }

    #[test]
    fn field_capability_bits_8_bytes() {
        let field = TransactionField::new(
            FieldType::Capabilities,
            vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x11],
        );
        assert_eq!(field.to_capability_bits().unwrap(), 0x11);
    }

    #[test]
    fn field_capability_bits_high_byte() {
        // Bit 5 (0x20) — verify byte ordering / right-alignment
        let field = TransactionField::new(FieldType::Capabilities, vec![0x00, 0x20]);
        assert_eq!(field.to_capability_bits().unwrap(), 0x20);
    }

    #[test]
    fn field_from_capability_bits_picks_2_bytes_when_fits() {
        let field = TransactionField::from_capability_bits(FieldType::Capabilities, 0x19);
        assert_eq!(field.data, vec![0x00, 0x19]);
    }

    #[test]
    fn field_from_capability_bits_picks_4_bytes_when_needed() {
        let field = TransactionField::from_capability_bits(
            FieldType::Capabilities,
            0x0001_0000,
        );
        assert_eq!(field.data, vec![0x00, 0x01, 0x00, 0x00]);
    }

    #[test]
    fn field_from_capability_bits_picks_8_bytes_for_high_bits() {
        let field = TransactionField::from_capability_bits(
            FieldType::Capabilities,
            0x0001_0000_0000,
        );
        assert_eq!(field.data, vec![0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn field_capability_bits_invalid_width() {
        // 3-byte width is not accepted
        let field = TransactionField::new(FieldType::Capabilities, vec![0x00, 0x00, 0x11]);
        assert!(field.to_capability_bits().is_err());

        // 0-byte width is not accepted
        let field = TransactionField::new(FieldType::Capabilities, vec![]);
        assert!(field.to_capability_bits().is_err());
    }

    #[test]
    fn field_encode_format() {
        let field = TransactionField::from_u16(FieldType::UserId, 1);
        let encoded = field.encode();
        // field_type (2) + field_size (2) + data (2) = 6 bytes
        assert_eq!(encoded.len(), 6);
        // First 2 bytes: field type (UserId = 103)
        assert_eq!(u16::from_be_bytes([encoded[0], encoded[1]]), 103);
        // Next 2 bytes: data length (2)
        assert_eq!(u16::from_be_bytes([encoded[2], encoded[3]]), 2);
    }

    #[test]
    fn field_from_path_encoding() {
        let path = vec!["folder".to_string(), "subfolder".to_string()];
        let field = TransactionField::from_path(FieldType::FilePath, &path);
        // First 2 bytes: count of components (2)
        assert_eq!(u16::from_be_bytes([field.data[0], field.data[1]]), 2);
    }

    #[test]
    fn field_string_with_carriage_returns() {
        let field = TransactionField::from_string(FieldType::Data, "line1\rline2\rline3");
        let result = field.to_string().unwrap();
        assert_eq!(result, "line1\nline2\nline3");
    }

    #[test]
    fn utf8_paths_use_encoded_byte_lengths_and_whole_characters() {
        let path = vec!["é".repeat(128), "日本語".to_string()];
        let field = TransactionField::from_path_with(FieldType::FilePath, &path, TextEncoding::Utf8);
        assert_eq!(field.data[4], 254);
        assert_eq!(std::str::from_utf8(&field.data[5..259]).unwrap(), "é".repeat(127));
        assert_eq!(field.data[261], 9);
        assert_eq!(&field.data[262..], "日本語".as_bytes());
    }

    // ── Transaction ───────────────────────────────────────────────

    #[test]
    fn transaction_encode_decode_roundtrip() {
        let mut tx = Transaction::new(42, TransactionType::SendChat);
        tx.add_field(TransactionField::from_string(FieldType::Data, "Hello!"));
        tx.add_field(TransactionField::from_u16(FieldType::UserId, 7));

        let encoded = tx.encode();
        let decoded = Transaction::decode(&encoded).unwrap();

        assert_eq!(decoded.id, 42);
        assert_eq!(decoded.transaction_type, TransactionType::SendChat);
        assert_eq!(decoded.fields.len(), 2);
        assert_eq!(decoded.fields[0].to_string().unwrap(), "Hello!");
        assert_eq!(decoded.fields[1].to_u16().unwrap(), 7);
    }

    #[test]
    fn transaction_empty_fields() {
        let tx = Transaction::new(1, TransactionType::Login);
        let encoded = tx.encode();
        let decoded = Transaction::decode(&encoded).unwrap();

        assert_eq!(decoded.id, 1);
        assert_eq!(decoded.transaction_type, TransactionType::Login);
        assert!(decoded.fields.is_empty());
    }

    #[test]
    fn transaction_header_size() {
        let tx = Transaction::new(1, TransactionType::Reply);
        let encoded = tx.encode();
        // Header (20) + field count (2) = 22 bytes minimum
        assert!(encoded.len() >= TRANSACTION_HEADER_SIZE);
    }

    #[test]
    fn transaction_flags_and_error_code() {
        let mut tx = Transaction::new(99, TransactionType::Error);
        tx.flags = 1;
        tx.is_reply = 1;
        tx.error_code = 500;

        let encoded = tx.encode();
        let decoded = Transaction::decode(&encoded).unwrap();

        assert_eq!(decoded.flags, 1);
        assert_eq!(decoded.is_reply, 1);
        assert_eq!(decoded.error_code, 500);
    }

    #[test]
    fn transaction_decode_too_short() {
        let data = vec![0u8; 10]; // Less than TRANSACTION_HEADER_SIZE
        assert!(Transaction::decode(&data).is_err());
    }

    /// Golden byte vector: pins the exact wire layout of an encoded
    /// transaction. A round-trip test can't catch a symmetric encode/decode
    /// bug (e.g. two header fields swapped in both directions) — this can.
    #[test]
    fn transaction_encode_golden_bytes() {
        let mut tx = Transaction::new(0x2A, TransactionType::SendChat); // 105
        tx.add_field(TransactionField::from_string(FieldType::Data, "hi")); // 101

        let expected: Vec<u8> = vec![
            0x00, // flags
            0x00, // is_reply
            0x00, 0x69, // type = 105 (SendChat)
            0x00, 0x00, 0x00, 0x2A, // id = 42
            0x00, 0x00, 0x00, 0x00, // error_code = 0
            0x00, 0x00, 0x00, 0x08, // total_size = field section (8 bytes)
            0x00, 0x00, 0x00, 0x08, // data_size = field section (8 bytes)
            0x00, 0x01, // field count = 1
            0x00, 0x65, // field type = 101 (Data)
            0x00, 0x02, // field size = 2
            b'h', b'i',
        ];
        assert_eq!(tx.encode(), expected);
    }

    #[test]
    fn transaction_decode_truncated_field_is_dropped_not_panicking() {
        let mut tx = Transaction::new(7, TransactionType::SendChat);
        tx.add_field(TransactionField::from_string(FieldType::Data, "hello"));
        let mut encoded = tx.encode();
        // Chop the last 3 bytes of field data: the decoder must not panic and
        // must not return a phantom field with out-of-bounds data.
        encoded.truncate(encoded.len() - 3);
        if let Ok(decoded) = Transaction::decode(&encoded) {
            for f in &decoded.fields {
                assert!(f.data.len() <= 5, "field data must not exceed available bytes");
            }
        }
    }

    #[test]
    fn transaction_decode_lying_field_size_does_not_panic() {
        let mut tx = Transaction::new(7, TransactionType::SendChat);
        tx.add_field(TransactionField::from_string(FieldType::Data, "hello"));
        let mut encoded = tx.encode();
        // Overwrite the field-size u16 (bytes 24-25: header 20 + count 2 +
        // field type 2) with a size far beyond the buffer.
        encoded[24] = 0xFF;
        encoded[25] = 0xFF;
        // Must not panic; a decoded result must not contain phantom bytes.
        if let Ok(decoded) = Transaction::decode(&encoded) {
            for f in &decoded.fields {
                assert!(f.data.len() <= 5, "field data must not exceed available bytes");
            }
        }
    }

    #[test]
    fn transaction_get_field() {
        let mut tx = Transaction::new(1, TransactionType::SendChat);
        tx.add_field(TransactionField::from_string(FieldType::Data, "msg"));
        tx.add_field(TransactionField::from_u16(FieldType::ChatId, 5));

        assert!(tx.get_field(FieldType::Data).is_some());
        assert!(tx.get_field(FieldType::ChatId).is_some());
        assert!(tx.get_field(FieldType::UserName).is_none());
    }
}
