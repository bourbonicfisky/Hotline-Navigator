// Chat functionality for Hotline client

use super::HotlineClient;
use crate::protocol::constants::{FieldType, TransactionType, resolve_error_message};
use crate::protocol::history::{self, HistoryEntry};
use crate::protocol::transaction::{Transaction, TransactionField};
use std::time::Duration;
use tokio::sync::mpsc;

/// Optional media handle to attach to a chat send. Carries hex handle + canonical MIME.
pub struct ChatMediaAttachment {
    pub handle_hex: String,
    pub mime: String,
}

fn add_media_fields(tx: &mut Transaction, media: &ChatMediaAttachment) -> Result<(), String> {
    let handle_bytes = crate::protocol::client::media::handle_from_hex(&media.handle_hex)?;
    tx.add_field(TransactionField::new(FieldType::ChatMediaId, handle_bytes));
    tx.add_field(TransactionField::from_string(
        FieldType::ChatMediaType,
        &media.mime,
    ));
    Ok(())
}

impl HotlineClient {
    pub async fn send_chat(&self, message: String) -> Result<(), String> {
        self.send_chat_with_media(message, None).await
    }

    pub async fn send_chat_with_media(
        &self,
        message: String,
        media: Option<ChatMediaAttachment>,
    ) -> Result<(), String> {
        println!("Sending chat: {}", message);

        if media.is_some() && !self.can_send_media() {
            return Err("Account does not have permission to send media".to_string());
        }
        if media.is_some() && !self.inline_media_supported() {
            return Err("Server does not support inline media".to_string());
        }

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SendChat);
        transaction.add_field(self.text_field(FieldType::Data, &message));
        transaction.add_field(TransactionField::from_u16(FieldType::ChatOptions, 0));
        if let Some(m) = media {
            add_media_fields(&mut transaction, &m)?;
        }

        self.send_transaction(&transaction).await?;

        println!("Chat sent successfully");
        Ok(())
    }

    pub async fn send_broadcast(&self, message: String) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::UserBroadcast);
        transaction.add_field(self.text_field(FieldType::Data, &message));

        self.send_transaction(&transaction).await
    }

    pub async fn send_private_message(&self, user_id: u16, message: String) -> Result<(), String> {
        self.send_private_message_with_media(user_id, message, None).await
    }

    pub async fn send_private_message_with_media(
        &self,
        user_id: u16,
        message: String,
        media: Option<ChatMediaAttachment>,
    ) -> Result<(), String> {
        println!("Sending private message to user {}: {}", user_id, message);

        if media.is_some() && !self.can_send_media() {
            return Err("Account does not have permission to send media".to_string());
        }
        if media.is_some() && !self.inline_media_supported() {
            return Err("Server does not support inline media".to_string());
        }

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SendInstantMessage);
        transaction.add_field(TransactionField::from_u16(FieldType::UserId, user_id));
        transaction.add_field(TransactionField::from_u32(FieldType::Options, 1));
        transaction.add_field(self.text_field(FieldType::Data, &message));
        if let Some(m) = media {
            add_media_fields(&mut transaction, &m)?;
        }

        self.send_transaction(&transaction).await?;

        println!("Private message sent successfully");
        Ok(())
    }

    pub async fn send_set_client_user_info(&self, username: &str, icon_id: u16, color: Option<u32>) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SetClientUserInfo);
        transaction.add_field(self.text_field(FieldType::UserName, username));
        transaction.add_field(TransactionField::from_u16(FieldType::UserIconId, icon_id));
        transaction.add_field(TransactionField::from_u16(FieldType::Options, 0));

        if let Some(c) = color {
            transaction.add_field(TransactionField::from_u32(FieldType::NickColor, c));
        }

        self.send_transaction(&transaction).await?;

        // Update local state
        *self.username.lock().await = username.to_string();
        *self.user_icon_id.lock().await = icon_id;

        Ok(())
    }

    /// Invite a user to a new private chat room. Returns the chat_id.
    pub async fn invite_to_new_chat(&self, user_id: u16) -> Result<u32, String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::InviteToNewChat);
        transaction.add_field(TransactionField::from_u16(FieldType::UserId, user_id));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);

                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    return Err(resolve_error_message(reply.error_code, server_text));
                }

                let chat_id = reply
                    .get_field(FieldType::ChatId)
                    .and_then(|f| f.to_u32().ok())
                    .ok_or_else(|| "No chat ID in reply".to_string())?;

                Ok(chat_id)
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for chat invite reply".to_string())
            }
        }
    }

    /// Invite a user to an existing private chat room.
    pub async fn invite_to_chat(&self, chat_id: u32, user_id: u16) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::InviteToChat);
        transaction.add_field(TransactionField::from_u32(FieldType::ChatId, chat_id));
        transaction.add_field(TransactionField::from_u16(FieldType::UserId, user_id));
        self.send_transaction(&transaction).await
    }

    /// Reject a chat invite.
    pub async fn reject_chat_invite(&self, chat_id: u32) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::RejectChatInvite);
        transaction.add_field(TransactionField::from_u32(FieldType::ChatId, chat_id));
        self.send_transaction(&transaction).await
    }

    /// Join a private chat room. Returns the subject and user list (id, name, icon, flags, color).
    pub async fn join_chat(&self, chat_id: u32) -> Result<(String, Vec<(u16, String, u16, u16, Option<u32>)>), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::JoinChat);
        transaction.add_field(TransactionField::from_u32(FieldType::ChatId, chat_id));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);

                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    return Err(resolve_error_message(reply.error_code, server_text));
                }

                let subject = reply
                    .get_field(FieldType::ChatSubject)
                    .and_then(|f| f.to_string_with(self.encoding()).ok())
                    .unwrap_or_default();

                // Parse user list from UserNameWithInfo fields
                let users: Vec<(u16, String, u16, u16, Option<u32>)> = reply.fields.iter()
                    .filter(|f| f.field_type == FieldType::UserNameWithInfo)
                    .filter_map(|f| {
                        Self::parse_user_info(&f.data, self.encoding()).ok()
                    })
                    .collect();

                Ok((subject, users))
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for join chat reply".to_string())
            }
        }
    }

    /// Leave a private chat room.
    pub async fn leave_chat(&self, chat_id: u32) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::LeaveChat);
        transaction.add_field(TransactionField::from_u32(FieldType::ChatId, chat_id));
        self.send_transaction(&transaction).await
    }

    /// Set the subject of a private chat room.
    pub async fn set_chat_subject(&self, chat_id: u32, subject: String) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SetChatSubject);
        transaction.add_field(TransactionField::from_u32(FieldType::ChatId, chat_id));
        transaction.add_field(self.text_field(FieldType::ChatSubject, &subject));
        self.send_transaction(&transaction).await
    }

    /// Request chat history from the server (transaction 700).
    ///
    /// Returns a vec of parsed history entries (oldest-first) and a `has_more` flag.
    /// `channel_id` is always 0 for public chat.
    pub async fn get_chat_history(
        &self,
        channel_id: u32,
        before: Option<u64>,
        after: Option<u64>,
        limit: Option<u16>,
    ) -> Result<(Vec<HistoryEntry>, bool), String> {
        println!("Requesting chat history: channel={}, before={:?}, after={:?}, limit={:?}", channel_id, before, after, limit);
        self.emit_protocol_log("info", format!(
            "Requesting chat history (channel={}, before={:?}, after={:?}, limit={:?})",
            channel_id, before, after, limit
        ));

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetChatHistory);
        transaction.add_field(TransactionField::from_u32(FieldType::ChannelId, channel_id));

        if let Some(b) = before {
            transaction.add_field(TransactionField::from_u64(FieldType::HistoryBefore, b));
        }
        if let Some(a) = after {
            transaction.add_field(TransactionField::from_u64(FieldType::HistoryAfter, a));
        }
        if let Some(l) = limit {
            transaction.add_field(TransactionField::from_u16(FieldType::HistoryLimit, l));
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
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);

                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    return Err(resolve_error_message(reply.error_code, server_text));
                }

                // Parse all DATA_HISTORY_ENTRY (0x0F05) fields
                let entries: Vec<HistoryEntry> = reply.fields.iter()
                    .filter(|f| f.field_type == FieldType::HistoryEntry)
                    .filter_map(|f| {
                        match history::parse_history_entry_with(&f.data, self.encoding()) {
                            Ok(entry) => Some(entry),
                            Err(e) => {
                                println!("Warning: failed to parse history entry: {}", e);
                                None
                            }
                        }
                    })
                    .collect();

                // Extract has_more flag (default false if absent)
                let has_more = reply
                    .get_field(FieldType::HistoryHasMore)
                    .map(|f| {
                        if f.data.is_empty() { false }
                        else { f.data[0] != 0 }
                    })
                    .unwrap_or(false);

                println!("Chat history reply: {} entries, has_more={}", entries.len(), has_more);
                self.emit_protocol_log("info", format!(
                    "Chat history received: {} entries, has_more={}",
                    entries.len(), has_more
                ));

                Ok((entries, has_more))
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                println!("Chat history request failed: channel closed");
                Err("Channel closed".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                println!("Chat history request failed: timeout");
                Err("Timeout waiting for chat history reply".to_string())
            }
        }
    }

    /// Send a chat message to a private chat room.
    pub async fn send_private_chat_message(&self, chat_id: u32, message: String) -> Result<(), String> {
        self.send_private_chat_message_with_media(chat_id, message, None).await
    }

    pub async fn send_private_chat_message_with_media(
        &self,
        chat_id: u32,
        message: String,
        media: Option<ChatMediaAttachment>,
    ) -> Result<(), String> {
        if media.is_some() && !self.can_send_media() {
            return Err("Account does not have permission to send media".to_string());
        }
        if media.is_some() && !self.inline_media_supported() {
            return Err("Server does not support inline media".to_string());
        }

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SendChat);
        transaction.add_field(self.text_field(FieldType::Data, &message));
        transaction.add_field(TransactionField::from_u32(FieldType::ChatId, chat_id));
        transaction.add_field(TransactionField::from_u16(FieldType::ChatOptions, 0));
        if let Some(m) = media {
            add_media_fields(&mut transaction, &m)?;
        }
        self.send_transaction(&transaction).await
    }

    pub async fn accept_agreement(&self) -> Result<(), String> {
        use std::time::Duration;
        use tokio::sync::mpsc;

        println!("Sending agreement acceptance...");

        let username = {
            let username_guard = self.username.lock().await;
            username_guard.clone()
        };

        let user_icon_id = {
            let icon_guard = self.user_icon_id.lock().await;
            *icon_guard
        };

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::Agreed);
        transaction.add_field(self.text_field(FieldType::UserName, &username));
        transaction.add_field(TransactionField::from_u16(FieldType::UserIconId, user_icon_id));
        transaction.add_field(TransactionField::from_u16(FieldType::Options, 0));

        let transaction_id = transaction.id;

        // Create channel to receive reply (if any)
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        // Wait for reply (but handle empty replies gracefully)
        println!("Waiting for Agreed reply...");
        match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Some(_reply)) => {
                println!("Agreed reply received (may be empty, that's OK)");
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
            }
            Ok(None) => {
                println!("Agreed channel closed (empty reply, that's OK)");
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
            }
            Err(_) => {
                println!("Agreed timeout (empty reply, that's OK)");
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
            }
        }

        println!("Agreement accepted successfully");

        // CRITICAL: Call GetUserNameList immediately after Agreed
        println!("Requesting user list after agreement acceptance...");
        self.get_user_list().await?;

        Ok(())
    }
}
