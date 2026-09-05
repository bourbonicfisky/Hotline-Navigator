## ADDED Requirements

### Requirement: Negotiated session text encoding
The client SHALL advertise bit 1. The client SHALL use UTF-8 only when confirmed by the login reply, otherwise MacRoman, independently of TLS or HOPE. Resolve this before decoding login reply text. Each connection SHALL keep its own encoding and reset it on reconnect.

#### Scenario: Modern server
- **WHEN** the login reply confirms bit 1
- **THEN** incoming and outgoing text, including embedded names and history, uses UTF-8.

#### Scenario: Legacy server
- **WHEN** capabilities are absent or bit 1 is clear
- **THEN** all session text uses MacRoman, even when HOPE is active.

### Requirement: Consistent text conversion
The client SHALL use explicit session encoding for all human-readable fields, file/news paths, user and file list embedded strings, history nicknames and messages, and message boards. Binary credentials, MIME types and four-byte file codes SHALL not be transcoded as session text. MacRoman conversion SHALL replace unmappable characters with `?` and never switch the entire string to UTF-8. CRLF and CR SHALL decode to LF.

#### Scenario: Ambiguous byte sequence
- **WHEN** MacRoman bytes are also valid UTF-8
- **THEN** decoding honors the negotiated encoding without guessing.
