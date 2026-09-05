//! Advisory pre-login capability discovery. Never changes authentication policy.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpStream};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub info_version: u16,
    pub data_port: u16,
    pub tls_port: Option<u16>,
    pub software: Option<Software>,
    pub transport: Transport,
    #[serde(default)]
    pub capabilities: BTreeMap<String, bool>,
}
#[derive(Debug, Deserialize, Serialize)]
pub struct Software { pub name: String, pub version: Option<String> }

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Policy {
    #[serde(default)] pub supported: bool,
    #[serde(default)] pub required: bool,
    #[serde(default)] pub accepted: bool,
}
#[derive(Debug, Deserialize, Serialize)]
pub struct Transport {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub hope: Option<Policy>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub tls: Option<Policy>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub plaintext: Option<Policy>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub compression: Option<Policy>,
}

fn parse(header: &[u8; 12], body: &[u8]) -> Result<Descriptor, String> {
    if &header[..4] != b"HLIP" || header[4..6] != [0, 1] || header[6..8] != [0, 0] {
        return Err("Server discovery is unavailable or unsupported".into());
    }
    let length = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
    if length > 65536 || body.len() != length { return Err("Invalid discovery response size".into()); }
    let result: Descriptor = serde_json::from_slice(body).map_err(|e| format!("Invalid discovery descriptor: {e}"))?;
    if result.info_version != 1 || result.data_port == 0 || result.tls_port == Some(0) {
        return Err("Invalid discovery version or port".into());
    }
    Ok(result)
}

pub async fn discover(address: &str, data_port: u16) -> Result<Descriptor, String> {
    let port = data_port.checked_sub(1).filter(|p| *p != 0).ok_or("No valid discovery port")?;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let mut stream = TcpStream::connect(super::socket_addr_string(address, port)).await.map_err(|e| e.to_string())?;
        stream.write_all(b"HLIP\0\x01\0\0").await.map_err(|e| e.to_string())?;
        let mut header = [0; 12];
        stream.read_exact(&mut header).await.map_err(|e| e.to_string())?;
        let length = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
        if length > 65536 { return Err("Discovery response exceeds 64 KiB".into()); }
        let mut bytes = vec![0; length];
        stream.read_exact(&mut bytes).await.map_err(|e| e.to_string())?;
        parse(&header, &bytes)
    }).await.map_err(|_| "Server discovery timed out".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptor_requires_version_port_and_transport() {
        let body = br#"{"infoVersion":1,"dataPort":5500,"transport":{},"unknown":true}"#;
        let mut header = *b"HLIP\0\x01\0\0\0\0\0\0";
        header[8..].copy_from_slice(&(body.len() as u32).to_be_bytes());
        assert_eq!(parse(&header, body).unwrap().data_port, 5500);
        header[5] = 2;
        assert!(parse(&header, body).is_err());
        header[5] = 1; header[8..].copy_from_slice(&65537u32.to_be_bytes());
        assert!(parse(&header, body).is_err());
    }
}
