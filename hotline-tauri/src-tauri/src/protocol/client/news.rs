use crate::protocol::types::{TextEncoding, decode_bytes};
// News and message board functionality for Hotline client

use super::HotlineClient;
use crate::protocol::constants::{FieldType, TransactionType, resolve_error_message};
use crate::protocol::transaction::{Transaction, TransactionField};
use crate::protocol::types::{NewsArticle, NewsCategory};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::protocol::dates::decode_hotline_date;

impl HotlineClient {
    pub async fn get_message_board(&self) -> Result<Vec<String>, String> {
        println!("Requesting message board");

        let transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetMessageBoard);
        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);

        // Register pending transaction
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        // Wait for reply
        let reply = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .map_err(|_| "Timeout waiting for message board reply".to_string())?
            .ok_or("Channel closed".to_string())?;

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Get message board failed: {}", error_msg));
        }

        let raw_data = reply
            .get_field(FieldType::Data)
            .map(|f| f.data.clone())
            .unwrap_or_default();

        let posts = parse_message_board_data(&raw_data, self.encoding());

        println!("Received message board: {} posts", posts.len());

        Ok(posts)
    }

    pub async fn post_message_board(&self, text: String) -> Result<(), String> {
        println!("Posting to message board: {} chars", text.len());

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::OldPostNews);
        transaction.add_field(self.text_field(FieldType::Data, &text));

        self.send_transaction(&transaction).await?;

        println!("Message board post sent successfully");
        Ok(())
    }

    pub async fn get_news_categories(&self, path: Vec<String>) -> Result<Vec<NewsCategory>, String> {
        println!("Requesting news categories for path: {:?}", path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetNewsCategoryList);
        if !path.is_empty() {
            transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);

        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await.map_err(|e| {
            // Clean up will happen on timeout below
            format!("Failed to send request: {}", e)
        })?;

        let reply = match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Some(reply)) => reply,
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Channel closed while waiting for news categories reply".to_string());
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for news categories reply (server may not support news)".to_string());
            }
        };

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            if reply.error_code == 1 || error_msg.to_lowercase().contains("not supported") {
                return Err("News is not supported on this server".to_string());
            }
            return Err(format!("Get news categories failed: {}", error_msg));
        }

        let mut categories = Vec::new();
        for field in &reply.fields {
            if field.field_type == FieldType::NewsCategoryListData15 {
                // v1.5+ hierarchical format
                if let Ok(category) = self.parse_news_category(&field.data, &path) {
                    categories.push(category);
                }
            } else if field.field_type == FieldType::NewsCategoryListData {
                // Pre-v1.5 flat format — parse as a simple named bundle
                if let Ok(category) = self.parse_news_category_legacy(&field.data, &path) {
                    categories.push(category);
                }
            }
        }

        println!("Received {} news categories (reply had {} fields)", categories.len(), reply.fields.len());

        Ok(categories)
    }

    pub async fn get_news_articles(&self, path: Vec<String>) -> Result<Vec<NewsArticle>, String> {
        println!("Requesting news articles for path: {:?}", path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetNewsArticleList);
        if !path.is_empty() {
            transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        }

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);

        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Some(reply)) => reply,
            Ok(None) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Channel closed while waiting for news articles reply".to_string());
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for news articles reply (server may not support news)".to_string());
            }
        };

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            if reply.error_code == 1 || error_msg.to_lowercase().contains("not supported") {
                return Err("News is not supported on this server".to_string());
            }
            return Err(format!("Get news articles failed: {}", error_msg));
        }

        let articles = if let Some(field) = reply.get_field(FieldType::NewsArticleListData) {
            self.parse_news_article_list(&field.data, &path)?
        } else {
            Vec::new()
        };

        println!("Received {} news articles (reply had {} fields)", articles.len(), reply.fields.len());

        Ok(articles)
    }

    pub async fn get_news_article_data(&self, article_id: u32, path: Vec<String>) -> Result<String, String> {
        println!("Requesting news article data for ID {} at path: {:?}", article_id, path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::GetNewsArticleData);
        transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        transaction.add_field(TransactionField::from_u32(FieldType::NewsArticleId, article_id));
        transaction.add_field(self.text_field(FieldType::NewsArticleDataFlavor, "text/plain"));

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
                return Err("Channel closed while waiting for news article data reply".to_string());
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for news article data reply".to_string());
            }
        };

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            return Err(format!("Get news article data failed: {}", error_msg));
        }

        // Some servers (e.g. Lemoniscate) have been seen replying without a
        // usable NewsArticleData (333) field; also accept the generic Data
        // (101) field as a fallback before giving up.
        let content = reply
            .get_field(FieldType::NewsArticleData)
            .or_else(|| reply.get_field(FieldType::Data))
            .and_then(|f| f.to_string_with(self.encoding()).ok())
            .unwrap_or_default();

        if content.is_empty() && !reply.fields.is_empty() {
            // Diagnostic: list what the server actually sent. Note unknown
            // field IDs decode as ErrorText (FieldType::from fallback), so a
            // non-standard article-data field would show up mislabeled here.
            let fields_desc: Vec<String> = reply
                .fields
                .iter()
                .map(|f| {
                    let preview: String = f
                        .to_string()
                        .unwrap_or_default()
                        .chars()
                        .take(40)
                        .collect();
                    format!("{:?}[{} bytes]{}{}", f.field_type, f.data.len(),
                        if preview.is_empty() { "" } else { ": " }, preview)
                })
                .collect();
            self.emit_protocol_log(
                "warn",
                format!(
                    "News article {} reply had no article text; fields: {}",
                    article_id,
                    fields_desc.join(", ")
                ),
            );
        }

        println!("Received news article content: {} chars", content.len());

        Ok(content)
    }

    pub async fn post_news_article(&self, title: String, text: String, path: Vec<String>, parent_id: u32) -> Result<(), String> {
        println!("Posting news article '{}' to path: {:?}", title, path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::PostNewsArticle);
        transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        transaction.add_field(TransactionField::from_u32(FieldType::NewsArticleId, parent_id));
        transaction.add_field(self.text_field(FieldType::NewsArticleTitle, &title));
        transaction.add_field(self.text_field(FieldType::NewsArticleDataFlavor, "text/plain"));
        transaction.add_field(TransactionField::from_u32(FieldType::NewsArticleFlags, 0));
        transaction.add_field(self.text_field(FieldType::NewsArticleData, &text));

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
                return Err("Channel closed while waiting for post news article reply".to_string());
            }
            Err(_) => {
                let mut pending = self.pending_transactions.write().await;
                pending.remove(&transaction_id);
                return Err("Timeout waiting for post news article reply".to_string());
            }
        };

        if reply.error_code != 0 {
            let server_text = reply
                .get_field(FieldType::ErrorText)
                .and_then(|f| f.to_string_with(self.encoding()).ok());
            let error_msg = resolve_error_message(reply.error_code, server_text);
            println!("Post news article error: code={}, message={}", reply.error_code, error_msg);
            return Err(format!("Post news article failed: {}", error_msg));
        }

        println!("News article posted successfully");

        Ok(())
    }

    pub async fn create_news_category(&self, path: Vec<String>, name: String) -> Result<(), String> {
        println!("Creating news category '{}' at path: {:?}", name, path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::NewNewsCategory);
        if !path.is_empty() {
            transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        }
        transaction.add_field(self.text_field(FieldType::NewsCategoryName, &name));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(r)) => r,
            Ok(None) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Channel closed".to_string()); }
            Err(_) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Timeout".to_string()); }
        };

        if reply.error_code != 0 {
            let msg = resolve_error_message(reply.error_code, reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok()));
            return Err(format!("Create news category failed: {}", msg));
        }
        println!("News category '{}' created", name);
        Ok(())
    }

    pub async fn create_news_folder(&self, path: Vec<String>, name: String) -> Result<(), String> {
        println!("Creating news folder '{}' at path: {:?}", name, path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::NewNewsFolder);
        if !path.is_empty() {
            transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        }
        transaction.add_field(self.text_field(FieldType::FileName, &name));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(r)) => r,
            Ok(None) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Channel closed".to_string()); }
            Err(_) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Timeout".to_string()); }
        };

        if reply.error_code != 0 {
            let msg = resolve_error_message(reply.error_code, reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok()));
            return Err(format!("Create news folder failed: {}", msg));
        }
        println!("News folder '{}' created", name);
        Ok(())
    }

    pub async fn delete_news_item(&self, path: Vec<String>) -> Result<(), String> {
        println!("Deleting news item at path: {:?}", path);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DeleteNewsItem);
        transaction.add_field(self.path_field(FieldType::NewsPath, &path));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(r)) => r,
            Ok(None) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Channel closed".to_string()); }
            Err(_) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Timeout".to_string()); }
        };

        if reply.error_code != 0 {
            let msg = resolve_error_message(reply.error_code, reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok()));
            return Err(format!("Delete news item failed: {}", msg));
        }
        println!("News item deleted at path: {:?}", path);
        Ok(())
    }

    pub async fn delete_news_article(&self, path: Vec<String>, article_id: u32, recursive: bool) -> Result<(), String> {
        println!("Deleting news article {} at path: {:?} (recursive: {})", article_id, path, recursive);

        let mut transaction = Transaction::new(self.next_transaction_id(), TransactionType::DeleteNewsArticle);
        transaction.add_field(self.path_field(FieldType::NewsPath, &path));
        transaction.add_field(TransactionField::from_u32(FieldType::NewsArticleId, article_id));
        transaction.add_field(TransactionField::from_u16(FieldType::NewsArticleRecursiveDelete, if recursive { 1 } else { 0 }));

        let transaction_id = transaction.id;
        let (tx, mut rx) = mpsc::channel(1);
        {
            let mut pending = self.pending_transactions.write().await;
            pending.insert(transaction_id, tx);
        }

        self.send_transaction(&transaction).await?;

        let reply = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(r)) => r,
            Ok(None) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Channel closed".to_string()); }
            Err(_) => { let mut p = self.pending_transactions.write().await; p.remove(&transaction_id); return Err("Timeout".to_string()); }
        };

        if reply.error_code != 0 {
            let msg = resolve_error_message(reply.error_code, reply.get_field(FieldType::ErrorText).and_then(|f| f.to_string_with(self.encoding()).ok()));
            return Err(format!("Delete news article failed: {}", msg));
        }
        println!("News article {} deleted", article_id);
        Ok(())
    }

    /// Parse a legacy NewsCategoryListData (field 320) entry.
    /// Pre-v1.5 servers send a simpler flat format: the first bytes are a
    /// PString (1-byte length + name).  We treat each entry as a bundle
    /// (category_type 2) with count 0.
    fn parse_news_category_legacy(&self, data: &[u8], parent_path: &[String]) -> Result<NewsCategory, String> {
        if data.is_empty() {
            return Err("Legacy category data empty".to_string());
        }
        let name_len = data[0] as usize;
        if data.len() < 1 + name_len {
            return Err("Legacy category name too short".to_string());
        }
        let decoded = decode_bytes(&data[1..1 + name_len], self.encoding());
        let name = decoded.to_string();

        let mut path = parent_path.to_vec();
        path.push(name.clone());

        Ok(NewsCategory {
            category_type: 2, // treat as bundle
            count: 0,
            name,
            path,
        })
    }

    // Helper method to parse a single news category from binary data
    fn parse_news_category(&self, data: &[u8], parent_path: &[String]) -> Result<NewsCategory, String> {
        if data.len() < 4 {
            return Err("Category data too short".to_string());
        }

        let category_type = u16::from_be_bytes([data[0], data[1]]);
        let count = u16::from_be_bytes([data[2], data[3]]);

        let name = if category_type == 2 {
            // Bundle: PString at offset 4
            if data.len() < 5 {
                return Err("Bundle data too short".to_string());
            }
            let name_len = data[4] as usize;
            if data.len() < 5 + name_len {
                return Err("Bundle name too short".to_string());
            }
            decode_bytes(&data[5..5 + name_len], self.encoding())
        } else if category_type == 3 {
            // Category: PString at offset 28
            if data.len() < 29 {
                return Err("Category data too short".to_string());
            }
            let name_len = data[28] as usize;
            if data.len() < 29 + name_len {
                return Err("Category name too short".to_string());
            }
            let decoded = decode_bytes(&data[29..29 + name_len], self.encoding());
            decoded.to_string()
        } else {
            return Err(format!("Unknown category type: {}", category_type));
        };

        let mut path = parent_path.to_vec();
        path.push(name.clone());

        Ok(NewsCategory {
            category_type,
            count,
            name,
            path,
        })
    }

    // Helper method to parse news article list from binary data
    fn parse_news_article_list(&self, data: &[u8], parent_path: &[String]) -> Result<Vec<NewsArticle>, String> {
        if data.len() < 8 {
            return Err("Article list data too short".to_string());
        }

        let mut offset = 0;

        let article_count = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
        offset += 8;

        // Skip list name and description (PStrings)
        if offset >= data.len() {
            return Ok(Vec::new());
        }
        let name_len = data[offset] as usize;
        offset += 1 + name_len;

        if offset >= data.len() {
            return Ok(Vec::new());
        }
        let desc_len = data[offset] as usize;
        offset += 1 + desc_len;

        // Parse articles
        let mut articles = Vec::new();
        for _ in 0..article_count {
            if offset + 20 > data.len() {
                break;
            }

            let article_id = u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
            offset += 4;

            // Parse date (8 bytes). Two wire formats per fogWraith spec —
            // see `decode_hotline_date`.
            let date_str = if offset + 8 <= data.len() {
                let year = u16::from_be_bytes([data[offset], data[offset + 1]]);
                let _ms = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
                let secs = u32::from_be_bytes([
                    data[offset + 4],
                    data[offset + 5],
                    data[offset + 6],
                    data[offset + 7],
                ]);
                decode_hotline_date(year, secs)
            } else {
                None
            };
            offset += 8;

            let parent_id = u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
            offset += 4;

            let flags = u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
            offset += 4;

            if offset + 3 > data.len() {
                break;
            }

            let flavor_count = u16::from_be_bytes([data[offset], data[offset + 1]]);
            offset += 2;

            let title_len = data[offset] as usize;
            offset += 1;

            if offset + title_len > data.len() {
                break;
            }
            let title_decoded = decode_bytes(&data[offset..offset + title_len], self.encoding());
            let title = title_decoded.to_string();
            offset += title_len;

            if offset >= data.len() {
                break;
            }
            let poster_len = data[offset] as usize;
            offset += 1;

            if offset + poster_len > data.len() {
                break;
            }
            let poster_decoded = decode_bytes(&data[offset..offset + poster_len], self.encoding());
            let poster = poster_decoded.to_string();
            offset += poster_len;

            // Skip flavors
            for _ in 0..flavor_count {
                if offset >= data.len() {
                    break;
                }
                let flavor_len = data[offset] as usize;
                offset += 1;

                if offset + flavor_len + 2 > data.len() {
                    break;
                }
                offset += flavor_len;

                // Skip article size
                offset += 2;
            }

            articles.push(NewsArticle {
                id: article_id,
                parent_id,
                flags,
                title,
                poster,
                date: date_str,
                path: parent_path.to_vec(),
            });
        }

        Ok(articles)
    }
}

// --- Message board parsing helpers ---
// Decode posts with the negotiated session encoding.
// Divider lines are ASCII; split their raw bytes before decoding each post.

fn split_raw_lines(data: &[u8]) -> Vec<Vec<u8>> {
    let mut lines: Vec<Vec<u8>> = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < data.len() {
        if data[i] == 0x0D {
            lines.push(data[start..i].to_vec());
            i += 1;
            if i < data.len() && data[i] == 0x0A {
                i += 1;
            }
            start = i;
        } else if data[i] == 0x0A {
            lines.push(data[start..i].to_vec());
            i += 1;
            start = i;
        } else {
            i += 1;
        }
    }
    if start < data.len() {
        lines.push(data[start..].to_vec());
    }
    lines
}

fn classify_divider_lead(line: &[u8]) -> Option<u8> {
    const SEPS: &[u8] = &[b'_', b'-', b'=', b'~', b'*'];
    const WS: &[u8] = &[b' ', b'\t'];
    let s = line.iter().position(|b| !WS.contains(b))?;
    let e = line.iter().rposition(|b| !WS.contains(b))? + 1;
    let trimmed = &line[s..e];
    let lead = *trimmed.first()?;
    if !SEPS.contains(&lead) {
        return None;
    }
    if trimmed.len() >= 15 && trimmed.iter().all(|b| SEPS.contains(b)) {
        return Some(lead);
    }
    let lc = trimmed.iter().take_while(|b| SEPS.contains(b)).count();
    let tc = trimmed.iter().rev().take_while(|b| SEPS.contains(b)).count();
    if lc >= 5 && tc >= 5 {
        return Some(lead);
    }
    None
}

fn find_canonical_divider(lines: &[Vec<u8>]) -> Option<u8> {
    let mut counts: std::collections::HashMap<u8, usize> = std::collections::HashMap::new();
    let mut order: std::collections::HashMap<u8, usize> = std::collections::HashMap::new();
    for line in lines {
        if let Some(ch) = classify_divider_lead(line) {
            let n = order.len();
            order.entry(ch).or_insert(n);
            *counts.entry(ch).or_insert(0) += 1;
        }
    }
    counts
        .iter()
        .max_by(|a, b| {
            a.1.cmp(b.1).then_with(|| {
                order.get(b.0).unwrap_or(&usize::MAX).cmp(order.get(a.0).unwrap_or(&usize::MAX))
            })
        })
        .map(|(c, _)| *c)
}

fn decode_post_bytes(data: &[u8], encoding: TextEncoding) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let s = decode_bytes(data, encoding);
    let trimmed = s.trim().to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

fn parse_message_board_data(data: &[u8], encoding: TextEncoding) -> Vec<String> {
    if data.is_empty() {
        return Vec::new();
    }
    let lines = split_raw_lines(data);
    let canonical = find_canonical_divider(&lines);
    let mut posts: Vec<String> = Vec::new();
    let mut current: Vec<u8> = Vec::new();

    for line in &lines {
        if let (Some(lead), Some(canon)) = (classify_divider_lead(line), canonical) {
            if lead == canon {
                if !current.is_empty() {
                    if let Some(post) = decode_post_bytes(&current, encoding) {
                        posts.push(post);
                    }
                    current.clear();
                }
                continue;
            }
        }
        if !current.is_empty() {
            current.push(b'\n');
        }
        current.extend_from_slice(line);
    }

    if !current.is_empty() {
        if let Some(post) = decode_post_bytes(&current, encoding) {
            posts.push(post);
        }
    }

    posts
}

#[cfg(test)]
mod tests {
    use super::decode_hotline_date;

    #[test]
    fn modern_format_jan_1_midnight() {
        assert_eq!(
            decode_hotline_date(2026, 1).unwrap(),
            "1/1/2026 12:00 AM"
        );
    }

    #[test]
    fn modern_format_mid_year() {
        // 2026-07-15 13:30 — secs since 2026-01-01:
        // Jan(31)+Feb(28)+Mar(31)+Apr(30)+May(31)+Jun(30) = 181 full days,
        // then 14 days into July = 195 days * 86400 = 16,848,000
        // plus 13.5 hours = 13.5*3600 = 48,600
        // total = 16,896,600
        let result = decode_hotline_date(2026, 16_896_600).unwrap();
        assert_eq!(result, "7/15/2026 1:30 PM");
    }

    #[test]
    fn mac_1904_epoch_at_zero_secs() {
        // year=1904, secs=1 → 1904-01-01 00:00:01
        assert_eq!(
            decode_hotline_date(1904, 1).unwrap(),
            "1/1/1904 12:00 AM"
        );
    }

    #[test]
    fn mac_1904_epoch_one_year_later() {
        // 365 days * 86400 = 31_536_000 → 1905-01-01 00:00:00
        // (1904 was a leap year so day-by-day increments behave; secs=31_536_000
        //  hits 1904-12-31 23:59:60 which on real-world is Dec 31; +86400 brings
        //  us to 1905-01-01.)
        // Actually 1904 IS leap (divisible by 4, not century). So 366 days = 31_622_400
        // gets to 1905-01-01.
        let result = decode_hotline_date(1904, 31_622_400).unwrap();
        assert_eq!(result, "1/1/1905 12:00 AM");
    }

    #[test]
    fn mac_1904_epoch_to_2026() {
        // From 1904 to 2026: 122 years (so we want secs that lands at 2026-01-01).
        // Leap years 1904..2026: 1904, 1908, ..., 2024 = (2024-1904)/4 + 1 = 31
        // (and 2000 is divisible by 400, so it counts; no other century in range)
        // Non-leap: 122 - 31 = 91. Wait — we need 1904 through 2025 inclusive
        // (122 years) before reaching 2026.
        // Leap in [1904, 2025]: 1904, 1908, ..., 2024 = 31. Non-leap: 91.
        // Total secs = 91*365*86400 + 31*366*86400 = 91*31_536_000 + 31*31_622_400
        //            = 2_869_776_000 + 980_294_400 = 3_850_070_400
        let result = decode_hotline_date(1904, 3_850_070_400).unwrap();
        assert_eq!(result, "1/1/2026 12:00 AM");
    }

    #[test]
    fn year_zero_returns_none() {
        assert!(decode_hotline_date(0, 12345).is_none());
    }

    #[test]
    fn secs_zero_returns_none() {
        assert_eq!(decode_hotline_date(2026, 0).as_deref(), Some("1/1/2026 12:00 AM"));
    }

    #[test]
    fn leap_year_feb_29() {
        // 2024 is a leap year. Feb 29, 2024 noon:
        // Jan(31) + 28 days into Feb = 59 days. + 12 hours.
        // secs = 59*86400 + 12*3600 = 5_097_600 + 43_200 = 5_140_800
        let result = decode_hotline_date(2024, 5_140_800).unwrap();
        assert_eq!(result, "2/29/2024 12:00 PM");
    }
}

