// Hotline Tracker Client
// Protocol: Connect to tracker, send HTRK magic packet, receive server listings

use std::{net::{Ipv4Addr, Ipv6Addr}, sync::Arc};
use tokio::io::{AsyncRead, AsyncWrite, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use crate::protocol::types::TrackerServer;

const TRACKER_MAGIC: &[u8] = b"HTRK";
trait TrackerStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> TrackerStream for T {}
type Stream = Box<dyn TrackerStream>;
const DEFAULT_TRACKER_PORT: u16 = 5498;

pub struct TrackerClient;

impl TrackerClient {
    pub async fn fetch_servers(address: &str, port: Option<u16>, tls: bool, login: &str, password: &str) -> Result<Vec<TrackerServer>, String> {
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            for version in [3u16, 2, 1] {
                let tcp = TcpStream::connect(crate::protocol::socket_addr_string(address, port.unwrap_or(DEFAULT_TRACKER_PORT))).await.map_err(|e| e.to_string())?;
                let mut stream: Stream = if tls {
                    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
                    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                        .with_safe_default_protocol_versions().map_err(|e| e.to_string())?
                        .with_root_certificates(roots).with_no_client_auth();
                    let name = rustls::pki_types::ServerName::try_from(address.to_string()).map_err(|e| e.to_string())?;
                    Box::new(tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp).await.map_err(|e| format!("Tracker TLS failed: {e}"))?)
                } else { Box::new(tcp) };
                let mut request = b"HTRK".to_vec();
                request.extend_from_slice(&version.to_be_bytes());
                // IPv6 and authentication. No query flag: request complete listings.
                if version == 3 { request.extend_from_slice(&5u16.to_be_bytes()); }
                stream.write_all(&request).await.map_err(|e| e.to_string())?;
                let mut response = [0; 6];
                if !matches!(tokio::time::timeout(std::time::Duration::from_secs(3), stream.read_exact(&mut response)).await, Ok(Ok(_))) { continue; }
                if &response[..4] != TRACKER_MAGIC { return Err("Invalid tracker handshake".into()); }
                let accepted = u16::from_be_bytes(response[4..6].try_into().unwrap());
                match accepted {
                    1 => return Self::read_server_batches(&mut stream).await,
                    2 => {
                        // Reconnect with an exact v2 handshake: a v3 feature word may
                        // otherwise be mistaken for Pascal-string credentials.
                        if version == 3 { continue; }
                        let required = stream.read_u8().await.map_err(|e| e.to_string())?;
                        if required == 1 {
                            if login.len() > 31 || password.len() > 31 { return Err("Tracker credentials exceed 31 bytes".into()); }
                            if password.is_empty() { return Err("Tracker requires credentials; edit its bookmark".into()); }
                            let mut auth = vec![login.len() as u8];
                            auth.extend_from_slice(login.as_bytes());
                            auth.push(password.len() as u8); auth.extend_from_slice(password.as_bytes());
                            stream.write_all(&auth).await.map_err(|e| e.to_string())?;
                            if stream.read_u8().await.map_err(|e| e.to_string())? != 0 { return Err("Tracker authentication denied".into()); }
                        } else if required != 0 { return Err("Invalid tracker authentication flag".into()); }
                        return Self::read_server_batches(&mut stream).await;
                    }
                    3 => {
                        let flags = stream.read_u16().await.map_err(|e| e.to_string())?;
                        if flags & 4 != 0 {
                            if password.is_empty() { return Err("Tracker requires credentials; edit its bookmark".into()); }
                            let mut auth = vec![0, 1, 0, 2];
                            for (id, value) in [(0x0820u16, login), (0x0821, password)] {
                                let len = u16::try_from(value.len()).map_err(|_| "Tracker credentials are too long")?;
                                auth.extend_from_slice(&id.to_be_bytes()); auth.extend_from_slice(&len.to_be_bytes()); auth.extend_from_slice(value.as_bytes());
                            }
                            stream.write_all(&auth).await.map_err(|e| e.to_string())?;
                            let status = stream.read_u8().await.map_err(|e| e.to_string())?;
                            let fields = stream.read_u16().await.map_err(|e| e.to_string())?;
                            skip_tlvs(&mut stream, fields).await?;
                            if status != 0 { return Err("Tracker authentication denied".into()); }
                        }
                        stream.write_all(&[0, 1, 0, 0]).await.map_err(|e| e.to_string())?;
                        return read_v3(&mut stream).await;
                    }
                    _ => return Err("Unsupported tracker protocol version".into()),
                }
            }
            Err("Tracker did not accept a supported protocol version".into())
        }).await.map_err(|_| "Tracker response timed out".to_string())?
    }

    async fn read_server_batches<S: AsyncRead + Unpin>(stream: &mut S) -> Result<Vec<TrackerServer>, String> {
        let mut servers = Vec::new();
        let mut total_entries_parsed = 0;
        let mut total_expected_entries = 0;
        let mut batch_count = 0;

        loop {
            batch_count += 1;
            
            // Read batch header (8 bytes)
            let mut header = [0u8; 8];
            stream
                .read_exact(&mut header)
                .await
                .map_err(|e| format!("Failed to read tracker batch header: {}", e))?;
            
            let message_type = u16::from_be_bytes([header[0], header[1]]);
            let _data_length = u16::from_be_bytes([header[2], header[3]]);
            let server_count = u16::from_be_bytes([header[4], header[5]]);
            let server_count2 = u16::from_be_bytes([header[6], header[7]]);
            
            // First header tells us the total expected entries
            if total_expected_entries == 0 {
                total_expected_entries = server_count as usize;
            }
            
            println!("TrackerClient: Batch #{} - type: {}, count1: {}, count2: {}", 
                batch_count, message_type, server_count, server_count2);
            
            // Parse servers in this batch
            for _ in 0..server_count2 {
                // Read IP address (4 bytes)
                let mut ip_bytes = [0u8; 4];
                stream
                    .read_exact(&mut ip_bytes)
                    .await
                    .map_err(|e| format!("Failed to read server IP: {}", e))?;
                
                let address = format!("{}.{}.{}.{}", ip_bytes[0], ip_bytes[1], ip_bytes[2], ip_bytes[3]);
                
                // Read port (u16, big-endian)
                let mut port_bytes = [0u8; 2];
                stream
                    .read_exact(&mut port_bytes)
                    .await
                    .map_err(|e| format!("Failed to read server port: {}", e))?;
                let port = u16::from_be_bytes(port_bytes);
                
                // Read user count (u16, big-endian)
                let mut users_bytes = [0u8; 2];
                stream
                    .read_exact(&mut users_bytes)
                    .await
                    .map_err(|e| format!("Failed to read user count: {}", e))?;
                let users = u16::from_be_bytes(users_bytes);
                
                // Skip 2 unused bytes
                let mut unused = [0u8; 2];
                stream
                    .read_exact(&mut unused)
                    .await
                    .map_err(|e| format!("Failed to skip unused bytes: {}", e))?;
                
                // Read server name (Pascal string: 1 byte length + data)
                let mut name_len = [0u8; 1];
                stream
                    .read_exact(&mut name_len)
                    .await
                    .map_err(|e| format!("Failed to read server name length: {}", e))?;
                
                let name = if name_len[0] > 0 {
                    let mut name_data = vec![0u8; name_len[0] as usize];
                    stream
                        .read_exact(&mut name_data)
                        .await
                        .map_err(|e| format!("Failed to read server name: {}", e))?;
                    
                    // Decode MacOS Roman to UTF-8
                    let (decoded, _encoding, had_errors) = encoding_rs::MACINTOSH.decode(&name_data);
                    if had_errors {
                        String::from_utf8_lossy(&name_data).to_string()
                    } else {
                        decoded.into_owned()
                    }
                } else {
                    String::new()
                };
                
                // Read server description (Pascal string: 1 byte length + data)
                let mut desc_len = [0u8; 1];
                stream
                    .read_exact(&mut desc_len)
                    .await
                    .map_err(|e| format!("Failed to read server description length: {}", e))?;
                
                let description = if desc_len[0] > 0 {
                    let mut desc_data = vec![0u8; desc_len[0] as usize];
                    stream
                        .read_exact(&mut desc_data)
                        .await
                        .map_err(|e| format!("Failed to read server description: {}", e))?;
                    
                    // Decode MacOS Roman to UTF-8
                    let (decoded, _encoding, had_errors) = encoding_rs::MACINTOSH.decode(&desc_data);
                    if had_errors {
                        String::from_utf8_lossy(&desc_data).to_string()
                    } else {
                        decoded.into_owned()
                    }
                } else {
                    String::new()
                };
                
                total_entries_parsed += 1;
                
                // Filter out separator entries (names like "-------")
                let is_separator = name.chars().all(|c| c == '-') && name.len() > 3;
                
                if !is_separator {
                    servers.push(TrackerServer {
                        address,
                        port,
                        users,
                        name: if name.is_empty() { None } else { Some(name) },
                        description: if description.is_empty() { None } else { Some(description) },
                    });
                }
            }
            
            println!("TrackerClient: Batch #{}: parsed {} entries, {} servers (filtered separators)", 
                batch_count, server_count2, servers.len());
            
            // Check if we've read all expected entries
            if total_entries_parsed >= total_expected_entries {
                break;
            }
            
            // Safety: don't loop forever
            if batch_count >= 100 {
                return Err("Tracker listing exceeded the batch limit".into());
            }
        }
        
        println!("TrackerClient: Batch loop complete - parsed {}/{} entries, {} servers",
            total_entries_parsed, total_expected_entries, servers.len());

        Ok(servers)
    }
}


async fn string16<S: AsyncRead + Unpin>(stream: &mut S) -> Result<String, String> {
    let length = stream.read_u16().await.map_err(|e| e.to_string())? as usize;
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

async fn skip_tlvs<S: AsyncRead + Unpin>(stream: &mut S, count: u16) -> Result<(), String> {
    if count > 1024 { return Err("Too many tracker metadata fields".into()); }
    for _ in 0..count {
        let _id = stream.read_u16().await.map_err(|e| e.to_string())?;
        let len = stream.read_u16().await.map_err(|e| e.to_string())? as usize;
        let mut bytes = vec![0; len];
        stream.read_exact(&mut bytes).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn read_v3<S: AsyncRead + Unpin>(stream: &mut S) -> Result<Vec<TrackerServer>, String> {
    if stream.read_u16().await.map_err(|e| e.to_string())? != 1 { return Err("Unexpected tracker response type".into()); }
    let size = stream.read_u32().await.map_err(|e| e.to_string())?;
    if size > 16 * 1024 * 1024 { return Err("Tracker response exceeds 16 MiB".into()); }
    let total = stream.read_u16().await.map_err(|e| e.to_string())?;
    let count = stream.read_u16().await.map_err(|e| e.to_string())?;
    if count != total { return Err("Tracker returned an incomplete unpaginated listing".into()); }
    let mut limited = stream.take(16 * 1024 * 1024);
    let mut servers = Vec::new();
    for _ in 0..count {
        let address = match limited.read_u8().await.map_err(|e| e.to_string())? {
            4 => { let mut bytes = [0; 4]; limited.read_exact(&mut bytes).await.map_err(|e| e.to_string())?; Ipv4Addr::from(bytes).to_string() }
            6 => { let mut bytes = [0; 16]; limited.read_exact(&mut bytes).await.map_err(|e| e.to_string())?; Ipv6Addr::from(bytes).to_string() }
            0x48 => string16(&mut limited).await?,
            _ => return Err("Unknown tracker address type".into()),
        };
        if address.is_empty() || address.chars().any(|c| c.is_control() || c.is_whitespace() || matches!(c, '/' | '\\' | '@')) {
            return Err("Invalid tracker server address".into());
        }
        let port = limited.read_u16().await.map_err(|e| e.to_string())?;
        if port == 0 { return Err("Invalid tracker server port".into()); }
        let users = limited.read_u16().await.map_err(|e| e.to_string())?;
        let name = string16(&mut limited).await?;
        let description = string16(&mut limited).await?;
        let fields = limited.read_u16().await.map_err(|e| e.to_string())?;
        skip_tlvs(&mut limited, fields).await?;
        servers.push(TrackerServer { address, port, users, name: Some(name), description: Some(description) });
    }
    Ok(servers)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn string(bytes: &mut Vec<u8>, text: &str) { bytes.extend_from_slice(&(text.len() as u16).to_be_bytes()); bytes.extend_from_slice(text.as_bytes()); }
    #[tokio::test]
    async fn v3_reads_ipv6_utf8_and_skips_unknown_metadata() {
        let mut bytes = vec![0, 1, 0, 0, 0, 100, 0, 1, 0, 1, 6];
        bytes.extend_from_slice(&Ipv6Addr::LOCALHOST.octets());
        bytes.extend_from_slice(&5500u16.to_be_bytes()); bytes.extend_from_slice(&42u16.to_be_bytes());
        string(&mut bytes, "日本語"); string(&mut bytes, "café");
        bytes.extend_from_slice(&[0, 1, 0xf0, 1, 0, 3, 1, 2, 3]);
        let servers = read_v3(&mut std::io::Cursor::new(bytes.clone())).await.unwrap();
        assert_eq!(servers[0].address, "::1");
        assert_eq!(servers[0].name.as_deref(), Some("日本語"));
        assert_eq!(servers[0].description.as_deref(), Some("café"));
        bytes.pop();
        assert!(read_v3(&mut std::io::Cursor::new(bytes)).await.is_err());
    }
    #[tokio::test]
    async fn v2_authentication_denial_does_not_downgrade() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            // Client reconnects after v3 -> v2, avoiding leftover feature bytes.
            for expected_version in [3u8, 2] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut handshake = [0; 6]; stream.read_exact(&mut handshake).await.unwrap();
                assert_eq!(handshake[5], expected_version);
                if expected_version == 3 { let mut flags = [0; 2]; stream.read_exact(&mut flags).await.unwrap(); }
                stream.write_all(b"HTRK\0\x02\x01").await.unwrap();
                if expected_version == 2 {
                    let mut auth = [0; 8]; stream.read_exact(&mut auth).await.unwrap();
                    assert_eq!(&auth, b"\x03bob\x03bad");
                    stream.write_all(&[1]).await.unwrap();
                }
            }
        });
        let error = TrackerClient::fetch_servers("127.0.0.1", Some(port), false, "bob", "bad").await.unwrap_err();
        assert!(error.contains("authentication denied"));
        server.await.unwrap();
    }
}
