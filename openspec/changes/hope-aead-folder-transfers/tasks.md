## Transfer completion

- [x] Stream single-file downloads to disk with a bounded buffer; retain partial bytes and bind retries to server/account/path/size/modification date.
- [x] Encode RFLT download offsets and OFFSET64; reject ignored resume framing and restart on unsupported resume.
- [x] Correct large-file uploads to raw data; verify the server's window digest before setting HTXF resume and send only remaining bytes.
- [x] Implement folder download and upload dialogs, path framing, directory creation, per-file streaming, and legacy folder upload resume.
- [x] Wrap both directions of folder transfers in AEAD after the plaintext handshake.
- [x] Confine received paths, preserve existing files, reject unsafe local entries, and bound entry counts and framing widths.
- [x] Validate protocol fixtures, frontend checks, and production build.
- [ ] Live classic/modern server and AEAD folder interoperability smoke tests.

Limits: large-file upload resume requires a valid digest; classic resume follows RFLT fork offsets. Classic single-file uploads use the returned RFLT offset. Folder upload uses the desktop picker; mobile folder upload is not available. Files exceeding the 32-bit per-file folder framing limit must be uploaded individually. Folder downloads preserve completed files on failure; retries create a new folder rather than appending without a file identity check.

Validation: 144 Rust tests, 84 frontend tests, TypeScript checks and production web build passed.
