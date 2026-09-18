// Accelerator strings — what the backend registers ("Alt+Space",
// "Super+Shift+KeyK") — to and from what the user sees (⌥ Space, ⇧⌘K) and types.

import { isMacOS } from "./platform";

const MODIFIERS = ["Control", "Alt", "Shift", "Super"] as const;
const MOD_GLYPH: Record<string, string> = {
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Super: "⌘",
};
const KEY_GLYPH: Record<string, string> = {
  Space: "Space",
  Enter: "↩",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

// One set of bindings supplies both webview shortcuts and their UI hints.
// Match physical key codes so Shift+[ and Alt+T work across keyboard layouts.
const primary = isMacOS ? "Super" : "Control";
const shifted = isMacOS ? "Shift+Super" : "Control+Shift";
export const menuShortcuts = {
  new_chat: `${primary}+KeyN`,
  attach_image: `${shifted}+KeyA`,
  settings: `${primary}+Comma`,
  choose_model: `${primary}+KeyK`,
  stop: `${primary}+Period`,
  regenerate: `${primary}+KeyR`,
  edit_last: `${primary}+KeyE`,
  toggle_sidebar: isMacOS ? "Control+Super+KeyS" : "Control+Shift+KeyS",
  toggle_inspector: isMacOS ? "Alt+Super+KeyT" : "Control+Alt+KeyT",
  prev_chat: `${shifted}+BracketLeft`,
  next_chat: `${shifted}+BracketRight`,
  export_chat: `${shifted}+KeyE`,
};

export function menuActionFromEvent(e: KeyboardEvent): string | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
  const accelerator = shortcutFromEvent(e);
  return (
    Object.entries(menuShortcuts).find(
      ([, keys]) => keys === accelerator,
    )?.[0] ?? null
  );
}

function modifierOf(part: string): string | null {
  switch (part.toLowerCase()) {
    case "ctrl":
    case "control":
      return "Control";
    case "alt":
    case "option":
      return "Alt";
    case "shift":
      return "Shift";
    case "super":
    case "cmd":
    case "command":
    case "meta":
      return "Super";
    case "cmdorctrl":
    case "commandorcontrol":
      return isMacOS ? "Super" : "Control";
    default:
      return null;
  }
}

function keyGlyph(code: string): string {
  if (KEY_GLYPH[code]) return KEY_GLYPH[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

/** "Alt+Space" → "⌥ Space" on macOS, "Alt+Space" on Windows; "" → "Off". */
export function prettyShortcut(accel: string): string {
  if (!accel) return "Off";
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map(modifierOf).filter(Boolean));
  const glyphs = MODIFIERS.filter((m) => mods.has(m))
    .map((m) => MOD_GLYPH[m])
    .join("");
  const k = keyGlyph(key);
  if (isMacOS) return k.length > 1 ? `${glyphs} ${k}`.trim() : `${glyphs}${k}`;
  const labels = MODIFIERS.filter((m) => mods.has(m)).map((m) =>
    m === "Control" ? "Ctrl" : m === "Super" ? "Win" : m,
  );
  return [...labels, k].join("+");
}

/** The accelerator a keydown describes, or null when it isn't a usable shortcut:
 *  a bare modifier, or a key with no modifier (that would swallow typing everywhere). */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  if (
    !code ||
    /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code) ||
    code === "CapsLock" ||
    code === "Fn"
  )
    return null;
  const mods = [
    e.ctrlKey && "Control",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    e.metaKey && "Super",
  ].filter((m): m is string => !!m);
  if (mods.length === 0 && !/^F\d{1,2}$/.test(code)) return null;
  return [...mods, code].join("+");
}
