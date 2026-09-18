# Windows

Windows support targets Windows 10/11 on x64 with the WebView2 runtime.
The app uses the system title bar and a current-user NSIS installer.

## Install & update

Download [im_x64-setup.exe](https://github.com/yetlinghao/im/releases/latest/download/im_x64-setup.exe)
and run it. It installs for your account without administrator rights and
downloads WebView2 if the runtime is missing. The installer is not
Authenticode-signed, so Windows may show SmartScreen on the first install.

Updates use the same signed release feed as macOS. The sidebar offers new
versions; **Settings → General → Version** also checks for updates manually.
Uninstalling leaves your conversations and settings in place.

## Prerequisites

- Node.js 22 and npm
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio 2022 Build Tools with Desktop development with C++ and a
  Windows SDK
- WebView2 Runtime

From a clean checkout:

```powershell
npm ci
npm run biome:check
npm run typecheck
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles nsis --config .github/tauri-ci.json
```

The debug installer is written below `src-tauri/target/debug/bundle/nsis/`.
The CI override disables updater signing for local builds and PRs, which do
not have the release private key. Tagged releases build macOS and Windows
together with signing enabled; see [Releasing](DEVELOPMENT.md#releasing).

## Runtime differences

- The title-bar close button and **Alt+F4** exit the Windows process. The app
  uses in-window controls and native context menus without a menu bar.
- Most shortcuts use **Ctrl** in place of **⌘**. **Ctrl+Shift+S** toggles the
  sidebar, **Ctrl+Alt+T** toggles the trajectory, and **Ctrl+Shift+[ / ]** moves
  between chats. Button tooltips show the Windows shortcuts.
- Quick Input is available only after choosing a shortcut. `Alt+Space` is not
  enabled by default because Windows reserves it for the window menu.
- Cross-application selection quoting and the macOS Accessibility prompt are
  not available. Quick Input still accepts typed text and submits it normally.
- The data directory is `%APPDATA%\im`; `IM_DATA_DIR` can override it for tests. Settings, providers,
  keys, sessions, and exports use the same JSON schema as macOS.
- Provider API keys are stored as plaintext in `keys.json` under that directory;
  the app does not use Windows Credential Manager. Keep the data
  directory private when sharing backups or diagnostics.
- PNG, JPEG, GIF, and WebP attachments are supported. Other formats depend on
  the image decoders available to WebView2.
