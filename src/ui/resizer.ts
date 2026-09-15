// Drag handle on a column edge. The width is written to a CSS variable on
// every move and persisted once on release; double-click restores the default.

import * as actions from "../actions";
import { h } from "../dom";

interface Options {
  /** CSS variable the column reads its width from, e.g. `--sidebar-w`. */
  varName: string;
  setting: "sidebar" | "inspector";
  /** Which edge of the column the handle sits on. */
  edge: "left" | "right";
  min: number;
  /** Evaluated at drag time so the other column and the window size count. */
  max: () => number;
  fallback: number;
}

export function createResizer(opts: Options): HTMLElement {
  const root = document.documentElement;
  const current = () => parseFloat(getComputedStyle(root).getPropertyValue(opts.varName)) || opts.fallback;
  const el = h("div", { class: `resizer ${opts.edge}`, role: "separator", "aria-orientation": "vertical", title: "Drag to resize; double-click to reset" });

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = current();
    let w = startW;
    document.body.classList.add("resizing");
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      w = Math.round(Math.min(opts.max(), Math.max(opts.min, startW + (opts.edge === "right" ? dx : -dx))));
      root.style.setProperty(opts.varName, `${w}px`);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      if (w !== startW) actions.setColumnWidth(opts.setting, w);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  el.addEventListener("dblclick", () => {
    root.style.removeProperty(opts.varName);
    actions.setColumnWidth(opts.setting, undefined);
  });
  return el;
}

/** Current value of a column-width variable (the live one during a drag). */
export function columnWidth(varName: string, fallback: number): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName)) || fallback;
}

/** Push saved widths into the stylesheet variables (absent = default). */
export function applyColumnWidths(sidebar: number | undefined, inspector: number | undefined) {
  const root = document.documentElement.style;
  if (sidebar) root.setProperty("--sidebar-w", `${sidebar}px`);
  else root.removeProperty("--sidebar-w");
  if (inspector) root.setProperty("--inspector-w", `${inspector}px`);
  else root.removeProperty("--inspector-w");
}
