## Why

Navigator's `DATA_CAPABILITIES` handling has three small but real gaps:

1. **Date decoder doesn't honor the spec's year==1904 fallback.** [client/news.rs:512-538](hotline-tauri/src-tauri/src/protocol/client/news.rs#L512-L538) treats the seconds field as "since Jan 1 of `year`" unconditionally. Per the fogWraith Capabilities spec, vintage servers (and any server not flipping format on `DATA_CAPABILITIES` presence) send Mac-1904 epoch dates with `year=1904, secs=total seconds since 1904-01-01`. Our decoder renders nonsense like `12/43400/1904` for those.
2. **Wire field is hardcoded to 16 bits.** Both [client/mod.rs:851](hotline-tauri/src-tauri/src/protocol/client/mod.rs#L851) and [client/mod.rs:982](hotline-tauri/src-tauri/src/protocol/client/mod.rs#L982) send capabilities via `from_u16`. Spec recommends an 8-byte field for future growth: *"An 8-byte (64-bit) field provides 64 capability slots."* Bits 0–5 fit in u16 today, but we'll need to widen before bit 6 lands.
3. **Capability bitmask is computed at two duplicate call sites.** Any future bit (text encoding, voice, inline media) requires touching both. There's no single source of truth for "what does this client advertise."

This change does the minimum to make Navigator a well-behaved capabilities citizen: fix the latent date bug, widen the field, centralize the advertised-bits computation, and defensively ignore any provisional bits we don't implement (notably bit 5).

## What Changes

- Add `year == 1904` branch to news date decoder: when present, treat `secs` as total seconds since 1904-01-01 UTC and convert to a calendar date. When absent, retain current "secs since Jan 1 of `year`" behavior.
- Audit other date-decode call sites (`Get File Info` 200, file/folder download `FlatFileInformationFork`) and apply the same fallback if/where we decode dates today; document any sites that don't currently decode dates as out of scope.
- Widen `Capabilities` wire field to u64. Update `TransactionField::to_u64()` (or add it) to accept 2/4/8-byte values from server replies. Spec mandates "Unrecognised bits should be ignored by both sides," so widening is non-breaking.
- Add `client_capability_bits(state) -> u64` helper that returns the bits to advertise based on connection state (HOPE active? user prefs? feature flags?). Replace both hardcoded OR sites with calls to this helper.
- Defensively parse bit 5 (`CAPABILITY_EXTENDED_PRIV`) echo without acting on it: log if a server ever echoes it back, but do NOT widen `FieldUserAccess` decoding. Spec marks bit 5 provisional; we don't advertise it and ignore servers that pretend we did.
- Add unit tests for: 1904-epoch decoding, modern-format decoding, year-zero edge case, capability bitmask helper output for known states.

## Capabilities

### New Capabilities

(none — extending existing capabilities)

### Modified Capabilities

- `server-connection`: Document that the client advertises capabilities via a u64 wire field, that the advertised set is computed centrally per-connection, and that the client tolerates server-echoed bits it does not implement (notably bit 5).
- `news`: Document the dual-format date decoder (Mac-1904 epoch when `year==1904`, modern when otherwise) — the spec calls this out as a per-client capability.

## Impact

- **Backend (Rust)**:
  - [protocol/constants.rs:159-161](hotline-tauri/src-tauri/src/protocol/constants.rs#L159-L161) — capability constants stay `u16`-shaped values but the wire field changes
  - [protocol/types.rs](hotline-tauri/src-tauri/src/protocol/types.rs) — add `to_u64` on `TransactionField` if not present; add `from_u64`
  - [protocol/client/mod.rs:851, 982](hotline-tauri/src-tauri/src/protocol/client/mod.rs#L851) — replace duplicate hardcoded OR with helper call
  - New helper module or function: `client_capability_bits(...)` near `HotlineClient`
  - [protocol/client/news.rs:512-538](hotline-tauri/src-tauri/src/protocol/client/news.rs#L512-L538) — add `year==1904` branch
- **Frontend**: none.
- **Wire compatibility**: Fully backward compatible. Servers that read 2 bytes will see the low 2 bytes (which is where today's bits live). Servers that read 8 bytes get the full value with high bits zero.
- **Risk**: Low. Pure protocol-layer hygiene. The date fix is a strict improvement (today's behavior is broken on 1904-format input). The widening is invisible against any current server. The helper is a refactor.
- **Out of scope**: Adding any new capability bits. This change creates the runway; subsequent changes (`macroman-encoding` amendment, `inline-media-protocol`, `voice-protocol`) consume it.

## Scope amendment: finish existing partial features

Complete private-message/private-room inline media and consume advertised media
limits; correct 64-bit file-info and folder request metadata; share dual-format
date decoding across news and file info and advertise modern dates; decode history
using the current MacRoman session encoding. Full UTF-8 negotiation, whole-folder
transfer execution, resume, voice, discovery and other new features remain separate.
