//! Pull-based custom GIF icons, independent of the classic icon number.
use super::{HotlineClient, media::{MediaLimits, validate_image}};
use crate::protocol::{constants::*, transaction::{Transaction, TransactionField}};
use base64::Engine;
use serde::Serialize;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifIcon { pub user_id: u16, pub url: Option<String> }

fn gif_url(bytes: &[u8]) -> Result<Option<String>, String> {
    if bytes.is_empty() { return Ok(None); }
    validate_image(bytes, "image/gif", MediaLimits {
        max_bytes: 32768, max_dimension: 256, max_pixels: 65536,
        max_frames: 60, max_duration_ms: 15000, chunk_size: 32768,
    })?;
    Ok(Some(format!("data:image/gif;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

fn parse_list(reply: Transaction) -> Result<Vec<GifIcon>, String> {
    let mut icons = Vec::new();
    for field in reply.fields.iter().filter(|f| f.field_type == FieldType::GifIconListEntry).take(256) {
        let bytes = &field.data;
        if bytes.len() < 4 { return Err("Truncated avatar entry".into()); }
        let user_id = u16::from_be_bytes(bytes[..2].try_into().unwrap());
        let length = u16::from_be_bytes(bytes[2..4].try_into().unwrap()) as usize;
        if bytes.len() != length + 4 { return Err("Invalid avatar entry length".into()); }
        // A malformed image cannot prevent valid avatars in the list from loading.
        if let Ok(url) = gif_url(&bytes[4..]) { icons.push(GifIcon { user_id, url }); }
    }
    Ok(icons)
}

impl HotlineClient {
    async fn icon_request(&self, kind: TransactionType, fields: Vec<TransactionField>) -> Result<Transaction, String> {
        let mut tx = Transaction::new(self.next_transaction_id(), kind);
        tx.fields = fields;
        let (sender, mut receiver) = mpsc::channel(1);
        self.pending_transactions.write().await.insert(tx.id, sender);
        let result = async {
            self.send_transaction(&tx).await?;
            let reply = tokio::time::timeout(std::time::Duration::from_secs(10), receiver.recv()).await
                .map_err(|_| "Avatar request timed out")?.ok_or("Avatar request disconnected")?;
            if reply.error_code != 0 {
                return Err(resolve_error_message(reply.error_code, reply.get_field(FieldType::ErrorText)
                    .and_then(|f| f.to_string_with(self.encoding()).ok())));
            }
            Ok(reply)
        }.await;
        self.pending_transactions.write().await.remove(&tx.id);
        result
    }

    pub async fn get_gif_icons(&self) -> Result<Vec<GifIcon>, String> {
        let reply = self.icon_request(TransactionType::GetGifIconList, vec![]).await?;
        tokio::task::spawn_blocking(move || parse_list(reply)).await.map_err(|e| e.to_string())?
    }

    pub async fn get_gif_icon(&self, user_id: u16) -> Result<GifIcon, String> {
        let reply = self.icon_request(TransactionType::GetGifIcon, vec![TransactionField::from_u16(FieldType::UserId, user_id)]).await?;
        if reply.get_field(FieldType::UserId).and_then(|f| f.to_u16().ok()) != Some(user_id) {
            return Err("Avatar reply identifies a different user".into());
        }
        let bytes = reply.get_field(FieldType::GifIconData).ok_or("Missing avatar data")?.data.clone();
        tokio::task::spawn_blocking(move || Ok(GifIcon { user_id, url: gif_url(&bytes)? }))
            .await.map_err(|e| e.to_string())?
    }

    pub async fn set_gif_icon(&self, bytes: Vec<u8>) -> Result<(), String> {
        let bytes = tokio::task::spawn_blocking(move || { gif_url(&bytes)?; Ok::<_, String>(bytes) })
            .await.map_err(|e| e.to_string())??;
        self.icon_request(TransactionType::SetGifIcon, vec![TransactionField::new(FieldType::GifIconData, bytes)]).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gif_validation_and_clear() {
        assert_eq!(gif_url(&[]).unwrap(), None);
        assert!(gif_url(b"GIF89a").is_err());
        assert!(gif_url(&vec![0; 32769]).is_err());
        let mut bytes = Vec::new();
        image::codecs::gif::GifEncoder::new(&mut bytes).encode(&[255, 0, 0, 255], 1, 1, image::ExtendedColorType::Rgba8).unwrap();
        assert!(gif_url(&bytes).unwrap().unwrap().starts_with("data:image/gif;base64,"));
        let mut reply = Transaction::new(1, TransactionType::GetGifIconList);
        let mut entry = vec![0, 42]; entry.extend_from_slice(&(bytes.len() as u16).to_be_bytes()); entry.extend_from_slice(&bytes);
        reply.add_field(TransactionField::new(FieldType::GifIconListEntry, entry));
        let icons = parse_list(reply).unwrap();
        assert_eq!(icons[0].user_id, 42);
    }
}
