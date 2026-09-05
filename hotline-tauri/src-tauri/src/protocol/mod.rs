pub mod dates;
// Hotline protocol implementation

pub mod client;
pub mod constants;
pub mod history;
pub mod transaction;
pub mod types;
pub mod tracker;

/// Format `address:port` for use with `TcpStream::connect`.
/// IPv6 literals must be wrapped in brackets (e.g. `[::1]:5493`) so the parser can distinguish
/// address from port; hostnames and IPv4 stay as `host:port`.
pub fn socket_addr_string(address: &str, port: u16) -> String {
    if address.starts_with('[') && address.ends_with(']') {
        format!("{}:{}", address, port)
    } else if address.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{}]:{}", address, port)
    } else if is_scoped_ipv6_literal(address) {
        // Link-local/scoped IPv6 literals (e.g. `fe80::1%en0`) are not accepted by
        // `Ipv6Addr` parsing but still need `[addr]:port` formatting for socket APIs.
        format!("[{}]:{}", address, port)
    } else {
        format!("{}:{}", address, port)
    }
}

fn is_scoped_ipv6_literal(address: &str) -> bool {
    address.contains('%') && address.matches(':').count() >= 2
}

#[cfg(test)]
mod tests {
    use super::socket_addr_string;

    #[test]
    fn formats_ipv6_literal() {
        assert_eq!(socket_addr_string("::1", 5500), "[::1]:5500");
        assert_eq!(
            socket_addr_string("2001:db8::1", 5600),
            "[2001:db8::1]:5600"
        );
        assert_eq!(
            socket_addr_string("2001:0db8:85a3::8a2e:0370:7334", 5493),
            "[2001:0db8:85a3::8a2e:0370:7334]:5493"
        );
    }

    #[test]
    fn formats_scoped_ipv6_literal() {
        assert_eq!(socket_addr_string("fe80::1%en0", 5500), "[fe80::1%en0]:5500");
        assert_eq!(socket_addr_string("fe80::1%1", 5500), "[fe80::1%1]:5500");
    }

    #[test]
    fn keeps_bracketed_ipv6_literal() {
        assert_eq!(socket_addr_string("[::1]", 5500), "[::1]:5500");
        assert_eq!(
            socket_addr_string("[fe80::1%en0]", 5500),
            "[fe80::1%en0]:5500"
        );
    }

    #[test]
    fn formats_ipv4_and_hostname_without_brackets() {
        assert_eq!(socket_addr_string("127.0.0.1", 5500), "127.0.0.1:5500");
        assert_eq!(
            socket_addr_string("hotline.example.com", 5500),
            "hotline.example.com:5500"
        );
    }
}

pub use client::{HotlineClient, HotlineEvent, FileInfo};
pub use constants::{DEFAULT_SERVER_PORT, FieldType, TransactionType};
pub use transaction::{Transaction, TransactionField};
pub use types::{Bookmark, ConnectionStatus, ServerInfo, User};
