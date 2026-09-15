# im — working notes for agents

Tauri 2 app (Rust backend, vanilla TypeScript + Vite frontend), macOS first.
README.md is the front door and stays a few lines — the user wants it to read
like the landing page. docs/DEVELOPMENT.md has the build/usage docs, the
on-disk schema, the protocol table and the release procedure.

## Build & verify

```sh
npm install
npx tsc --noEmit                              # frontend typecheck
(cd src-tauri && cargo test)                  # 37 tests: parsers, store, engine e2e over a local SSE server
npx tauri build --debug --bundles app         # debug .app → src-tauri/target/debug/bundle/macos/im.app
npm run dev &  scripts/snapshot.sh            # frontend states via headless Chrome → build/snapshots/*.png
scripts/app-snapshot.sh out.png [light|dark]  # the REAL app renders its own window to PNG
swiftc -O -o build/icon scripts/icon.swift && build/icon logo.PNG src-tauri/icons/source.png \
  && npx tauri icon src-tauri/icons/source.png -o /tmp/icons  # app icon from the logo; copy the mac/win files back
npm run tauri build                           # release .app + updater archive (ad-hoc signed; no dmg by design)
git tag vX.Y.Z && git push origin vX.Y.Z      # GitHub Actions builds, signs the updater archive and publishes the Release
```

Releases live at github.com/yetlinghao/im; the landing page is `site/` →
GitHub Pages at im.linghaoz.com (`.github/workflows/pages.yml`, custom domain set
via the Pages API; DNS is a CNAME to yetlinghao.github.io). `install.sh` (repo
root, copied into the site at deploy) is the primary install path: no
quarantine flag → no Gatekeeper. The page is deliberately just icon, slogan,
one line, the command, and one figure (`.why`: im / Cherry Studio / ChatGPT as
three rows × two bar columns, "Download" 5 MB · 500 MB · 1.39 GB on a linear
scale and "What it covers" ~90 · 95 · 100 %, the extra slice in a lighter gray,
two legend lines naming the everyday vs. the other 10%) — the user vetoed
screenshots, a dmg link and a grow-in animation on the bars; plain CSS, no JS.
Headless Chrome won't go below ~500px wide, so check the mobile layout at 500,
not 390. The updater
(`tauri-plugin-updater`) polls `releases/latest/download/latest.json`; its
public key is in `tauri.conf.json`, the private key is `~/.tauri/im.key` on
the user's Mac and the `TAURI_SIGNING_PRIVATE_KEY` repo secret — never in the
repo. Frontend: `actions.checkForUpdates/installUpdate`, `state.update`; the only
unprompted surface is one line at the foot of the sidebar (`.update-row`,
"Update to 0.2.0" → "Downloading… 42%" → relaunch) that exists only while an
update is waiting; Settings → General → Version and `im → Check for Updates…`
are the manual paths. No dialogs, no badges. There is no dmg any more
(`bundle.targets = ["app"]`): install.sh is the only install path, by the
user's decision. Mock: `?update=1` fakes a 0.2.0 in the feed.

This terminal cannot take screenshots or send keystrokes. Two ways to see the
UI, use both after any view change:

- `scripts/snapshot.sh` runs the frontend against the in-memory mock backend
  (`src/api.ts`, active whenever `__TAURI_INTERNALS__` is missing) in headless
  Chrome. `?state=chat|streaming|picker|settings|empty|noproviders|error|edit|nosidebar|json|scrolled|resized|html|html-expanded|streaming-html`
  (iframes need `--virtual-time-budget=3000` on the shot to have loaded)
  and `?theme=light|dark` pick the scenario; `&inspector=1` opens the right
  column (`collapse` toggles the sidebar in 4s slow motion so a
  snapshot catches the slide; `collapse-frames` runs it at real speed and logs
  the frame count; `resized` drags both column handles synthetically). Chrome doesn't exit cleanly in
  this sandbox, so `scripts/shot.sh` polls for the file and kills it. Requests
  need `--proxy-server=direct://` because the shell has an HTTP proxy set.
- `scripts/app-snapshot.sh` launches the debug bundle with fixture data
  (`scripts/fixtures/`; `SIDEBAR=0` closes the sidebar, `INSPECTOR=1` opens the right column) and env `IM_SNAPSHOT_PATH`; `src-tauri/src/snapshot.rs`
  (debug builds only) captures the window via `CGWindowListCreateImage`
  (dlsym'd — deprecated but works for our own window) including what is on
  screen below it, so vibrancy shows what it really blurs. `IM_SCENARIO=` and
  `IM_AUTOSEND=` drive the UI (`debug_scenario` command); `PROVIDER=mock`
  points the fixtures at `scripts/mock_server.py` (start it first) for a real
  end-to-end turn — its log prints one line per request (`messages=[u72 a879+r …]`,
  `+r` = that reply was replayed with `reasoning_content`); `KEEP_DATA=1` keeps
  the temp data dir to inspect the JSON. The app is brought to the front before
  the capture (`ACTIVATE=0` to see the inactive look) — it steals focus, so
  don't type while a snapshot runs.
- Webview `console.error/warn` and uncaught errors are forwarded to the Rust
  log (`log_message` command); run with `RUST_LOG=im=debug,webview=debug`.

## Architecture

```
src-tauri/src/
  model.rs      on-disk schema (serde, snake_case). Bump *_SCHEMA_VERSION on breaking changes.
  store.rs      plain JSON files under the data root; atomic temp+rename writes; keys.json is 0600
  sse.rs        incremental SSE parser (bytes → events); splits on blank lines, not newlines
  llm/          one module per protocol: build(request) + parse(sse event) → StreamEvent. No Tauri types.
  engine.rs     a turn: mutate session → stream → accumulate → persist once → emit TurnEvent. Cancellation tokens per session.
  lib.rs        Tauri commands (thin), plugins, vibrancy, window theme
  menu.rs       native menu bar + context menu popup; every click is emitted as a `menu` event with its id
  snapshot.rs   debug-only self-screenshot
src/
  api.ts        Backend interface: Tauri (invoke/Channel) or the in-memory mock. The only host boundary.
  state.ts      one store; `appendLive` coalesces deltas to one publish per animation frame
  actions.ts    every user operation, shared by menu items, shortcuts and buttons; `handleMenu` maps ids
  meta.ts       the one formatter for "what this call cost" (model · cached/input in · out · ttft · total)
  ui/           sidebar, topbar (+ model picker), transcript, composer, settings, inspector — plain DOM via `h()`
  ui/inspector  right column: the session as a trajectory (map + turn list + on-disk JSON); click a row → transcript
  ui/settings   System-Settings-style grouped lists; every field saves on change; provider cards keyed by id and
                updated in place so a save never steals focus. "Add Provider" opens an empty *draft* card (no
                presets — the user removed them); it is written the moment it has a name (id = slug of the name).
                No max-tokens control (the stored `max_tokens` keeps its default)
  ui/resizer    drag handles for both side columns (mounted in `#app`, 10px straddling the edge) and for the
                reading column (`.column-handle` at both edges of `.chat`, factor 2 because it is centred; a faint
                line shows on hover); write `--sidebar-w`/`--inspector-w`/`--column-w` live, persist on mouse-up,
                double-click resets
  ui/htmlpane   live HTML preview *inside* an ```html code block: a pane fixed at the top of the block renders
                the code as it streams. Two sandboxed blob: iframes: the new one waits two frames after `load`
                (load fires before first paint) and fades in *on top* (`.top`) while the old one stays opaque
                underneath — fading both at once let white through, which read as a flash; click
                → grows from its own rect to the centre of `.main`, Quick Look style; Esc/backdrop/⤡ return it
  markdown.ts   marked + DOMPurify → fragment. Code block anatomy: `pre.code > (.code-preview?) .code-body >
                (.code-bar, .code-row > (.gutter?, .code-scroll > code))` — the gutter is a real flex column and
                only `.code-scroll` scrolls, so long lines never pass under the numbers. The preview pane stays at
                the top of the block (not sticky — the user rejected a pane that followed the code down). ```svg
                blocks are previewed too (wrapped in a centred white page by `svgPage` in transcript.ts).
                `patchMarkdown(body, fragment)` updates a streaming message in place: equal blocks stay, a code block
                whose text grew is patched (its iframes survive), the rest is swapped
  styles.css    all visual constants; light-dark() semantic colors only
```

Streaming path: `run_turn` command with a `tauri::ipc::Channel<TurnEvent>` →
engine emits `started` (session after the user message is persisted),
`text`/`reasoning` deltas, then one terminal `done { message?, error? }`. The
frontend accumulates deltas in `store.state.live[sessionId]`; the transcript
repaints only the live element per frame. Text is written to disk once, at the
end (cancelled turns keep partial text with `finish_reason: "cancelled"`).

## Rules that keep it small and native

- Storage is plain JSON; `messages[]` stays a replayable `{role, content}` list
  and per-turn metadata lives on the assistant message. No branching:
  regenerate/edit rewrite the newest exchange in place. Field names follow the
  chat-completions wire format where one exists (`reasoning_content`, not
  `reasoning`; old files still load via a serde alias). `usage.input_tokens` is
  the whole prompt (Anthropic cache reads/writes folded in), `cached_input_tokens`
  the cached part.
- Reasoning is captured passively from whatever the stream carries. Don't send
  request-side thinking/sampling parameters — gateways reject unknown fields.
  The one thing we do send back: on the `chat` protocol, earlier assistant
  turns carry their stored `reasoning_content` (DeepSeek/MiMo/Kimi-style
  thinking models need it to continue a trajectory). Anthropic and Responses
  get `{role, content}` only — their thinking blocks need signatures/ids we
  don't keep.
- Request/response bodies are `serde_json::Value`; no per-provider structs.
  Header names arrive title-cased from reqwest 0.13 — compare case-insensitively.
- The UI is quiet: nothing persistent that isn't content. Metadata is on hover
  and in the context menu; the model picker is plain text; errors are inline.
  The tools line under a message (copy · regenerate/edit · cost line) is a
  plain `visibility` switch on `.turn:hover` (always on for the newest message,
  `.turn.last`) — no fade, no delay, no opacity;
  the user rejected both a fade and a rest delay ("just show on hover, hide
  when not"). It is `user-select: none` so multi-clicks on the icons can't
  select the text.
  Before adding a control, ask whether a menu item, shortcut or hover would do.
  The header strip is one 40px band: `● ● ●  [sidebar toggle]` fixed at the
  left, `[trajectory]` fixed at the right, both columns' headers are drag
  regions. Settings lives as a gear in the sidebar's bottom-left corner (the
  user rejected it beside the traffic lights and in the topbar); the update
  line shares that foot row. The inspector's only control is its Turns/JSON
  segmented switch.
- The side columns are plain vibrancy (`NSVisualEffectMaterial::Sidebar`,
  behind-window), flush with the window edges. A Liquid Glass version
  (`NSGlassEffectView` panes inset 8px) was built and reverted on 2026-09-15
  at the user's request — don't reintroduce it unasked.
- Only semantic colors via `light-dark()`; system font; sizes as CSS variables.
  Everything over the sidebar stays transparent (the vibrancy is behind the
  whole window; `.main` paints the opaque canvas). `html.mock .sidebar` stands
  in for the material in browsers.
- `[hidden] { display: none !important }` exists because class rules with
  `display: inline-flex` beat the UA `hidden` style — use `el.hidden`, not
  ad-hoc classes, to hide things.
- Shortcuts come from the native menu (`menu.rs`) as `menu` events; the browser
  keydown map in `main.ts` is for mock mode only. Cmd-key equivalents may also
  reach the webview, so never double-bind them in Tauri mode.
- The composer's Return checks `isComposing` / keyCode 229 so CJK input works.
- Scrolling never fights the user: only the user scrolls *up* (our scrolls
  only go down), so a decreasing `scrollTop` or a wheel-up stops following and
  reaching the bottom resumes it. Do not derive "following" from
  distance-to-bottom on scroll events: content growing between a programmatic
  scroll and its event made that flip spuriously during streaming. Sending,
  regenerating or editing jumps to the bottom. The `.jump` button (floats
  above the composer) shows whenever not following.
- The sidebar is open by default, the inspector closed (`sidebar_visible`, `inspector_visible`).
- Don't schedule anything the app needs in `requestAnimationFrame` before the
  window is visible: WebKit doesn't run frames for hidden windows (this is why
  `showWindow()` is awaited directly after `init()`).
- Window lifecycle: the app is single-window and stays alive without one
  (`ExitRequested` is prevented), so the window must never be *destroyed* —
  ⌘W, the red button and Window → Close all go through `hide()`
  (`CloseRequested` → `prevent_close`), and `RunEvent::Reopen` (dock click)
  shows it again. A destroyed window here = a running app with nothing to
  show (the "window vanished" bug). Two fail-safes keep a hidden window from
  sticking: a 5s watchdog in `setup` shows it if the frontend never did, and
  `main().catch` shows it with the error. `IM_SCENARIO=close` exercises the
  close path.
- `transparent: true` + `macOSPrivateApi: true` are required for the vibrancy
  to show; `titleBarStyle: Overlay` + `hiddenTitle` give a chromeless window
  whose traffic lights sit near `trafficLightPosition` — tao only resizes the
  title-bar container, so the dots' centre lands at `y - 2` (y = 22 → centre
  20 = the middle of the 40px strip), and on macOS 26 they are 14px on a 23px
  pitch (`--lights-end`). Don't eyeball this from a downscaled screenshot;
  measure the PNG (the dots read as aligned at thumbnail size when they are
  8px off). Both column headers are `data-tauri-drag-region`.
- Vite 8 bundles with Rolldown; don't set `minify: "esbuild"` (esbuild isn't installed).
- The live message is *patched* every frame (`patchMarkdown`), not rebuilt, so
  stable blocks keep their DOM (and iframes) and hover chrome doesn't flicker.
- The HTML preview iframes are `sandbox="allow-scripts allow-forms allow-modals
  allow-popups"` (no `allow-same-origin`) on `blob:` URLs — an opaque origin
  with no IPC; srcdoc would inherit our CSP and block the page's own scripts.
  The CSP therefore carries `frame-src blob:`. The inline pane is
  `pointer-events: none` (a picture; click = enlarge) so wheel over it scrolls
  the transcript; the enlarged copy is the interactive one. `mock_server.py`
  streams an HTML page when the prompt contains "html".
