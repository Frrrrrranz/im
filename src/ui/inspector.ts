// The trajectory inspector (right column): the current chat as the data it
// is. One list in file order — system prompt, then every message — with what
// each call cost, a map of where the bulk sits, and the JSON that is on disk.
// Clicking a row (or a map segment) jumps the transcript to that message.

import * as actions from "../actions";
import { formatTokens, h, replaceChildren } from "../dom";
import { turnMeta, turnMetaTitle } from "../meta";
import { store, type LiveTurn, type State } from "../state";
import type { Message, Session } from "../types";

type Mode = "turns" | "json";

/** One entry of the list: the system prompt, a stored message, or the live reply. */
interface Entry {
  index: number | null;
  role: string;
  content: string;
  message?: Message;
  live?: boolean;
}

export function createInspector(): HTMLElement {
  let mode: Mode = "turns";

  const segTurns = h("button", { class: "seg on", role: "radio", onclick: () => setMode("turns") }, "Turns");
  const segJson = h("button", { class: "seg", role: "radio", onclick: () => setMode("json") }, "JSON");
  const head = h("div", { class: "inspector-head", "data-tauri-drag-region": "" }, h("div", { class: "segmented", role: "radiogroup", "aria-label": "View" }, segTurns, segJson));

  const model = h("div", { class: "facts-model" });
  const origin = h("div", { class: "facts-line" });
  const map = h("div", { class: "map", role: "presentation" });
  const totals = h("div", { class: "facts-line" });
  const facts = h("div", { class: "facts" }, model, origin, map, totals);
  const list = h("div", { class: "turns", role: "list" });
  const copyBtn = h("button", { class: "code-copy", onclick: () => (actions.copyText(actions.sessionJson()), flash(copyBtn)) }, "Copy");
  const jsonPre = h("pre", { class: "code json", hidden: true }, h("div", { class: "code-bar" }, copyBtn), h("code"));
  const scroll = h("div", { class: "inspector-scroll" }, facts, list, jsonPre);
  const root = h("aside", { class: "inspector" }, h("div", { class: "inspector-inner" }, head, scroll));

  const setMode = (m: Mode) => {
    mode = m;
    segTurns.classList.toggle("on", m === "turns");
    segJson.classList.toggle("on", m === "json");
    segTurns.setAttribute("aria-checked", String(m === "turns"));
    segJson.setAttribute("aria-checked", String(m === "json"));
    facts.hidden = list.hidden = m !== "turns";
    jsonPre.hidden = m !== "json";
    if (m === "json") paintJson();
  };

  // Hover on a row lights its map segment and vice versa; click jumps.
  const hot = (index: string | undefined, on: boolean) => {
    if (index === undefined) return;
    for (const el of root.querySelectorAll(`[data-entry="${index}"]`)) el.classList.toggle("hot", on);
  };
  for (const container of [list, map]) {
    container.addEventListener("mouseover", (e) => hot(entryOf(e.target), true));
    container.addEventListener("mouseout", (e) => hot(entryOf(e.target), false));
    container.addEventListener("click", (e) => {
      const key = entryOf(e.target);
      if (key === undefined) return;
      if (key === "system") document.querySelector(".transcript")?.scrollTo({ top: 0, behavior: "smooth" });
      else actions.revealMessage(Number(key));
    });
  }

  root.addEventListener("contextmenu", (e) => {
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    if (!store.state.session) return;
    actions.popupMenu([
      { id: "ctx:copy_session_json", label: "Copy Session JSON" },
      { id: "ctx:copy_trajectory", label: "Copy Messages Only" },
      { separator: true },
      { id: "ctx:export_session", label: "Export Chat…" },
    ]);
  });

  let signature = "";
  let liveRow: HTMLElement | null = null;
  let liveSeg: HTMLElement | null = null;
  let entries: Entry[] = [];

  const render = (s: State) => {
    const session = s.session;
    const streaming = store.isStreaming(s.currentId);
    entries = collect(s, streaming);
    const sig = [s.currentId, session?.updated_at, session?.messages.length, streaming, session?.model, s.draft?.model, s.settings.system_prompt, mode].join("\n");
    if (sig === signature) return;
    signature = sig;

    paintFacts(s);
    paintMap(entries);
    paintList(entries, session);
    liveRow = list.querySelector(".trow.live");
    liveSeg = map.querySelector(".map-seg.live");
    if (streaming && s.currentId) paintLive(s.live[s.currentId]!);
    if (mode === "json") paintJson();
  };

  const paintFacts = (s: State) => {
    const session = s.session;
    const m = actions.currentModel();
    const provider = s.providers.find((p) => p.id === m?.providerId);
    model.textContent = m?.model || "No model";
    origin.textContent = provider ? `${provider.name} · ${provider.protocol}` : (m?.providerId ?? "");
    const messages = session?.messages ?? [];
    const parts = [messages.length === 0 ? "No messages yet" : messages.length === 1 ? "1 message" : `${messages.length} messages`];
    const last = [...messages].reverse().find((x) => x.role === "assistant" && x.meta?.usage);
    const u = last?.meta?.usage;
    if (u && (u.input_tokens !== undefined || u.output_tokens !== undefined)) {
      parts.push(`≈${formatTokens((u.input_tokens ?? 0) + (u.output_tokens ?? 0))} tokens`);
      totals.title = `${(u.input_tokens ?? 0).toLocaleString()} in + ${(u.output_tokens ?? 0).toLocaleString()} out on the newest reply — the conversation as the model last saw it`;
    } else {
      totals.title = "";
    }
    totals.textContent = parts.join(" · ");
  };

  // Segment widths are flex-grow weights, so lengths can be used as-is.
  const paintMap = (all: Entry[]) => {
    replaceChildren(
      map,
      all.map((e) =>
        h("i", {
          class: `map-seg ${e.role}${e.live ? " live" : ""}`,
          dataset: { entry: keyOf(e) },
          style: { flexGrow: String(Math.max(1, e.content.length)) },
          title: `${e.index === null ? "system" : `${e.index + 1} · ${e.role}`} · ${formatChars(e.content.length)} chars`,
        }),
      ),
    );
    map.hidden = all.length === 0;
  };

  const paintList = (all: Entry[], session: Session | null) => {
    if (all.length === 0) {
      replaceChildren(list, h("div", { class: "turns-empty" }, session ? "No messages." : "Send a message to start a trajectory."));
      return;
    }
    replaceChildren(list, all.map((e) => row(e, session)));
  };

  const paintLive = (live: LiveTurn) => {
    if (liveRow) {
      liveRow.querySelector(".trow-size")!.textContent = formatChars(live.text.length);
      const text = liveRow.querySelector(".trow-text")!;
      text.textContent = live.text ? preview(live.text) : live.reasoning ? "Thinking…" : "…";
    }
    if (liveSeg) liveSeg.style.flexGrow = String(Math.max(1, live.text.length));
  };

  const paintJson = () => {
    const text = actions.sessionJson();
    jsonPre.querySelector("code")!.textContent = text || "No session yet.";
    copyBtn.hidden = !text;
  };

  store.subscribe(render);
  store.onLive((id) => {
    if (id === store.state.currentId) paintLive(store.state.live[id]!);
  });
  render(store.state);
  return root;
}

/** System prompt first (the session's, or the one a new chat would copy), then messages, then the live reply. */
function collect(s: State, streaming: boolean): Entry[] {
  const out: Entry[] = [];
  const system = s.session ? s.session.system : s.settings.system_prompt;
  if (system) out.push({ index: null, role: "system", content: system });
  const messages = s.session?.messages ?? [];
  messages.forEach((m, i) => out.push({ index: i, role: m.role, content: m.content, message: m }));
  if (streaming && s.currentId) out.push({ index: messages.length, role: "assistant", content: s.live[s.currentId]?.text ?? "", live: true });
  return out;
}

function keyOf(e: Entry): string {
  return e.index === null ? "system" : String(e.index);
}

function entryOf(target: EventTarget | null): string | undefined {
  return (target as HTMLElement | null)?.closest<HTMLElement>("[data-entry]")?.dataset.entry;
}

function row(e: Entry, session: Session | null): HTMLElement {
  const head = h(
    "div",
    { class: "trow-head" },
    e.index === null ? null : h("span", { class: "trow-idx" }, String(e.index + 1)),
    h("span", { class: "trow-role" }, e.role),
    e.live ? h("span", { class: "dot", "aria-label": "generating" }) : null,
    h("span", { class: "trow-size", title: `${e.content.length.toLocaleString()} characters` }, formatChars(e.content.length)),
  );
  const text = h("div", { class: "trow-text" }, e.live ? "…" : preview(e.content));
  const m = e.message;
  const meta = m?.role === "assistant" ? turnMeta(m, { model: !!session && m.meta?.model !== session.model, reasoning: true }) : "";
  return h(
    "div",
    { class: `trow ${e.role}${e.live ? " live" : ""}`, role: "listitem", dataset: { entry: keyOf(e) } },
    head,
    text,
    meta && m ? h("div", { class: `trow-meta${m.meta?.error ? " err" : ""}`, title: turnMetaTitle(m) }, meta) : null,
  );
}

/** First line-ish of a message with the loudest markdown stripped. */
function preview(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/[*`]+/g, "")
    .replace(/^[#>\s-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function formatChars(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

function flash(btn: HTMLElement) {
  const prev = btn.textContent;
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = prev), 900);
}
