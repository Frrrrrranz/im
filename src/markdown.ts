// Markdown → sanitized DOM. Streaming re-renders the live message every frame,
// so this stays a pure function of the text with no per-call setup.

import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: false, async: false });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const PURIFY = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button", "img", "svg", "math"],
  FORBID_ATTR: ["style", "onerror", "onload"],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};

export function renderMarkdown(text: string): DocumentFragment {
  const html = marked.parse(text) as string;
  const clean = DOMPurify.sanitize(html, { ...PURIFY, RETURN_DOM_FRAGMENT: true }) as unknown as DocumentFragment;
  decorateCode(clean);
  return clean;
}

/** A code block is `pre.code > (.code-preview?) .code-body > (.code-bar, .code-row > (.gutter?, .code-scroll > code))`.
 *  The gutter is a real column; only `.code-scroll` scrolls horizontally, so
 *  long lines move beside the numbers, never under them. `html` and `svg`
 *  blocks are tagged `html` (+ `data-kind`); the transcript attaches the live
 *  preview pane. */
function decorateCode(root: ParentNode) {
  root.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    const lang = ([...code.classList].find((c) => c.startsWith("language-"))?.slice(9) ?? "").toLowerCase();
    pre.classList.add("code");
    if (lang === "html" || lang === "svg") {
      pre.classList.add("html");
      pre.dataset.kind = lang;
    }

    const scroll = document.createElement("div");
    scroll.className = "code-scroll";
    scroll.append(code);
    const row = document.createElement("div");
    row.className = "code-row";
    row.append(scroll);
    setGutter(row, code.textContent ?? "");

    const bar = document.createElement("div");
    bar.className = "code-bar";
    const label = document.createElement("span");
    label.className = "code-lang";
    label.textContent = lang;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "code-copy";
    copy.textContent = "Copy";
    copy.dataset.copy = "code";
    bar.append(label, copy);

    const body = document.createElement("div");
    body.className = "code-body";
    body.append(bar, row);
    pre.append(body);
  });
}

/** Line numbers for blocks of two lines or more; kept in step with the code while it streams. */
export function setGutter(row: HTMLElement, text: string) {
  const lines = text.replace(/\n$/, "").split("\n").length;
  let gutter = row.querySelector(":scope > .gutter") as HTMLElement | null;
  if (lines < 2) {
    gutter?.remove();
    return;
  }
  if (!gutter) {
    gutter = document.createElement("span");
    gutter.className = "gutter";
    gutter.setAttribute("aria-hidden", "true");
    row.prepend(gutter);
  }
  const want = Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n");
  if (gutter.textContent !== want) gutter.textContent = want;
}

/** Streaming: bring `body` to the freshly rendered `next` without rebuilding
 *  what didn't change. Blocks that are equal stay; a code block whose text grew
 *  is updated in place (its preview pane survives); everything else is swapped. */
export function patchMarkdown(body: HTMLElement, next: DocumentFragment) {
  const incoming = Array.from(next.childNodes);
  const existing = Array.from(body.childNodes);
  for (let i = 0; i < incoming.length; i++) {
    const b = incoming[i]!;
    const a = existing[i];
    if (!a) {
      body.append(b);
      continue;
    }
    if (a.isEqualNode(b)) continue;
    if (isCodeBlock(a) && isCodeBlock(b) && a.className === b.className) {
      const from = b.querySelector("code")!;
      const to = a.querySelector("code")!;
      if (to.textContent !== from.textContent) {
        to.textContent = from.textContent;
        setGutter(a.querySelector(".code-row")!, from.textContent ?? "");
      }
      continue;
    }
    body.replaceChild(b, a);
  }
  for (let i = incoming.length; i < existing.length; i++) existing[i]!.remove();
}

function isCodeBlock(n: Node): n is HTMLElement {
  return n instanceof HTMLElement && n.tagName === "PRE" && n.classList.contains("code");
}

export function plainText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const p = document.createElement("p");
  p.textContent = text;
  frag.appendChild(p);
  return frag;
}
