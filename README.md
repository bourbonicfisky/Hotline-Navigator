
# Hotline Navigator

![Hotline Navigator Banner ogo](https://raw.githubusercontent.com/fuzzywalrus/hotline/refs/heads/main/hotline-tauri/public/hotline-navigator-banner.jpg)

[Official Website](https://hotline.greggant.com)

A modern, cross-platform Hotline client built with **Tauri**, React, and Rust. This is a spiritual port of Dustin Mierau's wonderful [Hotline app](https://github.com/mierau/hotline), with the goal of bringing the classic Hotline protocol to as many modern platforms as possible. It provides multi-session, single window interface and a responsive design.

This port is divergent from the original Swift/macOS Hotline client and is not a direct port, rather a recreation of it in Tauri using React and Rust, the source code providing valuable information about the protocol and how to implement it.

![Hotline Navigator Screenshot](doc-media/v0.2.5-dark-mode-discord.png)

## What the hell is Hotline?

Hotline was a very popular Mac-centric chat/file-sharing service from the late 1990s to roughly 2001. Due to its completely decentralized nature, Hotline remains active, unlike many other early file-sharing services. At its core, it consists of three components: a client, a server, and a tracker. Clients connect to servers. Servers provide files, bulletin boards, and a chat room. Clients connect to said servers. Trackers are indexes of active Hotline servers that let users find Hotline servers.

Hotline in concept, was to replicate a BBS but for the internet age. Modern users would recongize more as a proto peer-to-peer or a Discord like application

Hotline's Navigator's website has a deeper drive [the history of Hotline](https://hotline.greggant.com/history/). 

## Platform Support

Right now the iOS, iPadOS, and Android versions are not in their respective app stores and must be built manually or sideloaded.

| Platform | Architecture | Status |
|----------|--------------|--------|
| **macOS** | x86_64, ARM64 (Universal) | ✅ Supported (macOS 11.0+) |
| **Windows** | x86_64 | ✅ Supported |
| **Linux** | x86_64, ARM64 | ✅ Supported |
| **iOS** | ARM64 | ✅ Supported (iOS 15.0+) |
| **iPadOS** | ARM64 | ✅ Supported (iPadOS 15.0+) |
| **Android** | ARM64, x86_64 | ✅ Supported (Android 7.0+) |

[Download the Latest Release](https://github.com/fuzzywalrus/hotline/releases/)

## About This Project

This is a **Tauri-based Hotline client** that provides a modern, cross-platform experience for the classic Hotline protocol. Built with React and Rust, it offers:

- **Cross-Platform**: Single codebase for macOS, Windows, Linux, iOS, iPadOS, and Android
- **Modern Stack**: React + TypeScript frontend, Rust backend
- **Full Protocol Support**: Chat, file sharing, news, message boards, and more
- **Native Performance**: Tauri's lightweight architecture for fast, efficient apps

![Hotline Navigator Light Mode](doc-media/main-screen.png)

**Note:** This project does not include server software. This is a client for connecting to and participating on Hotline servers. If you would like to host your own Hotline server (and you should!), please check out the very capable [Mobius project](https://github.com/jhalter/mobius) or my port of [Mobius with a GUI and Swift UI](https://github.com/fuzzywalrus/mobius-macOS-GUI/tree/master).

For more details about the Tauri client implementation, see the [`hotline-tauri/README.md`](hotline-tauri/README.md).

## Automated builds

All release builds run on GitHub-hosted Actions runners; no personal machines,
SSH hosts, or self-hosted runners are required. Run these workflows manually
from the Actions tab, or push a `v*` tag:

- **Build macOS, iOS and Android**: macOS universal DMG (signed and notarized),
  unsigned iOS IPA, and Android APK. The historical `build-self-hosted.yml`
  filename is retained so existing workflow dispatch links continue to work.
- **Build Windows**: x64 NSIS installer.
- **Build Linux (Cloud)**: x64 and ARM64 Debian packages and AppImages.

Manual runs upload downloadable workflow artifacts. Apple desktop signing uses
repository secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.
The unsigned iOS artifact requires signing when sideloaded. Android currently
uses a temporary signing key per build, so upgrading between builds may require
uninstalling the previous APK; a persistent release key is needed for seamless
updates. Tagged Apple/Android/Windows runs upload to a draft release; the Linux
workflow attaches packages to an existing release.

## Sideloading on Mobile

### iOS/iPadOS

The iOS/iPadOS IPA is unsigned and must be sideloaded using a signing tool:

- **[AltStore](https://altstore.io/)** / **[SideStore](https://sidestore.io/)** — Free sideloading using your Apple ID. Apps must be refreshed every 7 days (or 365 days with a paid Apple Developer account).
- **[TrollStore](https://github.com/opa334/TrollStore)** — Permanent installs with no expiration, but only available on specific iOS versions (14.0–16.6.1, 17.0).
- **[Sideloadly](https://sideloadly.io/)** — Desktop app for sideloading IPAs via USB.

### Android

Download the APK from the releases page and install it directly. You may need to enable "Install from unknown sources" in your device settings.

## More Info about Hotline

Looking for other Hotline Clients? see [The Hotline Wiki](https://hlwiki.com/index.php?title=Clients) and [Hotline City](https://hotline.retro-os.live/index.php/downloads/category/9-hotline-clients)

