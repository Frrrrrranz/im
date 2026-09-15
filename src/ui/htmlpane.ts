// Live HTML preview inside an ```html code block. The pane sits at the top of
// the block and renders whatever HTML has arrived so far while the code
// streams beneath it. Two sandboxed iframes take
// turns: the next version loads hidden and cross-fades in when ready, so the
// page grows without ever flashing white. Click the pane and it enlarges from
// where it is to the middle of the window, Quick Look style; Esc brings it back.

import { h, icon } from "../dom";

const SWAP_MS = 220;
const MIN_GAP_MS = 400;
const SANDBOX = "allow-scripts allow-forms allow-modals allow-popups";

/** Two iframes, one visible. `set(html)` loads the other one and swaps when it has rendered. */
class FrameStack {
  readonly el: HTMLElement;
  private frames: [HTMLIFrameElement, HTMLIFrameElement];
  private front = 0;
  private urls: [string, string] = ["", ""];
  private shown = "";
  private pending: string | null = null;
  private busy = false;
  private lastSwap = 0;
  onSwap: ((html: string) => void) | null = null;

  constructor(interactive: boolean) {
    const mk = () => h("iframe", { class: "pane-frame", sandbox: SANDBOX, title: "HTML preview", tabindex: -1 }) as HTMLIFrameElement;
    this.frames = [mk(), mk()];
    this.el = h("div", { class: `pane${interactive ? " interactive" : ""}` }, this.frames[0], this.frames[1]);
  }

  get html() {
    return this.shown;
  }

  set(html: string) {
    if (html === this.shown && this.pending === null) return;
    this.pending = html;
    this.flush();
  }

  private flush() {
    if (this.busy || this.pending === null) return;
    const wait = MIN_GAP_MS - (performance.now() - this.lastSwap);
    if (wait > 0) {
      this.busy = true;
      setTimeout(() => {
        this.busy = false;
        this.flush();
      }, wait);
      return;
    }
    const html = this.pending;
    this.pending = null;
    if (html === this.shown) return;
    this.busy = true;
    const back = 1 - this.front;
    const frame = this.frames[back]!;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const done = () => {
      frame.removeEventListener("load", done);
      this.frames[this.front]!.classList.remove("show");
      frame.classList.add("show");
      if (this.urls[back]) URL.revokeObjectURL(this.urls[back]!);
      this.urls[back] = url;
      this.front = back;
      this.shown = html;
      this.lastSwap = performance.now();
      this.onSwap?.(html);
      setTimeout(() => {
        this.busy = false;
        this.flush();
      }, SWAP_MS);
    };
    frame.addEventListener("load", done);
    frame.src = url;
  }

  dispose() {
    for (const u of this.urls) if (u) URL.revokeObjectURL(u);
  }
}

const panes = new WeakMap<HTMLElement, FrameStack>();

/** Give an ```html block its preview pane (once) and feed it the current text. */
export function attachPreview(pre: HTMLElement, html: string) {
  let stack = panes.get(pre);
  if (!stack) {
    stack = new FrameStack(false);
    panes.set(pre, stack);
    const wrap = h("div", { class: "code-preview", role: "button", title: "Enlarge preview", "aria-label": "Enlarge preview" }, stack.el, h("span", { class: "pane-zoom" }, icon("expand")));
    pre.prepend(wrap);
  }
  stack.set(html);
}

// ---- enlarged view -----------------------------------------------------------

let open: { root: HTMLElement; card: HTMLElement; source: HTMLElement; stack: FrameStack; unhook: () => void } | null = null;

/** Grow the pane inside `wrap` (a `.code-preview`) to the centre of `host`. */
export function enlarge(wrap: HTMLElement, host: HTMLElement) {
  if (open) return;
  const pre = wrap.closest("pre.code") as HTMLElement | null;
  const src = pre ? panes.get(pre) : undefined;
  if (!src) return;

  const stack = new FrameStack(true);
  const card = h("div", { class: "lightbox-card" }, stack.el, h("button", { class: "icon-btn lightbox-close", title: "Close (Esc)", "aria-label": "Close preview", onclick: () => close() }, icon("collapse")));
  const backdrop = h("div", { class: "lightbox-backdrop", onclick: () => close() });
  const root = h("div", { class: "lightbox" }, backdrop, card);
  host.append(root);

  // Start exactly over the pane, then glide to the large rect on the next frame.
  place(card, wrap.getBoundingClientRect(), host);
  stack.set(src.html);
  src.onSwap = (html) => stack.set(html);
  requestAnimationFrame(() => {
    root.classList.add("in");
    place(card, target(host), host);
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onResize = () => place(card, target(host), host);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  open = {
    root,
    card,
    source: wrap,
    stack,
    unhook: () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      src.onSwap = null;
    },
  };
}

function close() {
  if (!open) return;
  const { root, card, source, stack, unhook } = open;
  open = null;
  unhook();
  const host = root.parentElement!;
  // Back to the pane it came from — or to whatever pane replaced it if the
  // message finished (and re-rendered) while the preview was open.
  const home = source.isConnected ? source : Array.from(document.querySelectorAll<HTMLElement>(".transcript .code-preview")).pop();
  const rect = home ? home.getBoundingClientRect() : null;
  root.classList.remove("in");
  if (rect && rect.width > 0) place(card, rect, host);
  else card.classList.add("vanish");
  const finish = () => {
    stack.dispose();
    root.remove();
  };
  card.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 400);
}

function target(host: HTMLElement): DOMRect {
  const r = host.getBoundingClientRect();
  const m = 24;
  const top = 40 + 12; // below the header strip
  const w = r.width - 2 * m;
  const hgt = r.height - top - m;
  const k = Math.min(w / 16, hgt / 10);
  const cw = k * 16;
  const ch = k * 10;
  return new DOMRect(r.left + (r.width - cw) / 2, r.top + top + (hgt - ch) / 2, cw, ch);
}

function place(card: HTMLElement, rect: DOMRect, host: HTMLElement) {
  const r = host.getBoundingClientRect();
  card.style.left = `${rect.left - r.left}px`;
  card.style.top = `${rect.top - r.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
}
