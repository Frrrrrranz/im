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
 *  what didn't change. Nodes are matched by position and updated in place
 *  whenever they kept their kind: text is edited after its common prefix (a
 *  selection or caret inside it stays put — replacing the node would collapse
 *  it), elements sync their attributes and recurse, a code block keeps its
 *  preview pane. Only a node that changed kind is swapped. */
export function patchMarkdown(body: HTMLElement, next: DocumentFragment) {
  patchChildren(body, next);
}

function patchChildren(a: Node, b: Node) {
  const incoming = Array.from(b.childNodes);
  const existing = Array.from(a.childNodes);
  for (let i = 0; i < incoming.length; i++) {
    const want = incoming[i]!;
    const have = existing[i];
    if (!have) a.appendChild(want);
    else if (!have.isEqualNode(want) && !patchNode(have, want)) a.replaceChild(want, have);
  }
  for (let i = incoming.length; i < existing.length; i++) existing[i]!.remove();
}

/** Make `a` match `b` in place; false when they are different kinds of node. */
function patchNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === Node.TEXT_NODE) {
    patchText(a as Text, (b as Text).data);
    return true;
  }
  if (!(a instanceof Element) || !(b instanceof Element) || a.tagName !== b.tagName) return false;
  if (isCodeBlock(a) || isCodeBlock(b)) {
    // The block's own chrome (and the transcript's preview pane) is not in `b`; only the code moves.
    if (a.className !== b.className) return false;
    const from = b.querySelector("code")!;
    const to = a.querySelector("code")!;
    if (to.textContent !== from.textContent) {
      patchChildren(to, from);
      setGutter(a.querySelector(".code-row")!, from.textContent ?? "");
    }
    return true;
  }
  for (const attr of Array.from(a.attributes)) if (!b.hasAttribute(attr.name)) a.removeAttribute(attr.name);
  for (const attr of Array.from(b.attributes)) if (a.getAttribute(attr.name) !== attr.value) a.setAttribute(attr.name, attr.value);
  patchChildren(a, b);
  return true;
}

/** Edit a text node from the first differing character on. Live ranges before
 *  that point are untouched; DOM `deleteData`/`insertData` adjust the rest. */
function patchText(a: Text, data: string) {
  const old = a.data;
  if (old === data) return;
  let p = 0;
  const n = Math.min(old.length, data.length);
  while (p < n && old.charCodeAt(p) === data.charCodeAt(p)) p++;
  if (p < old.length) a.deleteData(p, old.length - p);
  if (p < data.length) a.insertData(p, data.slice(p));
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
