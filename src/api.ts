// The only module that talks to the host. In Tauri it forwards to the Rust
// commands; in a plain browser (vite dev, screenshots) it runs an in-memory
// mock so the whole UI can be exercised without the native shell.

import type {
  ContextItem,
  Message,
  Protocol,
  ProviderInput,
  ProviderView,
  Session,
  SessionSummary,
  Settings,
  TurnEvent,
  TurnKind,
} from "./types";

export interface Backend {
  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<Session>;
  setSessionModel(id: string, providerId: string, model: string): Promise<Session>;
  runTurn(kind: TurnKind, onEvent: (e: TurnEvent) => void): Promise<void>;
  cancelTurn(sessionId: string): Promise<boolean>;
  activeTurns(ids: string[]): Promise<string[]>;

  getProviders(): Promise<ProviderView[]>;
  saveProvider(input: ProviderInput): Promise<ProviderView[]>;
  deleteProvider(id: string): Promise<ProviderView[]>;
  fetchModels(protocol: Protocol, baseUrl: string, apiKey?: string, providerId?: string): Promise<string[]>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  dataDir(): Promise<string>;
  revealDataDir(): Promise<void>;
  exportJsonl(path: string): Promise<number>;
  exportSession(id: string, path: string): Promise<void>;

  popupMenu(items: ContextItem[]): Promise<void>;
  onMenu(cb: (id: string) => void): Promise<() => void>;
  copyText(text: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  saveDialog(defaultName: string, ext: string): Promise<string | null>;
  confirm(message: string, title: string, okLabel: string): Promise<boolean>;
  showWindow(): Promise<void>;
  /** This build's version (tauri.conf.json). */
  version(): Promise<string>;
  /** Ask the release feed; null when this build is current. */
  checkUpdate(): Promise<{ version: string; notes?: string } | null>;
  /** Download + install the update found by `checkUpdate`, then relaunch. */
  installUpdate(onProgress: (fraction: number) => void): Promise<void>;
  /** Debug-only scenario hooks (env in Tauri, `?state=` in the browser). */
  scenario(): Promise<{ state?: string | null; autosend?: string | null } | null>;
}

export const isTauri = "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  const { save, ask } = await import("@tauri-apps/plugin-dialog");
  const { getVersion } = await import("@tauri-apps/api/app");
  let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null;

  return {
    listSessions: () => invoke("list_sessions"),
    getSession: (id) => invoke("get_session", { id }),
    deleteSession: (id) => invoke("delete_session", { id }),
    renameSession: (id, title) => invoke("rename_session", { id, title }),
    setSessionModel: (id, providerId, model) => invoke("set_session_model", { id, providerId, model }),
    runTurn: (kind, onEvent) => {
      const onEventChannel = new Channel<TurnEvent>();
      onEventChannel.onmessage = onEvent;
      return invoke("run_turn", { kind, onEvent: onEventChannel });
    },
    cancelTurn: (sessionId) => invoke("cancel_turn", { sessionId }),
    activeTurns: (ids) => invoke("active_turns", { ids }),

    getProviders: () => invoke("get_providers"),
    saveProvider: (input) => invoke("save_provider", { input }),
    deleteProvider: (id) => invoke("delete_provider", { id }),
    fetchModels: (protocol, baseUrl, apiKey, providerId) =>
      invoke("fetch_models", { protocol, baseUrl, apiKey: apiKey ?? null, providerId: providerId ?? null }),

    getSettings: () => invoke("get_settings"),
    saveSettings: (settings) => invoke("save_settings", { settings }),
    dataDir: () => invoke("data_dir"),
    revealDataDir: () => invoke("reveal_data_dir"),
    exportJsonl: (path) => invoke("export_jsonl", { path }),
    exportSession: (id, path) => invoke("export_session", { id, path }),

    popupMenu: (items) => invoke("popup_menu", { items }),
    onMenu: (cb) => listen<string>("menu", (e) => cb(e.payload)),
    copyText: (text) => writeText(text),
    openUrl: (url) => openUrl(url),
    saveDialog: async (defaultName, ext) =>
      save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }),
    confirm: (message, title, okLabel) => ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancel" }),
    showWindow: async () => {
      const w = getCurrentWindow();
      await w.show();
      await w.setFocus();
    },
    version: () => getVersion(),
    checkUpdate: async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      pendingUpdate = await check();
      return pendingUpdate ? { version: pendingUpdate.version, notes: pendingUpdate.body ?? undefined } : null;
    },
    installUpdate: async (onProgress) => {
      if (!pendingUpdate) throw new Error("no update to install");
      let total = 0;
      let got = 0;
      await pendingUpdate.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total) onProgress(Math.min(1, got / total));
        } else if (ev.event === "Finished") onProgress(1);
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
    scenario: () => invoke("debug_scenario"),
  };
}

// ---- mock -------------------------------------------------------------------

const SAMPLE_REPLY = `Here's the short version.

**Streaming** arrives token by token; the UI coalesces deltas to one paint per frame, so cost stays proportional to the *last* message rather than the whole transcript.

\`\`\`rust
pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
    self.buf.extend_from_slice(chunk);
    // split on blank lines, not on newlines
}
\`\`\`

A few things worth remembering:

1. Sessions are plain JSON — \`messages[]\` is a replayable \`{role, content}\` list.
2. Per-turn metadata (model, tokens, latency) lives on the assistant message.
3. Keys live in a separate file, so exports never leak them.

> The system prompt is copied into the session, so a trajectory is self-contained.

| protocol | endpoint |
|---|---|
| chat | \`/chat/completions\` |
| anthropic | \`/messages\` |
| responses | \`/responses\` |

That's it — see [the README](https://example.com) for the schema.`;

const SAMPLE_HTML = `Here's a minimal one:

\`\`\`html
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { margin: 0; font: 18px/1.5 -apple-system, sans-serif; color: #1d1d1f; background: linear-gradient(160deg, #fdfbfb, #ebedee); }
      main { max-width: 640px; margin: 12vh auto; padding: 0 24px; }
      h1 { font-size: 56px; letter-spacing: -0.03em; margin: 0 0 12px; }
      p { color: #6e6e73; margin: 0 0 28px; }
      a { display: inline-block; padding: 12px 22px; border-radius: 999px; background: #0071e3; color: #fff; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>just chat.</h1>
      <p>An ultra-lightweight chat client. Your providers, your models, plain JSON files.</p>
      <a href="#">Download</a>
    </main>
  </body>
</html>
\`\`\`

Drop it in a file and open it.`;

function mockBackend(): Backend {
  const params = new URLSearchParams(location.search);
  const state = params.get("state") ?? "chat";
  const now = () => new Date().toISOString();
  let menuCb: ((id: string) => void) | null = null;
  const cancels = new Map<string, () => void>();

  let settings: Settings = {
    schema_version: 1,
    appearance: (params.get("theme") as Settings["appearance"]) ?? "system",
    max_tokens: 8192,
    sidebar_visible: state !== "nosidebar",
    inspector_visible: state === "json" || params.get("inspector") === "1",
    default_provider_id: "openrouter",
    default_model: "anthropic/claude-sonnet-4",
  };
  let providers: ProviderView[] =
    state === "noproviders"
      ? []
      : [
          {
            id: "openrouter",
            name: "OpenRouter",
            protocol: "chat",
            base_url: "https://openrouter.ai/api/v1",
            models: ["anthropic/claude-sonnet-4", "openai/gpt-5", "deepseek/deepseek-r1", "google/gemini-2.5-pro"],
            has_key: true,
          },
          {
            id: "anthropic",
            name: "Anthropic",
            protocol: "anthropic",
            base_url: "https://api.anthropic.com/v1",
            models: ["claude-sonnet-4-5", "claude-opus-4-1"],
            has_key: false,
          },
          { id: "openai", name: "OpenAI", protocol: "responses", base_url: "https://api.openai.com/v1", models: ["gpt-5", "gpt-5-mini"], has_key: true },
        ];

  const meta = (model: string, out: number): Message["meta"] => ({
    provider_id: "openrouter",
    protocol: "chat",
    model,
    created_at: now(),
    latency_ms: 1840,
    ttft_ms: 412,
    usage: { input_tokens: 1283, cached_input_tokens: 1024, output_tokens: out },
    finish_reason: "stop",
  });

  const sessions = new Map<string, Session>();
  const mk = (id: string, title: string, ago: number, messages: Message[]): Session => ({
    schema_version: 1,
    id,
    title,
    created_at: new Date(Date.now() - ago).toISOString(),
    updated_at: new Date(Date.now() - ago).toISOString(),
    provider_id: "openrouter",
    model: "anthropic/claude-sonnet-4",
    messages,
  });
  if (state !== "empty" && state !== "noproviders") {
    sessions.set(
      "s1",
      mk("s1", "How does the streaming pipeline work?", 60_000, [
        { role: "user", content: "How does the streaming pipeline work? Keep it short, with a code sample.", created_at: now() },
        { role: "assistant", content: SAMPLE_REPLY, created_at: now(), reasoning_content: "The user wants a compact explanation. I should lead with the per-frame coalescing since that's the interesting part, then the schema.", meta: meta("anthropic/claude-sonnet-4", 236) },
        { role: "user", content: "And what happens on cancel?", created_at: now() },
        { role: "assistant", content: "The stream is dropped, and whatever text already arrived is persisted with `finish_reason: \"cancelled\"` — so a truncated reply is still a faithful trajectory.", created_at: now(), meta: meta("anthropic/claude-sonnet-4", 41) },
      ]),
    );
    sessions.set("s2", mk("s2", "Rust lifetimes in async closures", 3_600_000, [{ role: "user", content: "Rust lifetimes in async closures", created_at: now() }]));
    sessions.set("s3", mk("s3", "Draft: release notes for 0.1", 86_400_000, [{ role: "user", content: "Draft: release notes for 0.1", created_at: now() }]));
    sessions.set("s4", mk("s4", "Why does TextKit grow blocks with paragraphSpacing", 3 * 86_400_000, [{ role: "user", content: "Why?", created_at: now() }]));
    if (state === "error") {
      const s = sessions.get("s1")!;
      s.messages.push({ role: "user", content: "One more thing…", created_at: now() });
    }
    if (state === "html" || state === "html-expanded") {
      const s = sessions.get("s1")!;
      s.messages.push({ role: "user", content: "Make me a tiny landing page.", created_at: now() });
      s.messages.push({ role: "assistant", content: SAMPLE_HTML, created_at: now(), meta: meta("anthropic/claude-sonnet-4", 310) });
    }
  }

  const summaries = () =>
    [...sessions.values()]
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .map((s) => ({ id: s.id, title: s.title, updated_at: s.updated_at, provider_id: s.provider_id, model: s.model, message_count: s.messages.length }));

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    listSessions: async () => summaries(),
    getSession: async (id) => {
      const s = sessions.get(id);
      if (!s) throw new Error(`session not found: ${id}`);
      return structuredClone(s);
    },
    deleteSession: async (id) => {
      sessions.delete(id);
    },
    renameSession: async (id, title) => {
      const s = sessions.get(id)!;
      s.title = title;
      return structuredClone(s);
    },
    setSessionModel: async (id, providerId, model) => {
      const s = sessions.get(id)!;
      s.provider_id = providerId;
      s.model = model;
      return structuredClone(s);
    },
    runTurn: async (kind, onEvent) => {
      let s: Session;
      if (kind.kind === "send") {
        s = kind.session_id ? sessions.get(kind.session_id)! : mk(`s${Date.now()}`, "New chat", 0, []);
        s.provider_id = kind.provider_id;
        s.model = kind.model;
        if (s.messages.at(-1)?.role === "user") s.messages.pop();
        s.messages.push({ role: "user", content: kind.content, created_at: now() });
        if (s.messages.length === 1) s.title = kind.content.split("\n")[0]!.slice(0, 60);
        sessions.set(s.id, s);
      } else {
        s = sessions.get(kind.session_id)!;
        while (s.messages.at(-1)?.role === "assistant") s.messages.pop();
        if (kind.kind === "edit") {
          const last = s.messages.at(-1);
          if (last && last.role === "user") last.content = kind.content;
          else s.messages.push({ role: "user", content: kind.content, created_at: now() });
        }
      }
      s.updated_at = now();
      onEvent({ type: "started", session: structuredClone(s) });

      if (state === "error" || s.messages.at(-1)?.content.includes("fail")) {
        await sleep(300);
        onEvent({ type: "done", session_id: s.id, error: "HTTP 401: Invalid API key", updated_at: now() });
        return;
      }

      let cancelled = false;
      cancels.set(s.id, () => (cancelled = true));
      const reasoning = "The user is asking a follow-up. I'll answer briefly and reuse the earlier framing.";
      const reply = state === "streaming" ? SAMPLE_REPLY : state === "streaming-html" ? SAMPLE_HTML : "Sure — " + SAMPLE_REPLY.slice(0, 400);
      const holdAt = state === "streaming" ? 420 : state === "streaming-html" ? 700 : Infinity;
      let text = "";
      let think = "";
      await sleep(250);
      for (const ch of reasoning.match(/.{1,6}/gs) ?? []) {
        if (cancelled) break;
        think += ch;
        onEvent({ type: "reasoning", session_id: s.id, delta: ch });
        await sleep(18);
      }
      for (const ch of reply.match(/.{1,5}/gs) ?? []) {
        if (cancelled) break;
        text += ch;
        onEvent({ type: "text", session_id: s.id, delta: ch });
        await sleep(holdAt < Infinity ? 40 : 12);
        if (text.length > holdAt) {
          // Hold mid-stream so screenshots catch the live state.
          await new Promise<void>((r) => (cancels.set(s.id, () => ((cancelled = true), r()))));
          break;
        }
      }
      cancels.delete(s.id);
      const message: Message = { role: "assistant", content: text, reasoning_content: think, created_at: now(), meta: { ...meta(s.model, 120)!, finish_reason: cancelled ? "cancelled" : "stop" } };
      s.messages.push(message);
      s.updated_at = now();
      onEvent({ type: "done", session_id: s.id, message, updated_at: s.updated_at });
    },
    cancelTurn: async (id) => {
      const c = cancels.get(id);
      c?.();
      return !!c;
    },
    activeTurns: async (ids) => ids.filter((id) => cancels.has(id)),

    getProviders: async () => structuredClone(providers),
    saveProvider: async (input) => {
      const { api_key, ...p } = input;
      const existing = providers.find((x) => x.id === p.id);
      const view: ProviderView = { ...p, has_key: api_key !== undefined ? api_key !== "" : (existing?.has_key ?? false) };
      providers = existing ? providers.map((x) => (x.id === p.id ? view : x)) : [...providers, view];
      return structuredClone(providers);
    },
    deleteProvider: async (id) => {
      providers = providers.filter((p) => p.id !== id);
      return structuredClone(providers);
    },
    fetchModels: async (protocol) => {
      await sleep(400);
      return protocol === "anthropic" ? ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"] : ["gpt-5", "gpt-5-mini", "o4-mini"];
    },

    getSettings: async () => ({ ...settings }),
    saveSettings: async (s) => {
      settings = { ...s };
    },
    dataDir: async () => "~/Library/Application Support/im",
    revealDataDir: async () => {},
    exportJsonl: async () => sessions.size,
    exportSession: async () => {},

    popupMenu: async (items) => {
      const label = items.filter((i) => !i.separator && i.enabled !== false).map((i) => i.label).join(" / ");
      const pick = window.prompt(`Context menu:\n${label}\n\nType an item id`, items.find((i) => i.id)?.id ?? "");
      if (pick) menuCb?.(pick);
    },
    onMenu: async (cb) => {
      menuCb = cb;
      return () => (menuCb = null);
    },
    copyText: (text) => navigator.clipboard.writeText(text),
    openUrl: async (url) => {
      window.open(url, "_blank");
    },
    saveDialog: async (name) => window.prompt("Save as", name),
    confirm: async (message) => window.confirm(message),
    showWindow: async () => {},
    version: async () => "0.1.0",
    // `?update=1` pretends the feed has 0.2.0; installing "downloads" for a second and stops.
    checkUpdate: async () => (params.has("update") ? { version: "0.2.0", notes: "Live HTML preview, line numbers, trajectory column." } : null),
    installUpdate: async (onProgress) => {
      for (let i = 1; i <= 10; i++) {
        await sleep(100);
        onProgress(i / 10);
      }
    },
    scenario: async () => ({ state, autosend: params.get("autosend") }),
  };
}

export async function createBackend(): Promise<Backend> {
  return isTauri ? tauriBackend() : mockBackend();
}
