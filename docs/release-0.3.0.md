# v0.3.0

This release fills in a substantial part of Navigator’s Hotline protocol support: interrupted transfers can resume, entire folders can be transferred, modern trackers are supported, and compatible servers can display custom GIF avatars.

Text handling also gets a deeper cleanup. Navigator now negotiates UTF-8 consistently across live chat, history, news, and file names, while keeping MacRoman compatibility with classic servers. Private conversations gain media attachments, file sizes and dates are handled more accurately, and saved passwords move into encrypted storage.

## New Features

- **Resumable file transfers** — Interrupted downloads retain partial data and can resume when the remote file still matches. Uploads support classic resume offsets and modern partial-file verification, restarting when a safe resume is unavailable.
- **Folder transfers** — Download folders from the file browser or use **Upload Folder** on desktop. Nested and empty folders are supported, with checks that keep received paths inside the destination folder.
- **Modern trackers and server discovery** — Trackers support v1, v2, and v3, including authenticated listings and optional certificate-validated TLS. Server bookmark information can display advertised ports, transports, and features.
- **Custom GIF avatars** — Set or clear an avatar on compatible servers. Avatars appear in user lists, user details, and grouped chat, with classic icons as a fallback.
- **Private media attachments** — Inline media support now extends to private messages and private rooms, respecting the server’s advertised media limits.

## Bugfixes and Improvements

- **Consistent text and history** — UTF-8 is used when negotiated with the server; classic sessions use MacRoman. Live messages, history, news, and file names follow the same encoding, and line endings no longer produce duplicate newlines.
- **More accurate file metadata** — Extended file and folder sizes and both protocol date formats are supported. Large-file upload framing now matches the negotiated transfer format.
- **Safer saved passwords** — Bookmark passwords are protected in encrypted storage.
- **Hardened external previews** — External image fetching received additional validation and privacy protections.
- **Bounded transfer memory use** — Downloads stream to disk instead of buffering the entire file, and completed downloads avoid overwriting existing local files.
- **Correct version from the first frame** — About and Update screens use the packaged version immediately, fixing the brief flash of version 0.2.3.

## Technical

- Session-wide UTF-8 negotiation covers protocol text fields, embedded names, file paths, and history; decoding no longer guesses the encoding.
- Classic upload resumes honor RFLT fork offsets. Modern upload resumes verify a partial-file SHA-256 digest before appending.
- Folder streams support nested paths and AEAD wrapping, with destination confinement and rejection of local links and special files.
- Tracker v3 handles UTF-8, IPv4, IPv6, and hostname records. Authentication denial does not silently downgrade to an older protocol.
- GIF avatar caches are bounded and scoped to the connection. Disconnects and user departures clear the relevant entries.
- Validation includes 148 Rust tests, 87 frontend tests, and a production build. The macOS installer is signed and notarized.

## Current Limitations

- Retrying a failed folder download creates a new destination folder; completed files from the previous attempt remain available. Mobile folder upload is not yet supported.
- Folder streams have a 32-bit per-file length limit; larger files must be uploaded individually.
- Custom avatars are session-specific and must be set again after reconnecting. Local limits are 32 KiB, 256 × 256 pixels, 60 frames, and 15 seconds.
- Tracker v3 currently requests complete listings; server-side search and pagination are not exposed.
- Live-server interoperability testing remains ongoing, including encrypted folder transfers.

## Installation

Download the universal `.dmg` below for macOS, open it, and drag Hotline Navigator into Applications. It supports Intel and Apple Silicon Macs running macOS Big Sur or later.

This release includes the macOS installer. Windows, Android, iOS / iPadOS, and Linux installers are not included in this release.
