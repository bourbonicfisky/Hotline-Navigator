## Why

Live text and history currently guess different encodings, corrupting non-ASCII names and messages. The client does not yet negotiate UTF-8.

## What Changes

Advertise text-encoding capability bit 1 on every login. Resolve encoding per connection from the server reply before decoding its text: confirmed bit 1 selects UTF-8; otherwise use MacRoman, including HOPE sessions. Apply this to live events, history, news, file paths and embedded names, and errors. Keep passwords and binary identifiers opaque. Replace unrepresentable MacRoman characters with `?`; never silently switch encodings. Normalize line endings without doubling CRLF.

This supersedes the original bookmark override/HOPE inference proposal: the current protocol requires server confirmation and MacRoman fallback. No new bookmark setting is needed. Reference: https://github.com/fogWraith/Hotline/blob/main/Docs/Protocol/Capabilities-Text-Encoding.md
