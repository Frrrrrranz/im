# Windows development

Windows support targets x64 desktop builds with the MSVC Rust toolchain and
the WebView2 runtime. The first version uses the system title bar and a
current-user NSIS installer; it does not require administrator rights.

## Prerequisites

- Node.js 22 and npm
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio 2022 Build Tools with Desktop development with C++ and a
  Windows SDK
- WebView2 Runtime

From a clean checkout:

```powershell
npm ci
npm run typecheck
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles nsis
```

The debug installer is written below
`src-tauri/target/debug/bundle/nsis/`. The release workflow remains macOS-only
because the updater feed and signing keys have not yet been designed for a
multi-platform release.

## Runtime differences

- `File → Close` and the title-bar close button exit the Windows process.
- Quick Input is available only after choosing a shortcut. `Alt+Space` is not
  enabled by default because Windows reserves it for the window menu.
- Cross-application selection quoting and the macOS Accessibility prompt are
  not available. Quick Input still accepts typed text and submits it normally.
- The data directory is under the Tauri application data directory (normally
  `%APPDATA%\im`); `IM_DATA_DIR` can override it for tests. Settings, providers,
  keys, sessions, and exports use the same JSON schema as macOS.
- Provider API keys are stored as plaintext in `keys.json` under that directory;
  the Windows MVP does not use Windows Credential Manager. Keep the data
  directory private when sharing backups or diagnostics.
- PNG, JPEG, and WebP attachments are supported. HEIC/TIFF decoding is not a
  Windows compatibility promise until it has been verified in WebView2.

The installer does not remove the user's data directory during uninstall.
