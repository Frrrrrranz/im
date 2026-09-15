// Every user-visible operation. Menu items, shortcuts and buttons all call
// these, so behaviour is defined once.

import type { Backend } from "./api";
import { store } from "./state";
import type { Appearance, ContextItem, Session, TurnKind } from "./types";

let backend: Backend;
let composerSeed: ((text: string) => void) | null = null;

export function setBackend(b: Backend) {
  backend = b;
}

/** The composer registers itself so "edit last message" can hand it text. */
export function registerComposer(seed: (text: string) => void) {
  composerSeed = seed;
}

export async function init() {
  try {
    const [settings, providers, sessions, version] = await Promise.all([backend.getSettings(), backend.getProviders(), backend.listSessions(), backend.version().catch(() => "")]);
    store.set({ settings, providers, sessions, version });
    applyAppearance(settings.appearance);
    store.set({ draft: defaultDraft() });
    // Turns may still be running from before a reload (dev only); reflect them.
    const active = await backend.activeTurns(sessions.map((s) => s.id)).catch(() => []);
    for (const id of active) store.state.live[id] = { text: "", reasoning: "", startedAt: performance.now(), answering: false };
    if (sessions[0]) await selectSession(sessions[0].id);
    store.set({ ready: true });
  } catch (e) {
    store.set({ ready: true, fatal: String(e) });
  }
}

function defaultDraft(): { providerId: string; model: string } | null {
  const { settings, providers } = store.state;
  const preferred = providers.find((p) => p.id === settings.default_provider_id);
  if (preferred) {
    const model = settings.default_model && (preferred.models.includes(settings.default_model) || preferred.models.length === 0) ? settings.default_model : preferred.models[0];
    return { providerId: preferred.id, model: model ?? settings.default_model ?? "" };
  }
  const first = providers.find((p) => p.models.length > 0) ?? providers[0];
  return first ? { providerId: first.id, model: first.models[0] ?? "" } : null;
}

export function applyAppearance(a: Appearance) {
  document.documentElement.style.colorScheme = a === "system" ? "light dark" : a;
  document.documentElement.dataset.appearance = a;
}

async function refreshSessions() {
  try {
    store.set({ sessions: await backend.listSessions() });
  } catch (e) {
    console.warn("listSessions failed", e);
  }
}

// ---- navigation --------------------------------------------------------------

export async function selectSession(id: string) {
  if (store.state.currentId === id && store.state.session) {
    store.set({ view: "chat" });
    return;
  }
  try {
    const session = await backend.getSession(id);
    store.set({ currentId: id, session, editing: false, view: "chat", pickerOpen: false, renamingId: null });
  } catch (e) {
    store.set({ errors: { ...store.state.errors, draft: String(e) } });
    await refreshSessions();
  }
}

export function newChat() {
  if (store.state.currentId === null && store.state.view === "chat" && !store.state.session) return;
  store.set({ currentId: null, session: null, editing: false, view: "chat", pickerOpen: false, draft: store.state.draft ?? defaultDraft() });
}

export function stepChat(delta: 1 | -1) {
  const { sessions, currentId } = store.state;
  if (sessions.length === 0) return;
  const idx = currentId === null ? -1 : sessions.findIndex((s) => s.id === currentId);
  const next = Math.min(sessions.length - 1, Math.max(0, idx + delta));
  const target = sessions[next];
  if (target && target.id !== currentId) void selectSession(target.id);
}

export function toggleSidebar() {
  void saveSettings({ ...store.state.settings, sidebar_visible: !store.state.settings.sidebar_visible });
}

export function toggleInspector() {
  void saveSettings({ ...store.state.settings, inspector_visible: !store.state.settings.inspector_visible });
}

/** Column widths are written on mouse-up, not per frame. `undefined` restores the default. */
export function setColumnWidth(column: "sidebar" | "inspector" | "column", width: number | undefined) {
  const key = column === "sidebar" ? "sidebar_width" : column === "inspector" ? "inspector_width" : "column_width";
  const settings = { ...store.state.settings };
  if (width === undefined) delete settings[key];
  else settings[key] = width;
  void saveSettings(settings);
}

/** Scroll the transcript to message `index` and flash it. */
export function revealMessage(index: number) {
  if (store.state.view !== "chat") closeSettings();
  const el = document.querySelector(`.transcript .turn[data-index="${index}"]`) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash-turn");
  void el.offsetWidth;
  el.classList.add("flash-turn");
}

/** The session as stored — what an export or the inspector's JSON view shows. */
export function sessionJson(): string {
  const { session } = store.state;
  return session ? JSON.stringify(session, null, 2) : "";
}

/** Just `{role, content}` pairs (plus `system`): the trajectory a trainer wants. */
export function trajectoryJson(): string {
  const { session } = store.state;
  if (!session) return "";
  const messages = session.messages.map((m) => ({ role: m.role, content: m.content }));
  return JSON.stringify(session.system ? { system: session.system, messages } : { messages }, null, 2);
}

// ---- updates -----------------------------------------------------------------

/** Ask the release feed. `manual` = from the menu: report "up to date" too. */
export async function checkForUpdates(manual = false) {
  if (store.state.update && store.state.update.phase !== "failed") {
    if (manual) openSettings();
    return;
  }
  if (manual) store.set({ updateCheck: "checking", view: "settings" });
  try {
    const found = await backend.checkUpdate();
    if (found) store.set({ update: { version: found.version, notes: found.notes, phase: "available" }, updateCheck: "idle" });
    else if (manual) {
      store.set({ updateCheck: "uptodate" });
      setTimeout(() => store.state.updateCheck === "uptodate" && store.set({ updateCheck: "idle" }), 4000);
    }
  } catch (e) {
    console.warn("update check failed", e);
    if (manual) store.set({ updateCheck: "failed" });
  }
}

export async function installUpdate() {
  const u = store.state.update;
  if (!u || u.phase === "downloading" || u.phase === "installing") return;
  store.set({ update: { ...u, phase: "downloading", progress: 0, error: undefined } });
  try {
    await backend.installUpdate((progress) => {
      const cur = store.state.update;
      if (cur) store.set({ update: { ...cur, phase: progress >= 1 ? "installing" : "downloading", progress } });
    });
  } catch (e) {
    const cur = store.state.update;
    if (cur) store.set({ update: { ...cur, phase: "failed", error: String(e) } });
  }
}

export function openSettings() {
  store.set({ view: "settings", pickerOpen: false });
}

export function closeSettings() {
  store.set({ view: "chat" });
}

export function togglePicker(open = !store.state.pickerOpen) {
  if (open && store.state.providers.length === 0) {
    openSettings();
    return;
  }
  store.set({ pickerOpen: open });
}

// ---- turns -------------------------------------------------------------------

export function currentModel(): { providerId: string; model: string } | null {
  const { session, draft } = store.state;
  if (session) return { providerId: session.provider_id, model: session.model };
  return draft;
}

export function canSend(): boolean {
  const m = currentModel();
  return !!m && !!m.model && store.state.providers.some((p) => p.id === m.providerId) && !store.isStreaming(store.state.currentId);
}

export async function send(content: string) {
  const text = content.trim();
  if (!text) return;
  const { currentId, editing } = store.state;
  if (editing && currentId) {
    await runTurn({ kind: "edit", session_id: currentId, content: text });
    return;
  }
  const m = currentModel();
  if (!m || !m.model) {
    togglePicker(true);
    return;
  }
  await runTurn({ kind: "send", session_id: currentId, provider_id: m.providerId, model: m.model, content: text });
}

export async function regenerate() {
  const { currentId, session } = store.state;
  if (!currentId || !session || store.isStreaming(currentId)) return;
  if (!session.messages.some((m) => m.role === "user")) return;
  await runTurn({ kind: "regenerate", session_id: currentId });
}

export function editLast() {
  const { currentId, session } = store.state;
  if (!currentId || !session || store.isStreaming(currentId)) return;
  const last = [...session.messages].reverse().find((m) => m.role === "user");
  if (!last) return;
  store.set({ editing: true });
  composerSeed?.(last.content);
}

export function cancelEdit() {
  if (store.state.editing) {
    store.set({ editing: false });
    composerSeed?.("");
  }
}

export async function cancel() {
  const id = store.state.currentId;
  if (id && store.isStreaming(id)) await backend.cancelTurn(id);
}

async function runTurn(kind: TurnKind) {
  const startId = kind.kind === "send" ? (kind.session_id ?? null) : kind.session_id;
  const errors = { ...store.state.errors };
  delete errors[startId ?? "draft"];
  store.set({ errors, editing: false });

  let sid: string | null = startId;
  try {
    await backend.runTurn(kind, (ev) => {
      switch (ev.type) {
        case "started": {
          sid = ev.session.id;
          store.state.live[sid] = { text: "", reasoning: "", startedAt: performance.now(), answering: false };
          const patch: Partial<typeof store.state> = {};
          if (store.state.currentId === startId) {
            patch.currentId = sid;
            patch.session = ev.session;
          }
          store.set(patch);
          void refreshSessions();
          break;
        }
        case "text":
          store.appendLive(ev.session_id, "text", ev.delta);
          break;
        case "reasoning":
          store.appendLive(ev.session_id, "reasoning", ev.delta);
          break;
        case "done": {
          delete store.state.live[ev.session_id];
          const patch: Partial<typeof store.state> = {};
          if (ev.message && store.state.currentId === ev.session_id && store.state.session) {
            const session: Session = { ...store.state.session, updated_at: ev.updated_at, messages: [...store.state.session.messages, ev.message] };
            patch.session = session;
          }
          if (ev.error) patch.errors = { ...store.state.errors, [ev.session_id]: ev.error };
          store.set(patch);
          void refreshSessions();
          break;
        }
      }
    });
  } catch (e) {
    if (sid) delete store.state.live[sid];
    store.set({ errors: { ...store.state.errors, [sid ?? "draft"]: String(e) } });
  }
}

// ---- sessions ----------------------------------------------------------------

export async function deleteSession(id: string) {
  const s = store.state.sessions.find((x) => x.id === id);
  const ok = await backend.confirm(`Delete “${s?.title ?? "this chat"}”? This cannot be undone.`, "Delete Chat", "Delete");
  if (!ok) return;
  await backend.deleteSession(id);
  const sessions = store.state.sessions.filter((x) => x.id !== id);
  const patch: Partial<typeof store.state> = { sessions };
  if (store.state.currentId === id) {
    patch.currentId = null;
    patch.session = null;
    patch.editing = false;
  }
  store.set(patch);
}

export function startRename(id: string) {
  store.set({ renamingId: id });
}

export async function finishRename(id: string, title: string) {
  store.set({ renamingId: null });
  const t = title.trim();
  if (!t) return;
  const session = await backend.renameSession(id, t);
  const sessions = store.state.sessions.map((s) => (s.id === id ? { ...s, title: session.title } : s));
  store.set({ sessions, session: store.state.currentId === id ? { ...store.state.session!, title: session.title } : store.state.session });
}

export async function setModel(providerId: string, model: string) {
  const { currentId } = store.state;
  store.set({ pickerOpen: false, draft: { providerId, model } });
  if (currentId && store.state.session) {
    const session = await backend.setSessionModel(currentId, providerId, model);
    store.set({ session });
    void refreshSessions();
  }
  await saveSettings({ ...store.state.settings, default_provider_id: providerId, default_model: model });
}

export async function saveSettings(settings: typeof store.state.settings) {
  store.set({ settings });
  applyAppearance(settings.appearance);
  await backend.saveSettings(settings);
}

export async function setAppearance(a: Appearance) {
  await saveSettings({ ...store.state.settings, appearance: a });
}

export async function exportCurrent() {
  const { currentId, session } = store.state;
  if (!currentId || !session) return;
  const name = session.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || currentId;
  const path = await backend.saveDialog(`${name}.json`, "json");
  if (path) await backend.exportSession(currentId, path);
}

export async function exportAll() {
  const path = await backend.saveDialog("im-sessions.jsonl", "jsonl");
  if (path) await backend.exportJsonl(path);
}

export function revealData() {
  void backend.revealDataDir();
}

export function copyText(text: string) {
  void backend.copyText(text);
}

export function openUrl(url: string) {
  void backend.openUrl(url);
}

export function popupMenu(items: ContextItem[]) {
  void backend.popupMenu(items);
}

// ---- menu dispatch -----------------------------------------------------------

export function handleMenu(id: string) {
  if (id.startsWith("ctx:")) {
    handleContext(id.slice(4));
    return;
  }
  switch (id) {
    case "settings":
      store.state.view === "settings" ? closeSettings() : openSettings();
      break;
    case "check_updates":
      void checkForUpdates(true);
      break;
    case "new_chat":
      newChat();
      break;
    case "export_chat":
      void exportCurrent();
      break;
    case "export_all":
      void exportAll();
      break;
    case "show_data":
      revealData();
      break;
    case "delete_chat":
      if (store.state.currentId) void deleteSession(store.state.currentId);
      break;
    case "toggle_sidebar":
      toggleSidebar();
      break;
    case "toggle_inspector":
      toggleInspector();
      break;
    case "choose_model":
      togglePicker();
      break;
    case "appearance:system":
    case "appearance:light":
    case "appearance:dark":
      void setAppearance(id.slice(11) as Appearance);
      break;
    case "stop":
      void cancel();
      break;
    case "regenerate":
      void regenerate();
      break;
    case "edit_last":
      editLast();
      break;
    case "prev_chat":
      stepChat(-1);
      break;
    case "next_chat":
      stepChat(1);
      break;
  }
}

/** Context-menu ids look like `<verb>:<session id>` or `<verb>:<message index>`. */
function handleContext(id: string) {
  const sep = id.indexOf(":");
  const verb = sep < 0 ? id : id.slice(0, sep);
  const arg = sep < 0 ? "" : id.slice(sep + 1);
  const session = store.state.session;
  switch (verb) {
    case "rename":
      startRename(arg);
      break;
    case "delete":
      void deleteSession(arg);
      break;
    case "export":
      if (arg === store.state.currentId) void exportCurrent();
      else void selectSession(arg).then(exportCurrent);
      break;
    case "copy": {
      const m = session?.messages[Number(arg)];
      if (m) copyText(m.content);
      break;
    }
    case "copy_reasoning": {
      const m = session?.messages[Number(arg)];
      if (m?.reasoning_content) copyText(m.reasoning_content);
      break;
    }
    case "regenerate":
      void regenerate();
      break;
    case "edit":
      editLast();
      break;
    case "copy_session_json":
      copyText(sessionJson());
      break;
    case "copy_trajectory":
      copyText(trajectoryJson());
      break;
    case "export_session":
      void exportCurrent();
      break;
  }
}
