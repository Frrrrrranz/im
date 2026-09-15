// The quick-input panel's page: one card — the selection it was summoned over
// as a quote, a growing text field, the send button. Rust owns the window
// (placement, fade, show/hide); this page lays out, measures and reports its
// height, and hands the finished text back. Return sends, Shift-Return breaks
// the line, Esc (or clicking elsewhere) puts it away.

import { h, icon } from "./dom";

interface ShowPayload {
  selection: string | null;
  model: string | null;
  access: boolean;
}

interface Host {
  onShow(cb: (p: ShowPayload) => void): void;
  onBlur(cb: () => void): void;
  /** Listening now; a summon from before this is delivered. */
  ready(): Promise<void>;
  present(height: number): Promise<void>;
  resize(height: number): Promise<void>;
  submit(text: string): Promise<void>;
  /** `restore`: give the keyboard back to the app the panel was summoned over (Esc); a click elsewhere already chose one. */
  dismiss(restore: boolean): Promise<void>;
}

const isTauri = "__TAURI_INTERNALS__" in window;
/** The field stops growing here and scrolls (about eight lines). */
const MAX_FIELD = 176;

async function main() {
  const host = isTauri ? await tauriHost() : mockHost();
  const quoteText = h("div", { class: "quote-text" });
  const quoteRemove = h("button", { class: "quote-remove", type: "button", "aria-label": "Remove quote", title: "Remove quote" }, icon("close"));
  const quote = h("div", { class: "quote", hidden: true }, quoteText, quoteRemove);
  const textarea = h("textarea", { class: "input", rows: 1, placeholder: "Message", spellcheck: true }) as HTMLTextAreaElement;
  const send = h("button", { class: "send", type: "button", "aria-label": "Send", disabled: true }, icon("arrowUp")) as HTMLButtonElement;
  const card = h("div", { class: "card" }, quote, h("div", { class: "field-row" }, textarea, send));
  document.getElementById("quick")!.append(card);

  let selection: string | null = null;
  let composing = false;

  const height = () => Math.ceil(card.getBoundingClientRect().height);
  const resize = () => {
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_FIELD)}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_FIELD ? "auto" : "hidden";
  };
  const paintSend = () => {
    send.disabled = !textarea.value.trim() && !selection;
  };
  const setQuote = (text: string | null) => {
    selection = text;
    quote.hidden = !text;
    quoteText.textContent = text ?? "";
    paintSend();
  };
  /** The message: the selection as a markdown quote, then what was typed. */
  const compose = () => {
    const text = textarea.value.trim();
    const quoted = selection?.trim();
    if (!quoted) return text;
    const block = quoted.split("\n").map((line) => `> ${line}`).join("\n");
    return text ? `${block}\n\n${text}` : block;
  };

  const show = (p: ShowPayload) => {
    textarea.value = "";
    textarea.placeholder = p.model ? `Message ${p.model}` : "Message";
    setQuote(p.selection);
    resize();
    textarea.focus();
    void host.present(height());
  };
  const submit = () => {
    const text = compose();
    if (!text) return;
    textarea.value = "";
    setQuote(null);
    resize();
    void host.submit(text);
  };
  const dismiss = (restore: boolean) => void host.dismiss(restore);

  textarea.addEventListener("compositionstart", () => (composing = true));
  textarea.addEventListener("compositionend", () => (composing = false));
  textarea.addEventListener("input", () => {
    resize();
    paintSend();
    void host.resize(height());
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      if (composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss(true);
    }
  });
  quoteRemove.addEventListener("click", () => {
    setQuote(null);
    textarea.focus();
    void host.resize(height());
  });
  send.addEventListener("click", submit);
  // The whole card is the field: a click on its padding lands in the text.
  card.addEventListener("mousedown", (e) => {
    if (!(e.target as HTMLElement).closest("button, textarea")) {
      e.preventDefault();
      textarea.focus();
    }
  });

  host.onShow(show);
  host.onBlur(() => dismiss(false));
  await host.ready();
}

async function tauriHost(): Promise<Host> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  // Failures in this window are otherwise invisible: forward them to the process log.
  const report = (message: string) => invoke("log_message", { level: "error", message: `quick: ${message}` }).catch(() => {});
  window.addEventListener("error", (e) => report(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => report(`unhandled rejection: ${String(e.reason?.stack ?? e.reason)}`));
  // Debug builds: IM_QUICK_SEND types a message and presses Return once the panel is up; IM_QUICK_ESC=1 presses Esc.
  const scenario = await invoke<{ quick_send?: string | null; quick_esc?: boolean } | null>("debug_scenario").catch(() => null);
  let listening: Promise<unknown> = Promise.resolve();
  return {
    onShow: (cb) => {
      listening = listen<ShowPayload>("quick:show", (e) => {
        cb(e.payload);
        if (scenario?.quick_send) setTimeout(() => typeAndSend(scenario.quick_send!), 700);
        else if (scenario?.quick_esc) setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })), 700);
      });
    },
    onBlur: (cb) => void getCurrentWindow().onFocusChanged(({ payload: focused }) => !focused && cb()),
    ready: async () => {
      await listening;
      await invoke("quick_ready");
    },
    present: (height) => invoke("quick_present", { height }),
    resize: (height) => invoke("quick_resize", { height }),
    submit: (text) => invoke("quick_submit", { text }),
    dismiss: (restore) => invoke("quick_dismiss", { restore }),
  };
}

/** Scripted input: put `text` in the field and press the send button. */
function typeAndSend(text: string) {
  const field = document.querySelector(".input") as HTMLTextAreaElement;
  field.value = text;
  field.dispatchEvent(new Event("input"));
  (document.querySelector(".send") as HTMLButtonElement).click();
}

/** In a browser (`npm run dev`, scripts/snapshot.sh): `quick.html?state=quote|typed|long&theme=dark`. */
function mockHost(): Host {
  document.documentElement.classList.add("mock");
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme");
  if (theme) document.documentElement.style.colorScheme = theme;
  const state = params.get("state") ?? "empty";
  const selection =
    state === "quote" || state === "typed"
      ? "The stream is dropped, and whatever text already arrived is persisted with finish_reason: \"cancelled\" — so a truncated reply is still a faithful trajectory."
      : state === "long"
        ? Array.from({ length: 12 }, (_, i) => `line ${i + 1} of a long selection that should be clamped to three lines in the panel`).join("\n")
        : null;
  const log = (what: string) => {
    document.title = `quick: ${what}`;
  };
  return {
    onShow: (cb) => {
      setTimeout(() => {
        cb({ selection, model: "anthropic/claude-sonnet-4", access: true });
        if (state === "typed") {
          const ta = document.querySelector(".input") as HTMLTextAreaElement;
          ta.value = "Is that also what happens when the connection drops halfway?";
          ta.dispatchEvent(new Event("input"));
        }
      }, 50);
    },
    onBlur: () => {},
    ready: async () => {},
    present: async (height) => log(`present ${height}`),
    resize: async (height) => log(`resize ${height}`),
    submit: async (text) => log(`submit ${JSON.stringify(text)}`),
    dismiss: async (restore) => log(`dismiss${restore ? " (restore)" : ""}`),
  };
}

main().catch((e) => {
  console.error(e);
  document.body.append(h("div", { class: "fatal" }, String(e)));
});
