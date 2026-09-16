// Tiny DOM helpers. No framework: the app has a handful of views and the hot
// path (streaming) is hand-tuned, so a renderer would only add weight.

type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style" && typeof v === "object")
        Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function")
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "dataset" && typeof v === "object")
        Object.assign(el.dataset, v);
      else if (k in el && k !== "list" && k !== "form")
        (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else
      el.appendChild(
        typeof c === "object" ? c : document.createTextNode(String(c)),
      );
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildren(el: Element, ...children: Child[]) {
  clear(el);
  append(el, children);
}

/** Required parts of our own DOM should fail explicitly if their structure changes. */
export function requireElement<E extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): E {
  const el = root.querySelector<E>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

/** SF Symbol-ish glyphs as inline SVG (stroke = currentColor). */
export type IconName =
  | "plus"
  | "arrowUp"
  | "stop"
  | "copy"
  | "redo"
  | "pencil"
  | "check"
  | "chevron"
  | "sidebar"
  | "inspector"
  | "close"
  | "compose"
  | "gear"
  | "expand"
  | "collapse"
  | "display"
  | "sun"
  | "moon"
  | "export";

export function icon(name: IconName): SVGElement {
  const paths: Record<IconName, string> = {
    plus: "M8 3v10M3 8h10",
    arrowUp: "M8 13V3M3.5 7.5 8 3l4.5 4.5",
    stop: "M4.5 4.5h7v7h-7z",
    copy: "M6 6h7v7H6zM3 10V3h7",
    redo: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3",
    pencil: "M3 13l.8-3.2 7.4-7.4 2.4 2.4-7.4 7.4zM9.6 3.9l2.4 2.4",
    check: "M3 8.5l3 3 7-7",
    chevron: "M5.5 3.5 10 8l-4.5 4.5",
    sidebar:
      "M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM6 3.5v9",
    inspector:
      "M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM10 3.5v9",
    close: "M4 4l8 8M12 4l-8 8",
    expand: "M9.5 2.5H13.5V6.5M13.5 2.5 8.5 7.5M6.5 13.5H2.5V9.5M2.5 13.5l5-5",
    collapse: "M13.5 2.5 8.5 7.5M12.5 7.5H8.5V3.5M2.5 13.5l5-5M3.5 8.5h4v4",
    compose:
      "M8.5 3H4.2A1.2 1.2 0 0 0 3 4.2v7.6A1.2 1.2 0 0 0 4.2 13h7.6a1.2 1.2 0 0 0 1.2-1.2V7.5M11.6 2.4l2 2-5.4 5.4-2.5.5.5-2.5z",
    gear: "M6.5 3.2L6.6 0.8 9.4 0.8 9.5 3.2A5 5 0 0 1 11.4 4.3L13.5 3.2 14.9 5.6 12.9 6.9A5 5 0 0 1 12.9 9.1L14.9 10.4 13.5 12.8 11.4 11.7A5 5 0 0 1 9.5 12.8L9.4 15.2 6.6 15.2 6.5 12.8A5 5 0 0 1 4.6 11.7L2.5 12.8 1.1 10.4 3.1 9.1A5 5 0 0 1 3.1 6.9L1.1 5.6 2.5 3.2 4.6 4.3A5 5 0 0 1 6.5 3.2ZM8 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
    display:
      "M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM6.5 14h3M8 11.5V14",
    sun: "M8 5.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6M8 1.8v1.3M8 12.9v1.3M1.8 8h1.3M12.9 8h1.3M3.6 3.6l.9.9M11.5 11.5l.9.9M12.4 3.6l-.9.9M4.5 11.5l-.9.9",
    moon: "M12.8 10.6A5.3 5.3 0 0 1 5.4 3.2A5.4 5.4 0 1 0 12.8 10.6z",
    export: "M8 10V3M5 6.5 8 3l3 3.5M3 13h10v1.5H3z",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", paths[name]);
  // The gear is a silhouette (fill only): too dense to outline at 16px.
  p.setAttribute(
    "fill",
    name === "stop" || name === "gear" ? "currentColor" : "none",
  );
  p.setAttribute("fill-rule", "evenodd");
  p.setAttribute("stroke", name === "gear" ? "none" : "currentColor");
  p.setAttribute("stroke-width", "1.5");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.appendChild(p);
  return svg;
}

export function formatTokens(n: number): string {
  return n >= 10_000
    ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
    : String(n);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** "Today", "Yesterday", "Mon", "Sep 3", "2025" — like Messages.app. */
export function relativeDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return String(d.getFullYear());
}

export function debounceFrame<T extends unknown[]>(
  fn: (...args: T) => void,
): (...args: T) => void {
  let pending = false;
  let last: T;
  return (...args: T) => {
    last = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...last);
    });
  };
}
