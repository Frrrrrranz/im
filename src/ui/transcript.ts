// The conversation. One scroll container, one element per turn; elements are
// cached by content so a streaming frame only touches the live turn.

import * as actions from "../actions";
import { formatDuration, h, icon, replaceChildren, type IconName } from "../dom";
import { patchMarkdown, plainText, renderMarkdown } from "../markdown";
import { turnMeta, turnMetaTitle } from "../meta";
import { attachPreview, enlarge } from "./htmlpane";
import { store, type LiveTurn, type State } from "../state";
import type { Message } from "../types";

interface Cached {
  key: string;
  el: HTMLElement;
}

export interface Transcript {
  el: HTMLElement;
  /** The "back to bottom" button; the composer floats it above itself. */
  jump: HTMLElement;
}

export function createTranscript(): Transcript {
  const column = h("div", { class: "column" });
  const root = h("div", { class: "transcript", tabindex: -1 }, column);
  const jump = h("button", { class: "jump", title: "Back to bottom", "aria-label": "Back to bottom" }, icon("chevron"));

  let cache: Cached[] = [];
  let cachedSessionId: string | null | undefined;
  let liveEl: HTMLElement | null = null;
  let liveFolded = false;
  let messageCount = 0;
  let wasStreaming = false;

  // Following the stream is the user's call. Only the user scrolls *up*
  // (our own scrolls only ever go down), so an upward move stops following and
  // reaching the bottom resumes it; content growing under a programmatic
  // scroll never counts as the user leaving.
  let follow = true;
  let lastTop = 0;
  const atBottom = () => root.scrollHeight - root.scrollTop - root.clientHeight < 2;
  const paintJump = () => jump.classList.toggle("show", !follow && root.scrollHeight - root.clientHeight > 40);
  root.addEventListener("scroll", () => {
    // Up *and* away from the bottom = the user; content shrinking clamps
    // scrollTop down too, but leaves us at the bottom.
    if (root.scrollTop < lastTop - 1 && !atBottom()) follow = false;
    else if (atBottom()) follow = true;
    lastTop = root.scrollTop;
    paintJump();
  });
  root.addEventListener("wheel", (e) => {
    if (e.deltaY < 0) {
      follow = false;
      paintJump();
    }
  }, { passive: true });
  const scrollToBottom = () => {
    root.scrollTop = root.scrollHeight;
    lastTop = root.scrollTop;
  };
  jump.addEventListener("click", () => {
    follow = true;
    paintJump();
    root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });
  });

  // Delegated clicks: code copy buttons, external links, footer tools.
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const link = t.closest("a[href]") as HTMLAnchorElement | null;
    if (link) {
      e.preventDefault();
      actions.openUrl(link.href);
      return;
    }
    const copy = t.closest("button.code-copy") as HTMLButtonElement | null;
    if (copy) {
      const code = copy.closest("pre")?.querySelector("code");
      actions.copyText(code?.textContent ?? "");
      flash(copy, "Copied");
      return;
    }
    const pane = t.closest(".code-preview") as HTMLElement | null;
    if (pane) enlarge(pane, root.closest(".main") as HTMLElement);
  });

  const messageKey = (m: Message, i: number, isLastOfRole: boolean, streaming: boolean) =>
    `${i}|${m.role}|${m.content.length}|${hash(m.content)}|${m.reasoning_content?.length ?? 0}|${isLastOfRole}|${streaming}|${m.meta?.finish_reason ?? ""}`;

  const render = (s: State) => {
    const session = s.session;
    const sessionId = s.currentId;
    if (sessionId !== cachedSessionId) {
      cache = [];
      cachedSessionId = sessionId;
      liveEl = null;
      liveFolded = false;
      follow = true;
      messageCount = 0;
      wasStreaming = false;
    }
    const messages = session?.messages ?? [];
    const streaming = store.isStreaming(sessionId);
    // Something the user just did (sent, regenerated, edited) → back to the bottom.
    if ((messages.length > messageCount && messages[messages.length - 1]?.role === "user") || (streaming && !wasStreaming)) follow = true;
    messageCount = messages.length;
    wasStreaming = streaming;
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");

    const next: Cached[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      // Only the newest exchange is editable/regenerable (no branching).
      const isLast = m.role === "user" ? i === lastUser && i >= messages.length - 2 : i === lastAssistant && i === messages.length - 1;
      const key = messageKey(m, i, isLast, streaming);
      const prev = cache[i];
      next.push(prev && prev.key === key ? prev : { key, el: renderMessage(m, i, isLast, streaming) });
    }
    cache = next;
    // The newest message keeps its tools line on screen; older ones show it on hover.
    next.forEach((c, i) => c.el.classList.toggle("last", i === next.length - 1));

    const children: HTMLElement[] = next.map((c) => c.el);
    if (streaming && sessionId) {
      if (!liveEl) {
        liveEl = h("div", { class: "turn assistant live empty" });
        liveFolded = false;
      }
      children.push(liveEl);
      paintLive(liveEl, s.live[sessionId]!);
    } else {
      liveEl = null;
    }
    const error = s.errors[sessionId ?? "draft"];
    if (error) {
      children.push(
        h(
          "div",
          { class: "turn error", role: "alert" },
          h("span", { class: "error-text" }, error),
          sessionId && lastUser >= 0 && !streaming ? h("button", { class: "link", onclick: () => void actions.regenerate() }, "Retry") : null,
        ),
      );
    }
    if (!session && s.providers.length === 0) {
      children.push(
        h(
          "div",
          { class: "empty-hint" },
          h("p", null, "No provider yet."),
          h("button", { class: "link", onclick: () => actions.openSettings() }, "Add one in Settings"),
        ),
      );
    }
    reconcile(column, children);
    if (follow) scrollToBottom();
    paintJump();
  };

  const paintLive = (el: HTMLElement, live: LiveTurn) => {
    el.classList.toggle("empty", live.text.length === 0 && live.reasoning.length === 0);
    let reasoning = el.querySelector(":scope > details.reasoning") as HTMLDetailsElement | null;
    if (live.reasoning) {
      if (!reasoning) {
        reasoning = reasoningBlock("Thinking…", live.reasoning, true);
        el.prepend(reasoning);
      } else {
        replaceChildren(reasoning.querySelector(".reasoning-body")!, renderMarkdown(live.reasoning));
      }
      if (live.answering && !liveFolded) {
        liveFolded = true;
        reasoning.open = false;
        reasoning.querySelector("summary")!.textContent = `Thought for ${formatDuration(Math.round(performance.now() - live.startedAt))}`;
      }
    }
    let body = el.querySelector(":scope > .body") as HTMLElement | null;
    if (!body) {
      body = h("div", { class: "body md" });
      el.append(body);
    }
    if (live.text) {
      // Patch, don't rebuild: unchanged blocks (and the preview pane's iframes) survive the frame.
      if (body.querySelector(":scope > .pulse")) replaceChildren(body);
      patchMarkdown(body, renderMarkdown(live.text));
      attachPreviews(body);
    } else if (!live.reasoning) replaceChildren(body, h("span", { class: "pulse", "aria-label": "waiting" }));
  };

  store.subscribe(render);
  store.onLive((id) => {
    if (id === store.state.currentId && liveEl) {
      paintLive(liveEl, store.state.live[id]!);
      if (follow) scrollToBottom();
      else paintJump();
    }
  });
  render(store.state);
  return { el: root, jump };
}

function renderMessage(m: Message, index: number, isLast: boolean, streaming: boolean): HTMLElement {
  const el = h("div", { class: `turn ${m.role}`, dataset: { index: String(index) } });
  const tools: HTMLElement[] = [];

  if (m.role === "user") {
    el.append(h("div", { class: "bubble" }, plainText(m.content)));
    tools.push(toolButton("copy", "Copy", () => actions.copyText(m.content)));
    if (isLast && !streaming) tools.push(toolButton("pencil", "Edit (⌘E)", () => actions.editLast()));
  } else {
    if (m.reasoning_content) {
      const ms = m.meta?.thinking_ms;
      el.append(reasoningBlock(ms ? `Thought for ${formatDuration(ms)}` : "Thoughts", m.reasoning_content, false));
    }
    const body = h("div", { class: "body md" }, renderMarkdown(m.content));
    attachPreviews(body);
    el.append(body);
    tools.push(toolButton("copy", "Copy", (btn) => (actions.copyText(m.content), flash(btn, "Copied"))));
    if (isLast && !streaming) tools.push(toolButton("redo", "Regenerate (⌘R)", () => void actions.regenerate()));
    const meta = turnMeta(m, { model: true });
    if (meta) tools.push(h("span", { class: "meta", title: turnMetaTitle(m) }, meta));
  }

  const bar = h("div", { class: "tools" }, tools);
  // Multi-clicks on the icons (copy, then regenerate) would otherwise start a
  // selection that WebKit extends into the neighbouring text.
  bar.addEventListener("mousedown", (e) => {
    if (e.detail > 1) e.preventDefault();
  });
  el.append(bar);

  el.addEventListener("contextmenu", (e) => {
    // Let the native text menu handle selections; ours is for the whole turn.
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    const items = [{ id: `ctx:copy:${index}`, label: "Copy" }];
    if (m.reasoning_content) items.push({ id: `ctx:copy_reasoning:${index}`, label: "Copy Reasoning" });
    if (isLast && !streaming) {
      items.push({ id: "", label: "", separator: true } as never);
      items.push(m.role === "assistant" ? { id: "ctx:regenerate", label: "Regenerate" } : { id: "ctx:edit", label: "Edit" });
    }
    const meta = turnMeta(m, { model: true });
    if (meta) {
      items.push({ id: "", label: "", separator: true } as never);
      items.push({ id: "ctx:meta", label: meta, enabled: false } as never);
    }
    actions.popupMenu(items);
  });
  return el;
}

/** Every ```html / ```svg block gets (or refreshes) its live preview pane. */
function attachPreviews(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>("pre.code.html").forEach((pre) => {
    const src = pre.querySelector("code")?.textContent ?? "";
    attachPreview(pre, pre.dataset.kind === "svg" ? svgPage(src) : src);
  });
}

/** An SVG shown the way a browser tab would: centred on white, scaled to fit. */
function svgPage(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#fff}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}svg{max-width:100%;max-height:100%}</style></head><body>${svg}</body></html>`;
}

function reasoningBlock(title: string, text: string, open: boolean): HTMLDetailsElement {
  const details = h("details", { class: "reasoning", open }, h("summary", null, title), h("div", { class: "reasoning-body md" }, renderMarkdown(text)));
  return details as HTMLDetailsElement;
}

function toolButton(name: IconName, title: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const btn = h("button", { class: "tool", title, "aria-label": title }, icon(name)) as HTMLButtonElement;
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}

function flash(btn: HTMLElement, text: string) {
  const prev = btn.innerHTML;
  btn.textContent = text;
  btn.classList.add("flash");
  setTimeout(() => {
    btn.innerHTML = prev;
    btn.classList.remove("flash");
  }, 900);
}

/** Keep the container's children equal to `next`, moving nodes instead of recreating them. */
function reconcile(parent: HTMLElement, next: HTMLElement[]) {
  const current = Array.from(parent.children) as HTMLElement[];
  if (current.length === next.length && current.every((c, i) => c === next[i])) return;
  for (const c of current) if (!next.includes(c)) c.remove();
  next.forEach((el, i) => {
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
  });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
