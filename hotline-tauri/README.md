# Hotline Navigator (Tauri Client)

The Tauri/React/Rust client for the Hotline protocol — part of the [Hotline Navigator](https://github.com/fuzzywalrus/hotline) project. A modern, cross-platform client built with Tauri v2, React, and Rust.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20iOS%20%7C%20iPadOS%20%7C%20Android-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## About

Hotline is a classic Internet protocol and community platform from the 1990s that provided chat, file sharing, news, and message boards. This is a **cross-platform port** of the excellent [Swift/macOS Hotline client](https://github.com/mierau/hotline) by Dustin Mierau — a recreation in Tauri using React and Rust, with the original source providing protocol reference and inspiration.

### Why This Port?

While the original Swift version provides a native macOS experience, this Tauri-based client offers:

- **Cross-Platform Reach**: Runs on macOS, Windows, Linux, iOS, iPadOS, and Android from a single codebase
- **Long-Term Sustainability**: Built on widely-supported technologies (React, Rust, Tauri v2)
- **Broader Community**: Accessible to developers across all platforms
- **Modern Tooling**: Benefits from the React and Rust ecosystems

This project complements the [original Swift client](https://github.com/mierau/hotline). It does not include server software; for hosting your own Hotline server, see [Mobius](https://github.com/jhalter/mobius).

## Features

- **Server Browser**: Tracker server browsing with bookmark management
- **Chat**: Public chat rooms with server broadcasts
- **Private Messaging**: Direct messages with persistent history and unread indicators
- **Private Chat Rooms**: Multi-user private chat with invites, subjects, and member management
- **User Management**: User lists with admin/idle status indicators
- **Message Board**: Read and post to server message boards
- **News**: Browse categories, read articles, post news and replies
- **File Management**: Browse, download, upload files with progress tracking
- **File Preview**: Preview images, audio, and text files before downloading
- **TLS Support**: Secure encrypted connections to TLS-enabled servers (e.g. Mobius on port 5600), with per-bookmark TLS toggle, auto-detect from tracker listings, and an optional legacy TLS 1.0 fallback for older servers
- **Settings**: Username and icon customization with persistent storage
- **Server Banners**: Automatic banner download and display
- **Server Agreements**: Agreement acceptance flow
- **Notifications**: Toast notifications with history log
- **Sound Effects**: Classic Hotline sounds (ported from original)
- **Keyboard Shortcuts**: macOS-style shortcuts (Cmd+K to connect, Cmd+1-4 for tabs, etc.)
- **Context Menus**: Right-click actions throughout the app
- **Dark Mode**: Full dark mode support
- **Transfer List**: Track active and completed file transfers
- **IPv6**: Connect to servers and trackers via IPv6 literals (e.g. `[::1]:5493`) and hostnames that resolve to AAAA
- **Large File Support**: 64-bit file sizes for transfers >4 GB via [capability negotiation](https://github.com/fogWraith/Hotline/blob/main/Docs/Protocol/Capabilities-Large-File.md), backward compatible with legacy servers
- **Mnemosyne Search**: Discover files, news, and message board posts across multiple Hotline servers via [Mnemosyne](https://github.com/benabernathy/mnemosyne) search indexes — ships with a default instance and supports adding custom ones

### Roadmap
- [x] Auto-reconnect on disconnect *(0.2.2)*
- [x] Mnemosyne cross-server search *(0.2.3)*
- [ ] HOPE secure login — re-enable the probe with a reconnect delay (probe-disconnect-reconnect is the intended detection flow per the spec author; INVERSE MAC is the bare minimum for authenticated login without transport encryption)
- [ ] HOPE ChaCha20-Poly1305 AEAD transport and file transfer encryption ([spec](https://github.com/fogWraith/Hotline/blob/main/Docs/Protocol/HOPE-ChaCha20-Poly1305.md))
- [ ] Account management and permissions
- [ ] Bonjour/mDNS server discovery
- [ ] Message filtering and blocking
- [ ] Bookmark import/export

## Getting Started

### Prerequisites
- **Node.js** 20+ (recommended for Vite 7 / modern Tauri tooling)
- **Rust** (stable channel)
- **Tauri v2** — [Platform-specific requirements](https://v2.tauri.app/start/prerequisites/)

**Linux (Debian/Ubuntu)** — install system libraries before building:
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev
```

### Development

1. **Clone the repository** (this client lives in the `hotline-tauri` directory of the main repo)
   ```bash
   git clone https://github.com/fuzzywalrus/hotline.git
   cd hotline/hotline-tauri
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run in development mode**
   ```bash
   npm run dev
   ```
   This starts the Vite frontend only.

4. **Run the full desktop app in development mode**
   ```bash
   npm run tauri dev
   ```

### Debugging

The app includes a built-in debug logging system that is **active only in development builds** (`npm run tauri dev`) and completely stripped from production/distributed builds.

**Viewing logs:** Right-click anywhere in the running dev app → **Inspect Element** → **Console** tab. All debug output appears in the browser console.

**How it works:** The logger utility (`src/utils/logger.ts`) wraps `console.log` behind `import.meta.env.DEV`, which Vite statically replaces at build time. In production builds, the bundler dead-code-eliminates all `log()` calls — zero runtime cost.

**Log format:** All messages are prefixed with a category tag for easy filtering:

```
[Chat]        Chat messages, private messages, broadcasts, private chat rooms
[Users]       User join/leave/change events, disconnect actions
[Files]       File list requests/responses, folder creation
[Transfer]    Download/upload start, progress, completion, errors
[News]        News categories, articles, posting, navigation
[Board]       Message board loading and posting
[Connection]  Status changes, server info, connect/disconnect
[Banner]      Server banner download lifecycle
[Agreement]   Server agreement detection and acceptance
[Permissions] User access permission bitmask
```

**Filtering in the console:** Type a category name (e.g. `[Transfer]`) into the browser console's filter box to isolate logs for a specific subsystem.

**Error logging:** `error()` calls always log to `console.error` regardless of build mode — these represent real problems that should never be silenced.

**Rust backend debugging:** Rust `println!` output may not appear in the Tauri dev console. For backend debugging, write to `/tmp/hotline-debug.log` using file I/O, or check the terminal where `npm run tauri dev` is running.

## Building

**Platform support:** macOS (x86_64, ARM64, Universal), Windows (x86_64, ARM64), Linux (x86_64, ARM64), iOS, iPadOS, and Android. Mobile builds are not in app stores and must be built or sideloaded. See the [main project README](https://github.com/fuzzywalrus/hotline#platform-support) for details.

### Desktop

**Frontend only:**
```bash
npm run build
```

**Full application bundle:**
```bash
npm run tauri build
```

**Windows:**
```bash
npm run build:windows          # Windows x86_64 (MSVC)
```

**macOS:**
```bash
npm run build:macos-universal    # Universal binary (Intel + Apple Silicon)
npm run build:macos-intel        # Intel (x86_64) only
npm run build:macos-silicon      # Apple Silicon (aarch64) only
```

**Linux (including ARM64):**
```bash
# Add Rust target for native ARM64 builds (on an ARM machine) or when using a proper cross toolchain
rustup target add aarch64-unknown-linux-gnu

# Build for x86_64 Linux
npm run build:linux

# Build for Linux ARM64 (aarch64)
npm run build:linux-arm
```

Notes:
- Cross-compiling from x86_64 to `aarch64-unknown-linux-gnu` requires an aarch64 cross toolchain (for example `aarch64-linux-gnu-gcc`) or using Docker/CI running on ARM64. For static MUSL builds you may need the `aarch64-unknown-linux-musl` target and musl cross toolchain.
- The `build-release-linux-arm64.sh` helper script attempts to add the ARM64 Rust target automatically.

### Mobile

**iOS / iPadOS** (requires Xcode and CocoaPods; minimum iOS 15.0 in config; see repo root for sideloading):
```bash
npm run ios:init                 # One-time: generate Xcode project
npm run build:ios                # Build for device
npm run build:ios-simulator      # Build for simulator
npm run ios:dev                  # Run on device
npm run ios:dev:simulator        # Run in simulator (default: iPad Pro 11-inch M4)
```

**Android** (requires Android SDK/NDK; see repo root for sideloading):
```bash
npm run android:init             # One-time: initialize Android project
npm run build:android             # Build release APK
npm run build:android-debug      # Build debug APK
npm run build:android-aab        # Build App Bundle for Play Store
npm run android:dev              # Run on device/emulator
```

### Multi-Platform Release

```bash
npm run build:release-all
```
This runs the macOS, Windows, Linux, and Linux ARM64 build scripts in sequence and packages artifacts under `release/`.

### macOS Code Signing

For distribution-ready builds with code signing:

1. **Create `.env` file** in project root:
   ```bash
   APPLE_ID="your-apple-id@example.com"
   APP_PASSWORD="your-app-specific-password"
   TEAM_ID="YOUR_TEAM_ID"
   SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
   ```

2. **Run release build:**
   ```bash
   npm run build:release
   ```

   This will:
   - Build a Universal Binary
   - Code sign the application
   - Verify signatures
   - Create a DMG (if `create-dmg` is installed)
   - Output to `release/hotline-navigator-{version}-macos/`

**Notarization:** the script submits the app to Apple notarization with `notarytool`, staples the result to the `.app`, and, when `create-dmg` is installed, also signs, notarizes, and staples the generated DMG.

**Note:** The `.env` file is gitignored and contains sensitive credentials.

**macOS requirements:**
- Both Rust targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- Minimum macOS version: Big Sur (11.0)
- Universal binaries recommended for distribution

## Testing & Quality

**Rust (`cargo test` in `src-tauri/`):**
```bash
cd hotline-tauri/src-tauri && cargo test
```

This exercises the inline Rust test modules that live alongside the implementation, primarily under `src-tauri/src/protocol/`:
- transaction encoding/decoding
- Hotline constants and helpers
- IPv4/IPv6 socket address formatting
- HOPE MAC/key derivation and encrypted stream behavior
- selected async client behavior

**Frontend (Vitest in `src/`):**
```bash
cd hotline-tauri && npm run test
```

Frontend tests are colocated with the code they cover, with shared test setup in `src/test/setup.ts`. Current coverage is focused on:
- Zustand stores such as `src/stores/notificationStore.test.ts`
- utility modules such as `src/utils/mentions.test.ts`
- Mnemosyne search: `src/components/mnemosyne/MnemosyneWindow.test.tsx` (stats, search, filters, URL normalization)

Watch mode: `npm run test:watch`. Coverage: `npm run test:coverage`.

**Linting and type checking:**
```bash
npm run typecheck
npm run lint
```

## Architecture

### Technology Stack

**Frontend:**
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite 7** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **@dnd-kit** - Drag and drop functionality

**Backend:**
- **Rust** - Systems programming language
- **Tauri v2** - Desktop application framework
- **Tokio** - Async runtime
- **Serde** - Serialization/deserialization

### State Management
- **Frontend**: Zustand stores with persistence to localStorage
- **Backend**: Rust AppState with Arc<RwLock<T>> for thread-safe access
- **Communication**: Tauri IPC commands and events

### Protocol Implementation
- Clean-room Rust implementation of the Hotline protocol
- Uses the original Swift client as reference for protocol details
- Async/await architecture with Tokio for network operations
- Event-driven design for real-time updates

### Cross-Platform Considerations
- Platform-agnostic file paths using Tauri's path API
- Conditional platform features (keyboard shortcuts adapt to OS)
- Responsive layout that works on different screen sizes

### Project Structure

```
hotline-tauri/
├── src/                          # React frontend (TypeScript + Vite)
│   ├── main.tsx                  # Frontend entry point
│   ├── App.tsx                   # Top-level application shell
│   ├── assets/                   # App images and static UI assets
│   ├── components/
│   │   ├── tracker/              # Server browser and bookmarks
│   │   ├── server/               # Server window shell
│   │   │   └── hooks/            # Server-specific event/handler hooks
│   │   ├── chat/                 # Public and private chat
│   │   ├── board/                # Message board
│   │   ├── news/                 # News reader
│   │   ├── files/                # File browser
│   │   ├── mnemosyne/            # Mnemosyne search integration
│   │   ├── about/                # About dialog
│   │   ├── users/                # User list and info
│   │   ├── settings/             # Preferences
│   │   ├── notifications/        # Toast notifications
│   │   ├── transfers/            # Transfer manager
│   │   ├── update/               # App update UI
│   │   ├── common/               # Shared UI (e.g. Linkify, ContextMenu)
│   │   └── tabs/                 # Tab bar
│   ├── stores/                   # Zustand state management
│   ├── hooks/                    # Custom React hooks
│   ├── test/                     # Frontend test setup/helpers
│   ├── types/                    # TypeScript definitions
│   └── utils/                    # Shared utility functions (logger, sounds, etc.)
├── src-tauri/                    # Rust backend
│   ├── capabilities/             # Tauri capability definitions
│   ├── gen/                      # Generated mobile/project artifacts
│   ├── icons/                    # App icons for bundles/platforms
│   ├── src/
│   │   ├── protocol/             # Hotline protocol implementation
│   │   │   ├── client/           # Client connection, file transfer, HOPE/TLS
│   │   │   ├── tracker.rs        # Tracker protocol
│   │   │   ├── types.rs          # Protocol types
│   │   │   ├── transaction.rs    # Transaction handling
│   │   │   └── constants.rs      # Protocol constants
│   │   ├── state/                # Application state
│   │   ├── commands/             # Tauri IPC commands
│   │   ├── lib.rs                # Tauri app setup and command registration
│   │   └── main.rs               # Native entry point delegating to lib.rs
│   └── tauri.conf.json           # Tauri configuration
├── build-release.sh              # Signed macOS release helper
├── build-release-all.sh          # Multi-platform release helper
├── build-release-linux-arm64.sh  # Linux ARM64 packaging helper
└── public/                       # Static web assets bundled by Vite/Tauri
    ├── icons/                    # Optional local icon assets (if bundled)
    └── sounds/                   # Optional local sound assets (if bundled)
```

## Protocol Details

These sections document the protocol implementation details for contributors and client authors. For the Hotline protocol spec itself, see [fogWraith/Hotline Docs/Protocol](https://github.com/fogWraith/Hotline/tree/main/Docs/Protocol).

### TLS (Encrypted Connections)

Hotline Navigator supports TLS connections to servers that offer encryption (such as [Mobius](https://github.com/jhalter/mobius) v0.20+). TLS wraps the TCP connection before the Hotline protocol handshake, protecting credentials and data in transit.

By default, the client uses modern TLS (TLS 1.2+) via `rustls`. For older Hotline servers that only speak legacy TLS, there is an opt-in compatibility setting in `Settings > General > Allow Legacy TLS (1.0/1.1)`. When enabled, the client still tries modern TLS first, then reconnects and retries with a TLS 1.0-compatible OpenSSL handshake if the modern handshake fails. This is less secure and is meant only for retro servers that cannot negotiate newer TLS versions.

**Per-bookmark TLS:** Each bookmark has a "Use TLS" toggle. When enabled, the client connects on the specified port (typically 5600) using TLS. Toggling TLS on/off in the Connect or Edit Bookmark dialogs automatically switches between port 5600 and 5500.

**Auto-Detect TLS:** An opt-in setting (Settings > General > Auto-Detect TLS) that automatically tries a TLS connection when connecting from tracker listings. When enabled, the client attempts to connect on port+100 with TLS first; if TLS succeeds, it uses that secure connection. If the TLS attempt fails, it can optionally retry with legacy TLS when `Allow Legacy TLS` is enabled, and if that still fails or times out it falls back to a plain connection on the original port. This works transparently once the settings are enabled.

<details>
<summary><strong>Implementation guide for client authors</strong></summary>

Hotline TLS follows the convention established by [Mobius](https://github.com/jhalter/mobius): TLS is served on a port 100 higher than the plain Hotline port (e.g. plain on 5500, TLS on 5600). TLS wraps the raw TCP socket *before* the Hotline protocol handshake — the protocol bytes on the wire are identical, just encrypted. File transfers follow the same pattern (transfer port = server port + 1, so TLS transfers on 5601).

This client has two TLS paths:

1. **Modern TLS (default).** Uses `rustls` and targets TLS 1.2+.
2. **Legacy TLS compatibility mode (opt-in).** Uses vendored OpenSSL, pins the handshake to TLS 1.0 for maximum compatibility with Tiger/Leopard-era SecureTransport servers, disables SNI, accepts self-signed certificates, and enables older cipher suites/legacy renegotiation support. It is only attempted after a failed modern TLS handshake and only when the user explicitly enables `Allow Legacy TLS`.

To implement auto-detect TLS in your own client:

1. **Try modern TLS first, then plain if needed.** Attempt a full TLS connection on port+100 with a reasonable timeout. If it succeeds, you're done. If it fails or times out, either retry with an opt-in legacy TLS mode or connect on the original port without TLS.
2. **Reconnect before retrying legacy TLS.** A failed TLS handshake consumes the TCP stream. If you want to retry on the same TLS port with older protocol settings, open a fresh socket first.
3. **Do not probe separately.** An earlier approach of opening a TCP connection to check if the TLS port was open, then closing it and opening a second connection for the real TLS handshake, caused the server to reject the second connection. Hotline servers (particularly Mobius) appear to treat the aborted probe as a bad client and temporarily refuse connections from the same IP. The correct approach is to attempt the real TLS handshake on the first connection.
4. **SNI with IP addresses.** Go's `crypto/tls` server rejects the TLS IP Address SNI extension (`ServerName::IpAddress`). When connecting by IP rather than hostname, either omit the SNI extension entirely or send a dummy DNS hostname (we use `"hotline"`). Since Hotline servers use self-signed certificates, the SNI value only affects certificate selection, not validation. For very old TLS stacks, disabling SNI entirely may be the safer option.
5. **Certificate verification.** Hotline servers use self-signed certificates, so TLS clients must either skip verification or implement a trust-on-first-use model. We skip verification entirely (`InsecureSkipVerify` equivalent for modern TLS; `SslVerifyMode::NONE` for the legacy compatibility path).
6. **Per-bookmark persistence.** Store whether a bookmark uses TLS so users don't pay the auto-detect timeout cost on every connection. Auto-detect is best suited for tracker listings where TLS capability isn't known in advance.
7. **Treat legacy TLS as a compatibility escape hatch.** If you support TLS 1.0/1.1 for old servers, gate it behind an explicit user setting and prefer modern TLS whenever possible.

</details>

### File Transfers (HTXF)

Hotline file transfers happen on a separate TCP connection from the main chat/command connection. When you download or upload a file, the client first asks the server on the main connection ("I'd like to download X"). The server replies with a **reference number** — a temporary token that identifies this specific transfer. The client then opens a *second* TCP connection to the server's transfer port (main port + 1, so typically 5501) and sends a 16-byte handshake:

```
Bytes 0-3:   "HTXF"              <- The file-transfer protocol ID (4 ASCII bytes)
Bytes 4-7:   Reference number    <- The token the server gave us
Bytes 8-11:  Transfer size       <- For uploads: total bytes we're sending. For downloads: 0
Bytes 12-15: Flags               <- Usually 0 for legacy transfers
```

After the handshake, file data flows as a **FILP** (Flattened File) stream. A FILP wraps one or more "forks" — the DATA fork is the actual file content, and there may also be an INFO fork (metadata) or MACR fork (classic Mac resource fork). Each fork has a 16-byte header describing its type and size, followed by the raw fork data.

For TLS-enabled servers, the transfer connection is also wrapped in TLS using the same approach as the main connection. That means modern TLS is attempted first, and if `Allow Legacy TLS` is enabled the transfer socket can reconnect and retry with the legacy TLS 1.0-compatible path before giving up.

<details>
<summary><strong>Large file support (>4 GB)</strong></summary>

The original Hotline protocol used 32-bit integers for file sizes, capping transfers at ~4.3 GB. Hotline Navigator implements the [Large File extension](https://github.com/fogWraith/Hotline/blob/main/Docs/Protocol/Capabilities-Large-File.md) drafted by [fogWraith/HLServer](https://github.com/fogWraith/HLServer), which adds 64-bit file size support through a capability negotiation mechanism:

1. **Negotiation:** During login, the client sends a `DATA_CAPABILITIES` field (ID `0x01F0`) with bit 0 set, advertising large file support. If the server understands and supports it, it echoes the capability back in its reply. If the server doesn't recognize the field, it simply ignores it — no harm done.

2. **64-bit fields:** When large file mode is active, the server sends additional 64-bit companion fields alongside the legacy 32-bit ones: `FileSize64` (`0x01F1`), `TransferSize64` (`0x01F3`), etc. The client reads the 64-bit value when present and falls back to the 32-bit value for legacy servers.

3. **Extended HTXF handshake:** The flags field (bytes 12-15) gains two bits: `HTXF_FLAG_LARGE_FILE` (0x01) signals large file mode is active, and `HTXF_FLAG_SIZE64` (0x02) means an additional 8 bytes follow the standard 16-byte header, carrying the full 64-bit transfer length.

4. **Fork header reinterpretation:** In large file mode, the 16-byte fork header layout changes — bytes 4-7 become the *high* 32 bits of the fork size and bytes 12-15 become the *low* 32 bits, combining into a full 64-bit length.

This is fully backward compatible: legacy servers that don't understand the capabilities field ignore it, and Navigator operates in standard 32-bit mode. The extension only activates when both client and server agree.

</details>

### HOPE (Secure Login & Transport Encryption)

HOPE (Hotline One-time Password Extension) is a protocol extension that replaces Hotline's weak XOR-0xFF password obfuscation with proper MAC-based authentication and optional transport encryption (RC4). The spec lives at [fogWraith/Hotline HOPE-Secure-Login.md](https://github.com/fogWraith/Hotline/blob/main/Docs/Protocol/HOPE-Secure-Login.md).

**Current status: implemented and opt-in.** The client will attempt HOPE only when a bookmark explicitly enables it. That avoids poisoning non-HOPE servers while still allowing secure login and RC4 transport encryption on known-compatible servers such as Janus-family servers.

**The problem:** HOPE login starts by sending a Login transaction with `UserLogin` set to a single `0x00` byte. Servers that understand HOPE recognize this as a negotiation request and reply with a session key. Servers that don't understand HOPE treat it as a real login attempt with an invalid username — they reject it, close the connection, and may temporarily block the client's IP. This makes blind auto-probing unsuitable for general use.

<details>
<summary><strong>Enabling HOPE & implementation details</strong></summary>

**How HOPE is enabled safely today:**

1. **Per-bookmark opt-in** — The UI exposes a `Use HOPE (Secure Login)` toggle for servers known to support HOPE.
2. **Probe only on opt-in** — The login flow only calls `try_hope_probe()` when that bookmark flag is set.
3. **Reconnect on probe failure** — If the server does not complete HOPE negotiation, the client reconnects before falling back to legacy login.
4. **Encrypted reply timing** — If RC4 is negotiated, the authenticated login is sent plaintext, transport keys are activated immediately after, and the login reply is read encrypted.

**How HOPE works (the 3-step login):**

1. **Client sends identification** — A Login transaction with `UserLogin = 0x00`, a list of supported MAC algorithms (strongest first), the app ID (`HTLN`), and optionally supported ciphers (currently `RC4`).

2. **Server replies** — If it supports HOPE, it sends back a 64-byte session key, its chosen MAC algorithm, and chosen ciphers. If it doesn't, the login fails (see "the problem" above).

3. **Client sends authenticated login** — The password is MAC'd with the session key instead of XOR'd. After a successful login, if both sides agreed on a cipher (e.g. RC4), transport encryption is activated for all subsequent transactions on the main connection. File transfers on port+1 remain unencrypted — they use their own separate connections.

**Transport encryption details:**

- RC4 stream cipher encrypts each transaction (header + body) as it goes over the wire
- Key rotation provides forward secrecy: after each packet, `new_key = MAC(current_key, session_key)`, and RC4 is re-initialized
- The rotation count is carried in the first byte of the encrypted packet representation used by this client/server interop path
- Encryption is packet-aware — the reader/writer know transaction boundaries, which is why this uses custom `HopeReader`/`HopeWriter` wrappers rather than a byte-stream encryption layer

See [HOPE_IMPLEMENTATION.md](HOPE_IMPLEMENTATION.md) for a map of all HOPE-related code locations.
See [HOPE_JANUS_INTEROP.md](HOPE_JANUS_INTEROP.md) for the working Janus/VesperNET sequence and server interoperability notes.

</details>

### Access Privileges

Hotline access privileges are a 64-bit bitmap sent in the `UserAccess` field (FieldType 116) during login. Each bit controls a specific permission. The following table is based on fogWraith's Wireshark analysis of official Hotline 1.2.3 and 1.9 servers/clients, cross-referenced with the [Hotline Wiki](https://hlwiki.com/index.php/AccessPriviledges).

**Important:** Bits are indexed from the MSB of the 8-byte field. Bit 0 is the highest bit of byte 0. To test bit N: `(access[N / 8] >> (7 - (N % 8))) & 1`, or equivalently for a 64-bit integer: `(access >> (63 - N)) & 1`.

| Bit | Name | 1.2.3 | 1.9 | Notes |
|-----|------|-------|-----|-------|
| 0 | Can Delete Files | yes | yes | |
| 1 | Can Upload Files | yes | yes | |
| 2 | Can Download Files | yes | yes | |
| 3 | Can Rename Files | yes | yes | |
| 4 | Can Move Files | yes | yes | |
| 5 | Can Create Folders | yes | yes | |
| 6 | Can Delete Folders | yes | yes | |
| 7 | Can Rename Folders | yes | yes | |
| 8 | Can Move Folders | yes | yes | |
| 9 | Can Read Chat | yes | yes | confirmed by toggle test |
| 10 | Can Send Chat | yes | yes | confirmed by toggle test |
| 11 | Can Initiate Private Chat | — | yes | new in 1.5+; absent from 1.2.3 |
| 12 | Close Chat | — | — | documented, never implemented |
| 13 | Show in List | — | — | documented, never implemented |
| 14 | Can Create Users | yes | yes | |
| 15 | Can Delete Users | yes | yes | |
| 16 | Can Read Users | yes | yes | |
| 17 | Can Modify Users | yes | yes | |
| 18 | Change Own Password | — | — | documented, never implemented |
| 19 | Send Private Message | — | — | documented, never implemented |
| 20 | Can Read News | yes | yes | |
| 21 | Can Post News | yes | yes | |
| 22 | Can Disconnect Users | yes | yes | |
| 23 | Cannot be Disconnected | yes | yes | |
| 24 | Can Get User Info | yes | yes | |
| 25 | Can Upload Anywhere | yes | yes | |
| 26 | Can Use Any Name | yes | yes | |
| 27 | Don't Show Agreement | yes | yes | |
| 28 | Can Comment Files | yes | yes | |
| 29 | Can Comment Folders | yes | yes | |
| 30 | Can View Drop Boxes | yes | yes | |
| 31 | Can Make Aliases | yes | yes | |
| 32 | Can Broadcast | — | yes | new in 1.5+; confirmed by toggle test |
| 33 | Can Delete News Articles | — | yes | new in 1.5+ |
| 34 | Can Create News Categories | — | yes | new in 1.5+ |
| 35 | Can Delete News Categories | — | yes | new in 1.5+ |
| 36 | Can Create News Bundles | — | yes | new in 1.5+ |
| 37 | Can Delete News Bundles | — | yes | new in 1.5+ |
| 38 | Can Upload Folders | — | yes | new in 1.5+ |
| 39 | Can Download Folders | — | yes | new in 1.5+ |
| 40 | Can Send Message | — | yes | instant/private messaging |
| 41–54 | (GLoarbLine extensions) | — | — | third-party server extensions |
| 55 | Voice Chat | — | — | Janus extension |
| 56–63 | Unused | — | — | |

**Note on bit 19 vs 40:** The Hotline Wiki lists bit 19 as "Send Private Message" but fogWraith's Wireshark captures show it was never implemented in official clients. Bit 40 is the actual "Can Send Message" privilege used by Hotline 1.9 for instant/private messaging. [Mobius](https://github.com/jhalter/mobius) also uses bit 40. Navigator checks bit 40 for private message permissions.

### Error Handling

Hotline Navigator uses a two-tier error handling system to give users clear, actionable feedback when something goes wrong.

**Tier 1 — Backend error resolution (`resolve_error_message`):** When the Rust protocol client receives a non-zero error code from the server, it first checks for a server-provided `ErrorText` field (FieldType 100), which many servers include with a human-readable description. If no `ErrorText` is present, it falls back to the [HL Error Codes](https://hlwiki.com/index.php/HL_ErrorCodes) spec — a set of well-known error codes defined in `HotlineErrorCode` (`src-tauri/src/protocol/constants.rs`):

| Code | Name | Fallback Message |
|------|------|-----------------|
| 0 | None | No error |
| -1 | Generic | A non-specific error occurred |
| 1 | NotConnected | The connection is no longer active |
| 2 | Socket | A network socket error occurred |
| 1000 | LoginFailed | Invalid login credentials |
| 1001 | AlreadyLoggedIn | Already logged in to this server |
| 1002 | AccessDenied | Access denied |
| 1003 | UserBanned | Banned from this server |
| 1004 | ServerFull | Server is full |
| 2000 | FileNotFound | File or folder not found |
| 2001 | FileInUse | File is in use by another process |
| 2002 | DiskFull | Server disk is full |
| 2003 | TransferFailed | File transfer failed |
| 3000 | NewsFull | News database is full |
| 3001 | MsgRefused | Recipient has refused private messages |

For unrecognized codes, it displays "Unknown error (code N)". Server-provided text always takes priority — the table above is only used when the server doesn't send an `ErrorText` field.

**Tier 2 — Frontend error classification (`classifyError`):** Error strings from the backend are passed to the frontend classifier (`src/utils/errorClassifier.ts`), which categorizes them by keyword matching into categories like `dns`, `timeout`, `refused`, `tls`, `protocol`, `auth`, `transfer`, and `cancelled`. Each category maps to a user-friendly title, message, and recovery suggestion.

**Display paths:**
- **Connection errors** (login, handshake, server full, banned) → `classifyError()` → **ErrorModal** with icon, explanation, and retry button
- **Operational errors** (file transfers, news, chat) → **toast notifications** with the resolved error message

### Icon System

Hotline servers assign each user a numeric icon ID displayed next to their name in chat and the user list.

**Bundled icons:** The app ships with 631 classic Hotline icons in `public/icons/classic/`, named by ID (e.g. `191.png`). These are 16x16 PNGs rendered with `image-rendering: pixelated` to preserve their pixel art look.

**Remote fallback (hlwiki.com):** Many servers use custom icon IDs beyond the bundled set. When a local icon isn't found, the client loads it from the [hlwiki.com Icon Gallery](https://hlwiki.com/index.php?title=Icon_Gallery):

```
https://hlwiki.com/ik0ns/{id}.png
```

The fallback chain in `src/components/users/UserIcon.tsx`:

1. Try local path `/icons/classic/{id}.png`
2. If that fails and "Remote Icons" is enabled, try `https://hlwiki.com/ik0ns/{id}.png`
3. If the remote also fails (or remote icons are disabled), show a gray box with the numeric ID

Remote images render at natural size, clipped to the icon container — no scaling. This matters because some hlwiki icons are actually banners.

**Banner icons:** Some icon IDs on hlwiki.com are wide "banner" images (232x18) meant to display behind usernames rather than as square icons. The `UserBanner` component in `UserIcon.tsx` handles these:

- Probes whether the icon exists locally (hidden `<img>` load test)
- If the icon is NOT local and remote icons are enabled, fetches from hlwiki.com and renders the banner behind the username row at native size with 80% opacity
- The "Show Banners" preference controls banner display — when off, remote icons still load but get clipped to normal icon size

**Preferences** (in `preferencesStore.ts`, persisted under the `hotline-preferences` localStorage key):

| Setting | Default | What it does |
|---------|---------|--------------|
| `useRemoteIcons` | `true` | Load missing icons from hlwiki.com |
| `showRemoteBanners` | `true` | Show wide banner icons at full size behind usernames |

Both toggles are in Settings > General.

**Adding bundled icons:** Drop a PNG named `{id}.png` into `public/icons/classic/`. Local icons always take priority over the remote fallback.

### Mnemosyne Search

[Mnemosyne](https://github.com/benabernathy/mnemosyne) is an optional indexing service for the Hotline ecosystem. Hotline servers that opt in periodically sync their content (message board posts, news articles, and file listings) to a Mnemosyne instance, which provides a full-text search API over the aggregated index. This lets users discover servers and content *before* connecting.

**Default instance:** The app ships with [vespernet.net](http://tracker.vespernet.net:8980) pre-configured. New installations get this automatically; existing installations are prompted to add it on first launch after the feature is available.

**Adding custom instances:** Open the Connect dialog (Cmd+K) and select "Mnemosyne (Search)" from the Type dropdown. Enter a name and the instance URL, optionally test the connection, then click Add. The instance appears in the tracker bookmark list and can be opened from the Search button in the tracker header.

**How it works in the UI:**

1. Mnemosyne instances appear at the bottom of the tracker bookmark list with a purple search icon
2. Clicking one (or the Search header button) opens a new tab with a search bar
3. The empty state fetches `/api/v1/stats` and displays the number of indexed servers, files, posts, and articles
4. Type a query and press Enter to search — results show type labels (File/Board/News), content preview, source server name, and metadata
5. Filter results by type using the All/Board/News/Files toggle buttons
6. Hover a result to reveal a Connect button that joins the source Hotline server as a guest

**CORS and the Rust proxy:** Browser-side `fetch()` to Mnemosyne instances is blocked by CORS (the webview origin is `localhost` or `tauri://`). All Mnemosyne HTTP requests go through the `mnemosyne_fetch` Tauri command, which uses `reqwest` on the Rust side to bypass CORS entirely. The command accepts a URL string, makes a GET request with a 10-second timeout, and returns the JSON response or an error string.

**API endpoints used:**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Connection test (used in the Add dialog) |
| `GET /api/v1/stats` | Index statistics shown in the empty search state |
| `GET /api/v1/search?q=...&type=...&limit=20` | Full-text search |

**Storage:** Mnemosyne bookmarks are persisted in `localStorage` under the `mnemosyne-bookmarks` key as a JSON array of `{ id, name, url }` objects. They are managed by the `mnemosyneBookmarks` slice of the Zustand app store.

<details>
<summary><strong>Implementation details for contributors</strong></summary>

**Key files:**

| File | Purpose |
|------|---------|
| `src/components/mnemosyne/MnemosyneWindow.tsx` | Search tab UI: search bar, filters, results list, stats display, connect-from-result |
| `src/components/mnemosyne/MnemosyneWindow.test.tsx` | 21 tests covering stats, search, filters, errors, URL normalization |
| `src/components/tracker/ConnectDialog.tsx` | "Mnemosyne (Search)" type in the Connect dialog with URL/name fields and connection test |
| `src/components/tracker/BookmarkList.tsx` | Renders Mnemosyne instances in the tracker bookmark list |
| `src/components/tracker/TrackerWindow.tsx` | Search header button (hidden when no instances exist) |
| `src/stores/appStore.ts` | `mnemosyneBookmarks` state, `addMnemosyneBookmark` / `removeMnemosyneBookmark` actions, localStorage persistence, default seeding |
| `src/types/index.ts` | `MnemosyneBookmark`, `MnemosyneSearchResponse`, `MnemosyneSearchResult`, and per-type data interfaces |
| `src-tauri/src/commands/mod.rs` | `mnemosyne_fetch` Tauri command (reqwest-based HTTP proxy) |

**URL normalization:** User-entered URLs that lack a protocol prefix (e.g. `tracker.vespernet.net:8980`) are automatically prefixed with `http://` before being passed to the `URL` constructor.

**Tab system:** Mnemosyne tabs use `type: 'mnemosyne'` with a `mnemosyneId` field linking to the bookmark. Tab deduplication prevents opening the same instance twice. Tabs show a magnifying glass icon and can be closed like server tabs.

**Rate limiting:** The Mnemosyne API enforces 120 requests/minute per IP. The client fires searches on Enter (not on every keystroke) to stay well within limits. The UI displays rate limit errors and a retry button.

</details>

## Contributing

Contributions are welcome! This project benefits from:
- Bug reports and feature requests via GitHub Issues
- Code contributions via Pull Requests
- Protocol documentation and implementation notes
- Testing on different platforms

When contributing, please:
1. Follow the existing code style
2. Add tests for new features
3. Update documentation as needed
4. Test on your target platform

## Credits

This project is a port of the excellent **[Hotline client for macOS](https://github.com/mierau/hotline)** by **Dustin Mierau**. The original Swift implementation provided the protocol reference, UI inspiration, and feature set that made this cross-platform port possible.

The Hotline protocol itself was created by **Hotline Communications** in the 1990s.

## License

MIT License - See LICENSE file for details

## Links

- **Official Website**: https://hotline.greggant.com
- **Hotline Navigator (this repo)**: https://github.com/fuzzywalrus/hotline
- **Releases**: https://github.com/fuzzywalrus/hotline/releases
- **Original Swift Client**: https://github.com/mierau/hotline
- **Mobius (Hotline server)**: https://github.com/jhalter/mobius
- **Issue Tracker**: https://github.com/fuzzywalrus/hotline/issues

---

*Bringing the classic Hotline experience to modern platforms*

### Saved password protection

Saved server passwords require a passphrase (at least 12 characters). Choose it
when first saving or using a saved password, then unlock once per app session.
The passphrase is not stored. Forgotten passphrases cannot be recovered.

Existing password-vault entries migrate when the vault is first opened. The old
snapshot is removed only after the protected snapshot is saved; a failed migration
leaves the original available for retry. Cancelling leaves saved passwords locked.
Editing a bookmark keeps its saved password unless **Remove saved password** is selected.

### Protocol completion

Private messages and private rooms support the same image attachments as public
chat. Failed sends retain drafts; reconnects discard old media handles. The client
honors advertised image byte, dimension, pixel, animation, and chunk limits, with
conservative defaults when fields are absent and local safety ceilings.

File Info now fetches server details, including 64-bit sizes and creation/modification
dates. News and file dates accept both Mac-1904 and modern formats; modern-date
capability is advertised. Folder request metadata uses 64-bit sizes/counts, but
whole-folder transfer execution and resume remain separate work. History uses
MacRoman consistently with the current session; UTF-8 negotiation remains separate.
