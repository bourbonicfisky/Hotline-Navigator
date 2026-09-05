## Tasks

### 1. Date decoder dual-format support
- [x] Add `year == 1904` branch to news date decoder: when `year == 1904`, treat `secs` as total seconds since 1904-01-01 UTC; compute calendar date by walking forward year-by-year from 1904
- [x] Keep existing "secs since Jan 1 of `year`" path for `year != 1904`
- [x] Extract logic into `decode_hotline_date(year: u16, secs: u32) -> Option<String>` helper in [client/news.rs](hotline-tauri/src-tauri/src/protocol/client/news.rs)
- [x] Decode Get File Info (206) dates with the shared dual-format parser and display them in File Info. Transfer INFO forks are skipped rather than decoded; restoring filesystem metadata remains separate.
- [x] Unit tests:
  - 1904-epoch decode: `(1904, 3_850_070_400)` → `1/1/2026 12:00 AM`
  - Modern decode: `(2026, 1)` → `1/1/2026 12:00 AM`
  - Year-zero: returns None
  - Secs-zero: returns None
  - Mid-year + leap year edge cases

### 2. Widen Capabilities wire field to u64
- [x] `TransactionField::from_u64` already present; reused
- [x] Add `TransactionField::to_capability_bits()` accepting 2-, 4-, or 8-byte field widths (right-align bytes, pad zero high bytes). Kept separate from strict `to_u64()` to avoid masking bugs in file-size parsing.
- [x] Update HOPE auth path and legacy login path to use `from_u64`
- [x] Update server reply parser to call `to_capability_bits()`; `server_capabilities` is now `u64`
- [x] Promote capability constants from `u16` to `u64` in [protocol/constants.rs](hotline-tauri/src-tauri/src/protocol/constants.rs); bit-test expressions now operate on `u64`
- [x] Unit tests: 2/4/8-byte decode roundtrips, invalid width rejection, high-bit byte ordering

### 3. Centralize advertised-bits computation
- [x] Defined `fn client_capability_bits(&self) -> u64` on `HotlineClient`
- [x] Initial implementation returns `CAPABILITY_LARGE_FILES | CAPABILITY_CHAT_HISTORY` (matches prior behavior)
- [x] Replace both hardcoded ORs with `self.client_capability_bits()` at both send sites
- [x] Unit test: advertised bits include modern dates, follow the media preference, and exclude UTF-8, voice, and provisional privileges.

### 4. Defensive bit-5 handling
- [x] Added `CAPABILITY_EXTENDED_PRIV: u64 = 0x0020` constant; NOT included in `client_capability_bits()`
- [x] Login-reply processing logs a warning if bit 5 is echoed and continues parsing `FieldUserAccess` as 64 bits
- [ ] Regression test simulating bit-5 echo. *(Deferred — would require constructing a synthetic login reply. Current `to_u64()` already strict on UserAccess width so a malformed reply with widened UserAccess would error gracefully today.)*

### 4a. Add unused-but-spec'd capability constants
- [x] `CAPABILITY_TEXT_ENCODING` (bit 1) — for upcoming `macroman-encoding` amendment
- [x] `CAPABILITY_VOICE` (bit 2) — for `voice-protocol`
- [x] `CAPABILITY_INLINE_MEDIA` (bit 3) — for `inline-media-protocol`
- [x] `ACCESS_SEND_MEDIA` privilege bit 57 — for `inline-media-protocol`

### 5. Spec docs
- [x] Change-level spec deltas in `specs/server-connection/spec.md` and `specs/news/spec.md` (will merge into main specs on archive)

### 6. Verification
- [x] `cargo test --lib` passes (83 tests, including 8 new date-decoder tests + 5 new capability-bits tests)
- [x] `cargo check` passes with no new warnings
- [ ] Connect to System7 Today and Apple Media Archive — verify login still succeeds with the wider capability field. *(Manual smoke test, defer until pre-merge.)*
- [ ] Connect to a vintage server (or simulate) sending year=1904 dates — verify correct rendering. *(No vintage server in default bookmarks; deferred until we find one or build a test fixture.)*

### 7. Complete existing partial features
- [x] Preserve and render media in private messages and rooms; share attachment composer behavior, retain drafts on failures.
- [x] Parse advertised media byte/dimension/pixel/frame/duration/chunk limits; enforce upload and decode limits and use recommended chunks.
- [x] Prefer 64-bit file-info sizes and folder transfer sizes/counts with legacy fallback.
- [x] Share 8-byte date decoding across news/file info; display file dates and advertise modern dates only with dual-format decoding.
- [x] Decode history text as MacRoman for current sessions without enabling new UTF-8 negotiation.
- [x] Add regression coverage and run frontend/Rust suites and production build; document live-server/mobile verification limits.
