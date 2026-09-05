## ADDED Requirements

### Requirement: DATA_CAPABILITIES negotiation

The client SHALL advertise its supported protocol extensions via the `DATA_CAPABILITIES` (0x01F0) field in the Login (107) transaction, and SHALL parse the server's echoed value from the login reply to determine which extensions are active for the session.

The advertised value SHALL be computed by a single `client_capability_bits()` helper that takes connection state (HOPE active, bookmark feature flags, user preferences) as inputs and returns a u64 bitmask. Both the HOPE-authenticated login path and the legacy login path SHALL use this helper; neither SHALL hardcode the advertised bits inline.

The wire field SHALL be encoded as an 8-byte (u64) big-endian value, per the fogWraith spec recommendation that implementations "use a width that accommodates future growth." Values fit in fewer bytes today, but the wire encoding reserves the full 64-bit space.

The client SHALL accept server-echoed `DATA_CAPABILITIES` of any width from 2 to 8 bytes, right-aligning the bytes and padding the high-order bits with zero. Bits the client did not advertise but the server echoed SHALL be ignored (they MAY be logged for diagnostics).

The client SHALL NOT advertise any provisional capability bit defined by the spec. As of this writing, bit 5 (`CAPABILITY_EXTENDED_PRIV`, 0x0020) is provisional. If the server echoes a provisional bit despite the client not advertising it, the client SHALL log a warning and SHALL NOT alter its parsing of any other field as a result.

#### Scenario: Capability bits sent in login

- **WHEN** the client sends a Login (107) transaction
- **THEN** the transaction SHALL include field 0x01F0 encoded as an 8-byte big-endian value containing the result of `client_capability_bits()`

#### Scenario: Server echoes a wider value than client sent

- **WHEN** the server reply contains field 0x01F0 with 8 bytes of data
- **THEN** the client SHALL parse all 8 bytes as a u64 and AND each known bit against the result to determine which extensions are active

#### Scenario: Server echoes a narrower value than client sent

- **WHEN** the server reply contains field 0x01F0 with 2 bytes of data
- **THEN** the client SHALL right-align the bytes into a u64 (high 6 bytes zero) and treat the result as the active capability set

#### Scenario: Server echoes provisional bit 5

- **WHEN** the server reply has bit 5 (0x0020) set in `DATA_CAPABILITIES` despite the client not advertising it
- **THEN** the client SHALL log a warning to the protocol log, SHALL continue to decode `FieldUserAccess` (110) as a 64-bit value, and SHALL NOT enable any 128-bit privilege parsing

### Requirement: Variable-width capability decoder

The system SHALL provide `TransactionField::to_u64()` that decodes a `DATA_CAPABILITIES` field of width 2, 4, or 8 bytes into a u64 by right-aligning the bytes and padding the high-order bytes with zero.

The system SHALL provide `TransactionField::from_u64(field_type, value)` that encodes a u64 as an 8-byte big-endian field value.

#### Scenario: Decode 2-byte capability field

- **WHEN** `to_u64()` is called on a field with data `[0x00, 0x11]`
- **THEN** the result SHALL be `0x0000_0000_0000_0011_u64`

#### Scenario: Decode 8-byte capability field

- **WHEN** `to_u64()` is called on a field with data `[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x11]`
- **THEN** the result SHALL be `0x0000_0000_0000_0011_u64`

#### Scenario: Decode unsupported width

- **WHEN** `to_u64()` is called on a field with width other than 2, 4, or 8 bytes
- **THEN** the function SHALL return an error and the caller SHALL treat the capabilities as zero

### Requirement: Complete existing capability consumers

The client SHALL advertise modern dates (bit 9) with a shared dual-format decoder
for news and Get File Info date fields. It SHALL prefer 64-bit file and folder
metadata with legacy fallback. Capability serialization retains the existing
smallest supported width (2, 4, or 8 bytes) for legacy compatibility, superseding
the original fixed-width wording above.

History text SHALL decode as MacRoman while UTF-8 capability remains unadvertised.
Media limits from a negotiated login reply SHALL govern attachment preflight,
chunk slicing, image dimensions, decoded pixels and animation frames/duration,
with documented defaults and stricter local ceilings. Private message and room
views SHALL preserve, send and render the same media metadata as public chat.

#### Scenario: Interrupted attachment send
- **WHEN** upload succeeds but sending the message fails
- **THEN** the draft and handle SHALL remain available for retry in that session
- **AND** a disconnect SHALL invalidate that handle before it can be reused

#### Scenario: Non-ASCII legacy history
- **WHEN** history includes MacRoman accented text in a session without bit 1
- **THEN** the displayed nickname and message SHALL preserve those characters

#### Scenario: Large file details
- **WHEN** file info includes both a legacy size and a 64-bit size above 4 GiB
- **THEN** the client SHALL use the 64-bit value and display the decoded dates
