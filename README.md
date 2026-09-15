# im

An ultra-lightweight, native macOS chat client for LLMs. One window, no header
bar, no accounts, no telemetry — just your providers, your models, and plain
JSON files you can read.

- **Native.** Tauri 2 shell: real macOS vibrancy sidebar, traffic lights and
  the sidebar toggle in one header strip, native menu bar and context menus, system font and semantic
  colors, light/dark follow the system (or override in Settings).
- **Fast.** Rust does networking, SSE parsing and storage; the UI is ~40 KB of
  gzipped vanilla TypeScript. Streaming deltas are coalesced to one paint per
  frame and only the live message is re-rendered.
- **Three wire protocols, spoken natively:** OpenAI Chat Completions
  (`chat`), Anthropic Messages (`anthropic`) and OpenAI Responses
  (`responses`). Anything that speaks one of them works — OpenAI, Anthropic,
  OpenRouter, DeepSeek, Ollama, vLLM, gateways.
- **Inspectable data.** Every chat is one JSON file whose `messages[]` is a
  replayable `{role, content}` list. Export everything as JSONL in one click.

## Build

Requirements: Rust (stable), Node 20+, Xcode command line tools.

```sh
npm install
npm run tauri dev            # dev build with hot reload
npm run tauri build          # release .app + updater archive in src-tauri/target/release/bundle
```

### Install

```sh
curl -fsSL https://im.linghaoz.com/install.sh | sh
```

That downloads the latest release, verifies its checksum and puts `im.app` in
`/Applications` — and because `curl` doesn't set the quarantine flag, it opens
without the "unidentified developer" stop. That is the only install path on
purpose: there is no dmg to drag and no Gatekeeper dialog to click through.

Updates come from inside the app. It checks the release feed quietly after
launch (and every few hours); when there is a new version a single line
appears at the foot of the sidebar — **Update to 0.2.0** — and clicking it
downloads, installs and relaunches. Nothing pops up. **im → Check for
Updates…** and **Settings → Version** are there for checking by hand.

### Releasing

[im.linghaoz.com](https://im.linghaoz.com) is `site/` published by
`.github/workflows/pages.yml` (GitHub Pages, custom domain); it also serves
`install.sh`.

A tag is a release. `.github/workflows/release.yml` builds a universal macOS
app, signs the updater archive with the project's key, and publishes
`im_universal.app.tar.gz` + `.sig`, a `sha256` for the installer and
`latest.json` (what the app polls) as a GitHub Release.

```sh
# bump "version" in src-tauri/tauri.conf.json and package.json, commit, then
git tag v0.2.0 && git push origin v0.2.0
```

Two repository secrets are needed once: `TAURI_SIGNING_PRIVATE_KEY` (the
contents of the updater private key — its public half is in
`tauri.conf.json`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if the key
has none). Lose the private key and existing installs can never update again.

The app itself is ad-hoc signed; there is no Apple Developer ID in the loop.
If one ever exists, export `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID` in the workflow and Tauri notarizes as well —
nothing else changes.

## Using it

1. **Settings (⌘, or the gear beside the traffic lights) → Add Provider.** Pick a preset (OpenAI, Anthropic,
   OpenRouter, DeepSeek, Ollama) or *Custom*. Set the base URL up to and
   including the version segment (`https://api.openai.com/v1`), paste an API
   key, and either type model ids (one per line) or press **Fetch**. Every
   field saves as soon as you leave it — there is no Save button.
2. Close Settings, choose a model from the name at the top of the window
   (⌘K), and type. **Return** sends, **Shift-Return** inserts a newline; when
   an IME composition is active, Return commits the composition instead.
3. While a reply streams, the send button becomes a stop button (**Esc** or
   **⌘.** also stop). Whatever arrived is kept and marked *stopped*.

Hover a message for **copy**, **regenerate** (newest reply) or **edit**
(newest prompt), and under replies the `model · cached/input in · output out ·
ttft · total` line (hover it for the long form); the newest message shows its
line all the time. Right-click for the same as a
native menu. Reasoning, when the provider streams it, appears as a
collapsible *Thought for …* block above the answer. Code blocks have line
numbers and a copy button. An ```html block renders itself: a preview pane
sits at the top of the block and shows the page live while the code is still
being written beneath it. Click the pane
to enlarge it to the middle of the window — there the page is interactive —
and Esc to put it back. Pages run sandboxed, cut off from the app. While a
reply streams the
view follows it only as long as you stay at the bottom; scroll up and it stays
put, with a small **↓** above the composer to jump back.

### Keyboard

| Shortcut | Action |
|---|---|
| ⌘N | New chat |
| ⌘K | Choose model |
| ⌘, | Settings |
| ⌃⌘S | Toggle sidebar |
| ⌥⌘T | Toggle trajectory (right column) |
| ⌘. / Esc | Stop generating |
| ⌘R | Regenerate newest reply |
| ⌘E | Edit newest prompt |
| ⌘⇧[ / ⌘⇧] | Previous / next chat |
| ⌘⇧E | Export chat as JSON |
| ⌘W | Hide window (click the Dock icon to bring it back) |

Chats are renamed by double-clicking them in the sidebar, deleted from the
right-click menu or **File → Delete Chat**. Both side columns can be dragged
wider or narrower at their inner edge; double-click the edge to reset.

### Trajectory

The right column (⌥⌘T, or the button at the top right) shows the current chat
as the data it is: the model and provider, a bar with one segment per message
(width = characters, dark = user), then every entry in file order — the system
prompt, each message with its size, and under each reply what that call cost
(`cached/input in · output out · ttft · total`). Click an entry to jump to it in
the transcript. **JSON** switches to the session exactly as stored, with a copy
button; right-click for *Copy Session JSON*, *Copy Messages Only* (just
`{role, content}` pairs) and *Export*.

## Data

Everything lives in `~/Library/Application Support/im/` (**File → Show Data
Folder**). Set `IM_DATA_DIR` to use another location.

```text
settings.json          appearance, default model, system prompt, max_tokens
providers.json         endpoints + model lists      (no secrets)
keys.json              { "<provider id>": "<api key>" }   mode 0600
sessions/<ulid>.json   one chat per file
```

A session:

```json
{
  "schema_version": 1,
  "id": "01k54v8e3c0000000000000000",
  "title": "How does the streaming pipeline work?",
  "created_at": "2026-09-14T12:00:00Z",
  "updated_at": "2026-09-14T12:00:09Z",
  "provider_id": "openrouter",
  "model": "anthropic/claude-sonnet-4",
  "system": "Be terse.",
  "messages": [
    { "role": "user", "content": "How does it work?", "created_at": "2026-09-14T12:00:00Z" },
    {
      "role": "assistant",
      "content": "Bytes come in, events go out…",
      "created_at": "2026-09-14T12:00:09Z",
      "reasoning_content": "The user wants the short version…",
      "meta": {
        "provider_id": "openrouter",
        "protocol": "chat",
        "model": "anthropic/claude-sonnet-4",
        "created_at": "2026-09-14T12:00:09Z",
        "latency_ms": 1840,
        "ttft_ms": 412,
        "thinking_ms": 3200,
        "usage": { "input_tokens": 1283, "cached_input_tokens": 1024, "output_tokens": 236 },
        "finish_reason": "stop"
      }
    }
  ]
}
```

Design rules for the schema:

- `messages[]` is exactly what was (or would be) sent to the model: alternating
  `user` / `assistant` turns with string `content`. Strip everything but
  `role` and `content` and you have a training trajectory. The system prompt
  is a top-level `system` field, copied into the session when it is created so
  the file is self-contained.
- Everything about *how* a reply was produced hangs off that assistant
  message under `meta` — never off the session or a side table. `finish_reason`
  is the provider's own value (`stop`, `end_turn`, `length`, …) or `cancelled`
  / `error` when the turn did not finish normally; `reasoning_content` is whatever the
  stream carried (Anthropic thinking, DeepSeek `reasoning_content`, Responses
  reasoning summaries), stored verbatim. `usage.input_tokens` is the whole
  prompt for that call (Anthropic's cache reads and writes folded back in) and
  `cached_input_tokens` the part the provider served from its prompt cache;
  `ttft_ms` is time to the first streamed token, `latency_ms` the whole call.
  Hover a reply to see them as `model · cached/input in · output out · ttft · total`.
- Regenerate and edit rewrite the newest exchange in place. There is no
  branching, so a file is always one linear conversation.
- Secrets never enter `providers.json` or a session, so those can be shared or
  committed as-is.

**File → Export All Chats as JSONL…** writes one session object per line;
**Export Chat…** writes a single session's JSON.

## Protocols

| `protocol` | Request | Reasoning captured from | Usage from |
|---|---|---|---|
| `chat` | `POST {base_url}/chat/completions`, `stream: true`, `stream_options.include_usage`; earlier replies are replayed with their `reasoning_content` | `delta.reasoning_content` / `delta.reasoning` | final `usage` chunk |
| `anthropic` | `POST {base_url}/messages`, `stream: true`, `max_tokens` from Settings | `thinking_delta` | `message_start` + `message_delta` |
| `responses` | `POST {base_url}/responses`, `stream: true`, `store: false` | `response.reasoning_summary_text.delta` | `response.completed` |

Model lists come from `GET {base_url}/models` for all three. Requests carry
only the fields above — no sampling or thinking parameters are sent, so any
gateway that implements the protocol works unchanged. If a server answers a
streaming request with a single JSON object instead, it is accepted too.

## Development

```sh
npm run dev                    # frontend alone in a browser, in-memory mock backend
scripts/snapshot.sh            # render every UI state to build/snapshots/*.png (headless Chrome)
cd src-tauri && cargo test     # unit tests + end-to-end streaming against a local SSE server
scripts/mock_server.py         # local stand-in for all three protocols (port 8787)
scripts/app-snapshot.sh        # launch the debug .app and have it capture its own window
```

See `CLAUDE.md` for the architecture map and the rules that keep the app small.
