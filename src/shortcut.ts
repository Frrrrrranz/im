// Accelerator strings — what the backend registers ("Alt+Space",
// "Super+Shift+KeyK") — to and from what the user sees (⌥ Space, ⇧⌘K) and types.

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
    case "cmdorctrl":
    case "commandorcontrol":
      return "Super";
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

/** "Alt+Space" → "⌥ Space"; "" → "Off". Modifiers in the macOS order ⌃⌥⇧⌘. */
export function prettyShortcut(accel: string): string {
  if (!accel) return "Off";
  const parts = accel.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map(modifierOf).filter(Boolean));
  const glyphs = MODIFIERS.filter((m) => mods.has(m))
    .map((m) => MOD_GLYPH[m])
    .join("");
  const k = keyGlyph(key);
  return k.length > 1 ? `${glyphs} ${k}`.trim() : `${glyphs}${k}`;
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
