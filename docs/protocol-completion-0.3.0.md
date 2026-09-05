# Protocol completion in 0.3.0

Implemented in the requested order, against the [fogWraith protocol documentation](https://github.com/fogWraith/Hotline/tree/main/Docs/Protocol).

## Text and history

The client advertises UTF-8 support and uses it only after the server confirms it. Otherwise it uses MacRoman, including on HOPE connections. Live messages, history, news, errors, file paths, and embedded user/file names use the session encoding. Unsupported MacRoman characters become `?`; decoding no longer guesses UTF-8. CRLF and CR become a single newline.

## Media, files, and dates

The preceding changes completed private-message/private-room attachments, advertised media limits, extended file/folder sizes, and dual-format dates. This pass also corrected large-file uploads: they send raw bytes, while classic uploads retain their FILP wrapper.

## Transfers

Downloads stream to disk, retaining partial data on failure. Downloading the same remote file again can resume when its server/account/path/size/modification timestamp match. Without a usable modification timestamp the client restarts. Unsupported or ignored resume requests fall back to a fresh download. Completed files never overwrite an existing local file.

Classic upload resumes follow the server's RFLT offsets. Large-file uploads verify the server's partial digest before appending; absent or mismatched digests cause a full upload instead.

Right-click a folder and choose **Download**. **Upload Folder** opens the desktop folder picker. Folder streams support nested directories, empty directories, legacy upload resume, and AEAD wrapping. Received paths are confined to a new destination directory. Local links and special files are rejected.

Folder downloads preserve completed files after failure, but retry into a new folder rather than resuming without per-file identity checks. The folder framing's 32-bit per-file length limits individual files; larger files must be uploaded separately. Mobile folder upload is not available.

## Discovery and trackers

A server bookmark's information dialog probes the advisory info port and displays advertised ports, transports, and features. Discovery does not alter saved settings or replace login negotiation.

Trackers negotiate v3, v2, or v1. V3 supports UTF-8 and IPv4, IPv6, and hostname records; metadata fields are parsed and skipped. V2/v3 authentication uses bookmark credentials. Enable TLS on the tracker bookmark to require a certificate-validated connection. Authentication denial does not trigger a downgrade. V3 requests a complete listing; server-side search and pagination are not advertised.

## Custom avatars

Use **Set Avatar** or **Clear Avatar** under the user list. Avatars are fetched on request and refreshed after change notifications. They appear in user lists, user details, and grouped chat, with classic-icon fallback. Caches are scoped to a connection and cleared on disconnect or departure.

Custom avatars are session-specific GIFs, limited locally to 32 KiB, 256 × 256 pixels, 60 frames, and 15 seconds. Up to 256 avatars are retained per connection. Uploads are not automatically repeated after reconnecting.

## Validation

148 Rust tests, 87 frontend tests, and the production web build pass. Fixtures cover negotiated text, history, partial downloads, upload framing and resume digests, folder downloads, tracker authentication/downgrade behavior, IPv6 records, discovery validation, and avatar cache races.

Live classic/modern server interoperability, AEAD folder transfers against a real server, and native/mobile UI testing remain outstanding. The previously generated 0.2.9 DMG predates these changes.
