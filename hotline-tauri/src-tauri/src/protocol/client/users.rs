use crate::protocol::types::{TextEncoding, decode_bytes};
// User management functionality for Hotline client

use super::HotlineClient;
use crate::protocol::constants::{FieldType, TransactionType, resolve_error_message};
use crate::protocol::transaction::{Transaction, TransactionField};
use std::time::Duration;
use tokio::sync::mpsc;

impl HotlineClient {
    pub async fn get_user_list(&self) -> Result<(), String> {
        println!("Requesting user list...");

        let transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetUserNameList);

        println!("Sending GetUserNameList transaction...");
        self.send_transaction(&transaction).await?;

        println!("GetUserNameList request sent");
        Ok(())
    }

    pub(crate) fn parse_user_info(data: &[u8], encoding: TextEncoding) -> Result<(u16, String, u16, u16, Option<u32>), String> {
        // UserNameWithInfo format:
        // 2 bytes: User ID
        // 2 bytes: Icon ID
        // 2 bytes: User flags
        // 2 bytes: Username length
        // N bytes: Username
        // 4 bytes: Nick color (optional, 0x00RRGGBB)

        if data.len() < 8 {
            return Err("UserNameWithInfo data too short".to_string());
        }

        let user_id = u16::from_be_bytes([data[0], data[1]]);
        let icon_id = u16::from_be_bytes([data[2], data[3]]);
        let flags = u16::from_be_bytes([data[4], data[5]]);
        let name_len = u16::from_be_bytes([data[6], data[7]]) as usize;

        if data.len() < 8 + name_len {
            return Err("UserNameWithInfo username data too short".to_string());
        }

        let username = decode_bytes(&data[8..8 + name_len], encoding);

        // Legacy Mobius convention: 4 trailing color bytes after the username in
        // UserNameWithInfo. The fogWraith canonical form is the standalone field
        // 0x0500 (DATA_COLOR) carried in 301/117 notifications. Per user-management
        // spec, when both forms are present in the same packet, 0x0500 wins —
        // but they don't collide here: this parser runs on Get User Name List
        // replies only, where no 0x0500 field exists. Kept indefinitely for
        // older Mobius-derived servers that don't emit 0x0500.
        let color = if data.len() >= 8 + name_len + 4 {
            let c = u32::from_be_bytes([
                data[8 + name_len],
                data[8 + name_len + 1],
                data[8 + name_len + 2],
                data[8 + name_len + 3],
            ]);
            // 0xFFFFFFFF means "no color"
            if c == 0xFFFFFFFF { None } else { Some(c) }
        } else {
            None
        };

        Ok((user_id, username, icon_id, flags, color))
    }

    /// Disconnect a user from the server (admin function)
    pub async fn disconnect_user(&self, user_id: u16, options: Option<u16>) -> Result<(), String> {
        println!("Disconnecting user {} with options: {:?}", user_id, options);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DisconnectUser);
        transaction.add_field(TransactionField::from_u16(FieldType::UserId, user_id));

        if let Some(opts) = options {
            transaction.add_field(TransactionField::from_u16(FieldType::Options, opts));
        }

        self.send_transaction(&transaction).await?;

        println!("DisconnectUser transaction sent successfully");
        Ok(())
    }

    /// Get client info text from the server for a specific user
    pub async fn get_client_info(&self, user_id: u16) -> Result<String, String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetClientInfoText);
        transaction.add_field(TransactionField::from_u16(FieldType::UserId, user_id));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);

        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => reply,
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Channel closed while waiting for client info reply".to_string());
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for client info reply".to_string());
            }
        };

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Get client info failed: {}", error_msg));
        }

        let info = reply
            .get_field(FieldType::Data)
            .and_then(|f| f.to_string_with(self.encoding()).ok())
            .unwrap_or_else(|| "No info available".to_string());

        Ok(info)
    }

    /// Get current user access permissions (local cache)
    pub fn get_user_access(&self) -> u64 {
        self.user_access.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Request own access privileges from the server (transaction 354)
    pub async fn request_user_access(&self) -> Result<Vec<u8>, String> {
        let transaction = Transaction::new(self.next_transaction_id(), TransactionType::UserAccess);

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("User access request failed: {}", error_msg));
                }
                let access_data = reply
                    .get_field(FieldType::UserAccess)
                    .map(|f| f.data.clone())
                    .unwrap_or_default();
                Ok(access_data)
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for user access reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for user access reply".to_string())
            }
        }
    }

    /// List all user accounts on the server (admin function, transaction 348)
    pub async fn list_user_accounts(&self) -> Result<Vec<UserAccountInfo>, String> {
        let transaction = Transaction::new(self.next_transaction_id(), TransactionType::ListUsers);

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("List users failed: {}", error_msg));
                }
                // Parse user account data from reply fields
                let mut accounts = Vec::new();
                for field in &reply.fields {
                    if field.field_type == FieldType::Data && field.data.len() >= 4 {
                        // Account data: 2 bytes login length + login + 2 bytes name length + name
                        let data = &field.data;
                        let mut offset = 0;
                        if offset + 2 > data.len() { continue; }
                        let login_len = u16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
                        offset += 2;
                        if offset + login_len > data.len() { continue; }
                        let login = decode_bytes(&data[offset..offset + login_len], self.encoding());
                        offset += login_len;
                        let name = if offset + 2 <= data.len() {
                            let name_len = u16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
                            offset += 2;
                            if offset + name_len <= data.len() {
                                decode_bytes(&data[offset..offset + name_len], self.encoding())
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        };
                        accounts.push(UserAccountInfo { login, name });
                    }
                }
                Ok(accounts)
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for list users reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for list users reply".to_string())
            }
        }
    }

    /// Update an existing user account (admin function, transaction 349)
    pub async fn update_user_account(
        &self,
        login: &str,
        name: Option<&str>,
        password: Option<&str>,
        access: Option<&[u8]>,
    ) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::UpdateUser);
        transaction.add_field(self.text_field(FieldType::UserLogin, login));

        if let Some(n) = name {
            transaction.add_field(self.text_field(FieldType::UserName, n));
        }
        if let Some(p) = password {
            transaction.add_field(TransactionField::new(FieldType::UserPassword, p.as_bytes().to_vec()));
        }
        if let Some(a) = access {
            transaction.add_field(TransactionField::new(FieldType::UserAccess, a.to_vec()));
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
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Update user failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for update user reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for update user reply".to_string())
            }
        }
    }

    /// Create a new user account (admin function, transaction 350)
    pub async fn create_user_account(
        &self,
        login: &str,
        name: &str,
        password: &str,
        access: &[u8],
    ) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::NewUser);
        transaction.add_field(self.text_field(FieldType::UserLogin, login));
        transaction.add_field(self.text_field(FieldType::UserName, name));
        transaction.add_field(TransactionField::new(FieldType::UserPassword, password.as_bytes().to_vec()));
        transaction.add_field(TransactionField::new(FieldType::UserAccess, access.to_vec()));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Create user failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for create user reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for create user reply".to_string())
            }
        }
    }

    /// Delete a user account (admin function, transaction 351)
    pub async fn delete_user_account(&self, login: &str) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DeleteUser);
        transaction.add_field(self.text_field(FieldType::UserLogin, login));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Delete user failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for delete user reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for delete user reply".to_string())
            }
        }
    }

    /// Get a user account's details (admin function, transaction 352)
    pub async fn get_user_account(&self, login: &str) -> Result<UserAccountDetails, String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetUser);
        transaction.add_field(self.text_field(FieldType::UserLogin, login));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(reply)) => {
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Get user failed: {}", error_msg));
                }
                let name = reply.get_field(FieldType::UserName).and_then(|f| f.to_string_with(self.encoding()).ok()).unwrap_or_default();
                let login = reply.get_field(FieldType::UserLogin).and_then(|f| f.to_string_with(self.encoding()).ok()).unwrap_or_default();
                let access = reply.get_field(FieldType::UserAccess).map(|f| f.data.clone()).unwrap_or_default();
                Ok(UserAccountDetails { login, name, access })
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for get user reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for get user reply".to_string())
            }
        }
    }

    /// Set a user account's details (admin function, transaction 353)
    pub async fn set_user_account(
        &self,
        login: &str,
        name: Option<&str>,
        password: Option<&str>,
        access: Option<&[u8]>,
    ) -> Result<(), String> {
        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::SetUser);
        transaction.add_field(self.text_field(FieldType::UserLogin, login));

        if let Some(n) = name {
            transaction.add_field(self.text_field(FieldType::UserName, n));
        }
        if let Some(p) = password {
            transaction.add_field(TransactionField::new(FieldType::UserPassword, p.as_bytes().to_vec()));
        }
        if let Some(a) = access {
            transaction.add_field(TransactionField::new(FieldType::UserAccess, a.to_vec()));
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
                if reply.error_code != 0 {
                    let server_text = reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok());
                    let error_msg = resolve_error_message(reply.error_code, server_text);
                    return Err(format!("Set user failed: {}", error_msg));
                }
                Ok(())
            }
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Channel closed while waiting for set user reply".to_string())
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                Err("Timeout waiting for set user reply".to_string())
            }
        }
    }
}

/// Basic user account info from ListUsers
#[derive(Debug, Clone, serde::Serialize)]
pub struct UserAccountInfo {
    pub login: String,
    pub name: String,
}

/// Detailed user account info from GetUser
#[derive(Debug, Clone, serde::Serialize)]
pub struct UserAccountDetails {
    pub login: String,
    pub name: String,
    pub access: Vec<u8>,
}
