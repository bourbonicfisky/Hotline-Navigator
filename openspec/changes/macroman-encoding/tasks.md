## Tasks

- [x] Add explicit text encoding and conversion helpers, with MacRoman-default field wrappers.
- [x] Negotiate encoding per connection before login text and capture it in the receive loop; reset on reconnect.
- [x] Apply encoding to live messages, user lists, private rooms, account names and errors.
- [x] Apply encoding to history, news text and embedded names, file names and paths.
- [x] Add regression tests for UTF-8, ambiguous MacRoman bytes, line endings, paths and negotiation fallback.
- [x] Run Rust and frontend tests and production build.
- [ ] Verify against live classic and UTF-8 servers (requires available test servers; do not claim automated tests cover this).

Validation: 137 Rust tests and 84 frontend tests passed; production web build passed. Live server interoperability remains unverified.
