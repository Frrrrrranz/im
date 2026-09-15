// Live HTML preview inside an ```html code block. The pane sits at the top of
// the block and renders whatever HTML has arrived so far while the code
// streams beneath it. Two sandboxed iframes take turns: the next version loads
// hidden and cross-fades in when ready, so the page grows without ever
// flashing white. Click the pane and it lifts off and grows to the middle of
// the window, Quick Look style; Esc brings it back.

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

  constructor() {
    const mk = () => h("iframe", { class: "pane-frame", sandbox: SANDBOX, title: "HTML preview", tabindex: -1 }) as HTMLIFrameElement;
    this.frames = [mk(), mk()];
    this.el = h("div", { class: "pane" }, this.frames[0], this.frames[1]);
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
      // `load` fires before the new document has painted; give it two frames,
      // then fade it in *over* the old one — the old frame stays opaque until
      // it is fully covered, so no white ever shows through the cross-fade.
      const old = this.frames[this.front]!;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          old.classList.remove("top");
          frame.classList.add("top", "show");
          if (this.urls[back]) URL.revokeObjectURL(this.urls[back]!);
          this.urls[back] = url;
          this.front = back;
          this.shown = html;
          this.lastSwap = performance.now();
          setTimeout(() => {
            old.classList.remove("show");
            this.busy = false;
            this.flush();
          }, SWAP_MS);
        }),
      );
    };
    frame.addEventListener("load", done);
    frame.src = url;
  }

}

const panes = new WeakMap<HTMLElement, FrameStack>();

/** Give an ```html block its preview pane (once) and feed it the current text. */
export function attachPreview(pre: HTMLElement, html: string) {
  let stack = panes.get(pre);
  if (!stack) {
    stack = new FrameStack();
    panes.set(pre, stack);
    const wrap = h("div", { class: "code-preview", role: "button", title: "Enlarge preview", "aria-label": "Enlarge preview" }, stack.el, h("span", { class: "pane-zoom" }, icon("expand")));
    pre.prepend(wrap);
  }
  if (settled(html)) stack.set(html);
}

/** Inside an unclosed <style> or <script> the parser swallows everything that
 *  follows, so that state would render as a blank or unstyled page for a swap
 *  or two; keep showing the previous one until the tag closes. */
function settled(html: string): boolean {
  for (const tag of ["style", "script"]) {
    const opens = html.split(`<${tag}`).length - 1;
    const closes = html.split(`</${tag}`).length - 1;
    if (opens > closes) return false;
  }
  return true;
}

// ---- enlarged view -----------------------------------------------------------

interface Lightbox {
  /** Dims the host column; a click on it closes. */
  shade: HTMLElement;
  /** The box that moves: the lifted pane itself, or a card holding an image. */
  card: HTMLElement;
  /** The card's laid-out rect (it only ever *appears* elsewhere, via transform). */
  rect: DOMRect;
  /** Where the card flies back to on close (null → it just fades). */
  home: () => HTMLElement | null;
  /** Stop listening the moment closing starts. */
  unhook: () => void;
  /** Put things back once the card has landed. */
  dispose: () => void;
}

let open: Lightbox | null = null;

/** Lift the pane inside `wrap` (a `.code-preview`) and grow it to the centre of
 *  `host`. It is the very same iframe, switched to fixed positioning — nothing
 *  reloads, so the page is there from the first frame (a second copy used to
 *  load into a white card and flash). A ghost keeps its slot in the block. */
export function enlarge(wrap: HTMLElement, host: HTMLElement) {
  if (open) return;
  const pre = wrap.closest("pre.code") as HTMLElement | null;
  const src = pre ? panes.get(pre) : undefined;
  if (!src) return;
  const pane = src.el;
  const from = pane.getBoundingClientRect();
  const ghost = h("div", { class: "pane ghost" });
  wrap.insertBefore(ghost, pane);
  pane.classList.add("lightbox-card", "interactive");
  pane.append(closeButton());
  show(host, pane, from, (r) => fit(r, 16 / 10, Infinity), {
    late: true,
    home: () => (ghost.isConnected ? ghost : null),
    dispose: () => {
      pane.classList.remove("lightbox-card", "interactive", "vanish", "in");
      pane.querySelector(":scope > .lightbox-close")?.remove();
      pane.removeAttribute("style");
      ghost.remove();
    },
  });
}

/** The same growth for an image in a user turn; it never scales past its natural size. */
export function enlargeImage(img: HTMLImageElement, host: HTMLElement) {
  if (open || !img.naturalWidth) return;
  const card = h("div", { class: "lightbox-card" }, h("img", { class: "lightbox-image", src: img.src, alt: img.alt }), closeButton());
  document.body.append(card);
  const turn = img.closest(".turn") as HTMLElement | null;
  const nth = turn ? Array.from(turn.querySelectorAll("img")).indexOf(img) : -1;
  show(host, card, img.getBoundingClientRect(), (r) => fit(r, img.naturalWidth / img.naturalHeight, img.naturalWidth), {
    home: () => (img.isConnected ? img : ((turn?.dataset.index && document.querySelector(`.transcript .turn[data-index="${turn.dataset.index}"] img:nth-of-type(${nth + 1})`)) as HTMLElement | null) ?? null),
    dispose: () => card.remove(),
  });
}

/** Close if something is enlarged. With `force` false, only when its card has
 *  left the document (the message was re-rendered or removed underneath it). */
export function closeEnlarged(force = true) {
  if (open && (force || !open.card.isConnected)) close();
}

function closeButton(): HTMLElement {
  return h(
    "button",
    {
      class: "icon-btn lightbox-close",
      title: "Close (Esc)",
      "aria-label": "Close preview",
      onclick: (e: Event) => {
        e.stopPropagation(); // the transcript's click handler would enlarge again
        close();
      },
    },
    icon("collapse"),
  );
}

function show(host: HTMLElement, card: HTMLElement, from: DOMRect, target: (avail: DOMRect) => DOMRect, opts: Pick<Lightbox, "home" | "dispose"> & { late?: boolean }) {
  const shade = h("div", { class: "lightbox", onclick: () => close() });
  host.append(shade);

  // FLIP: the box is laid out once and only a transform eases — animating
  // width/height would reflow the live page inside the iframe on every frame,
  // which stuttered like a slideshow. `late` keeps the layout the user is
  // looking at and reflows after landing (what you clicked grows as-is, then
  // sharpens, Quick Look style); otherwise it is laid out at the target first
  // and appears scaled down over the source.
  const rect = target(available(host));
  const laidOut = opts.late ? from : rect;
  // The pane already has a computed style, so the start state must land without
  // a transition of its own (or it would animate none → start and the real move
  // would only undo that). Commit it, then re-arm.
  card.style.transition = "none";
  place(card, laidOut);
  card.style.transform = opts.late ? "" : flip(rect, from);
  card.getBoundingClientRect();
  card.style.transition = "";
  requestAnimationFrame(() => {
    shade.classList.add("in");
    card.style.transform = opts.late ? flip(from, rect) : "";
  });
  const landed = (e: TransitionEvent) => {
    if (e.target !== card || e.propertyName !== "transform") return;
    card.removeEventListener("transitionend", landed);
    if (opts.late) settle(card, rect);
    card.classList.add("in"); // the close button, once the box is at rest
  };
  card.addEventListener("transitionend", landed);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onResize = () => {
    if (open) settle(card, (open.rect = target(available(host))));
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  open = {
    shade,
    card,
    rect,
    home: opts.home,
    unhook: () => {
      card.removeEventListener("transitionend", landed);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    },
    dispose: opts.dispose,
  };
}

function close() {
  if (!open) return;
  const { shade, card, rect, home, unhook, dispose } = open;
  open = null;
  unhook();
  const back = card.isConnected ? (home()?.getBoundingClientRect() ?? null) : null;
  shade.classList.remove("in");
  card.classList.remove("in");
  // If the box never got to its final layout (closed mid-flight) it is still laid out at the source.
  settle(card, rect);
  if (back && back.width > 0) card.style.transform = flip(rect, back);
  else card.classList.add("vanish");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    dispose();
    shade.remove();
  };
  // Only the card's own transform matters: the close button's opacity
  // transition bubbles up too and used to end the fly-back at 120ms.
  card.addEventListener("transitionend", (e) => {
    if (e.target === card && e.propertyName === "transform") finish();
  });
  setTimeout(finish, 400);
}

/** Lay the box out at `rect` with no transform, without animating the change. */
function settle(card: HTMLElement, rect: DOMRect) {
  card.style.transition = "none";
  place(card, rect);
  card.style.transform = "";
  card.getBoundingClientRect();
  card.style.transition = "";
}

/** The transform that makes a box laid out at `at` appear exactly over `seen` (origin top-left). */
function flip(at: DOMRect, seen: DOMRect): string {
  return `translate(${seen.left - at.left}px, ${seen.top - at.top}px) scale(${seen.width / at.width}, ${seen.height / at.height})`;
}

/** The part of `host` a card may cover: below the header strip, with a margin. */
function available(host: HTMLElement): DOMRect {
  const r = host.getBoundingClientRect();
  const m = 24;
  const top = 40 + 12;
  return new DOMRect(r.left + m, r.top + top, r.width - 2 * m, r.height - top - m);
}

/** The largest `ratio` box inside `avail`, no wider than `maxWidth`, centred. */
function fit(avail: DOMRect, ratio: number, maxWidth: number): DOMRect {
  const w = Math.min(avail.width, avail.height * ratio, maxWidth);
  const hgt = w / ratio;
  return new DOMRect(avail.left + (avail.width - w) / 2, avail.top + (avail.height - hgt) / 2, w, hgt);
}

/** Cards are `position: fixed`, so rects are viewport coordinates as measured. Geometry never animates. */
function place(card: HTMLElement, rect: DOMRect) {
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
}
