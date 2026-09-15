import * as actions from "./actions";
import { createBackend, isTauri } from "./api";
import { h } from "./dom";
import { store } from "./state";
import { createComposer } from "./ui/composer";
import { createInspector } from "./ui/inspector";
import { applyColumnWidths, columnWidth, createResizer } from "./ui/resizer";
import { createSettings } from "./ui/settings";
import { createInspectorControls, createSidebar, createWindowControls } from "./ui/sidebar";
import { createTopbar } from "./ui/topbar";
import { createTranscript } from "./ui/transcript";

async function main() {
  if (isTauri) forwardErrors();
  const backend = await createBackend();
  actions.setBackend(backend);
  if (!isTauri) document.documentElement.classList.add("mock");
  // No sidebar slide on launch: the saved state should just appear.
  document.body.classList.add("no-transitions");

  const app = document.getElementById("app")!;
  const transcript = createTranscript();
  const composer = createComposer();
  composer.prepend(transcript.jump);
  const chat = h("div", { class: "chat" }, transcript.el, composer);
  const main = h("main", { class: "main" }, createTopbar(), chat, createSettings(backend));
  // Drag handles straddle the column edges (5px each side), so they are not
  // clipped by the columns' overflow and are easy to hit.
  const sidebarHandle = createResizer({
    varName: "--sidebar-w",
    setting: "sidebar",
    edge: "right",
    min: 180,
    max: () => Math.min(420, window.innerWidth - (store.state.settings.inspector_visible ? columnWidth("--inspector-w", 300) : 0) - 360),
    fallback: 180,
  });
  const inspectorHandle = createResizer({
    varName: "--inspector-w",
    setting: "inspector",
    edge: "left",
    min: 240,
    max: () => Math.min(520, window.innerWidth - (store.state.settings.sidebar_visible ? columnWidth("--sidebar-w", 180) : 0) - 360),
    fallback: 300,
  });
  app.append(createSidebar(), main, createInspector(), sidebarHandle, inspectorHandle, createWindowControls(), createInspectorControls());

  store.subscribe((s) => {
    chat.hidden = s.view !== "chat";
    document.body.classList.toggle("no-sidebar", !s.settings.sidebar_visible);
    document.body.classList.toggle("no-inspector", !s.settings.inspector_visible);
    applyColumnWidths(s.settings.sidebar_width, s.settings.inspector_width);
    if (s.fatal) app.append(h("div", { class: "fatal" }, s.fatal));
  });

  await backend.onMenu(actions.handleMenu);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.state.view === "settings" && !(e.target as HTMLElement).closest("select")) {
      e.preventDefault();
      actions.closeSettings();
    }
  });
  if (!isTauri) installBrowserShortcuts();
  document.addEventListener("contextmenu", (e) => {
    // Chrome (chrome) has no useful context menu; the transcript has its own.
    if (!(e.target as HTMLElement).closest(".transcript, input, textarea")) e.preventDefault();
  });

  await actions.init();
  // Not in requestAnimationFrame: WebKit doesn't run frames while the window is hidden.
  await backend.showWindow();
  setTimeout(() => document.body.classList.remove("no-transitions"), 100);
  const scenario = await backend.scenario().catch(() => null);
  if (scenario) applyScenario(scenario);
  // A quiet look at the release feed once the UI is up; the gear gets a dot if there is something.
  if (isTauri || new URLSearchParams(location.search).has("update")) {
    setTimeout(() => void actions.checkForUpdates(), isTauri ? 4000 : 300);
    setInterval(() => void actions.checkForUpdates(), 6 * 60 * 60 * 1000);
  }
}

/** Drives the UI into a screenshot-able state (scripts/snapshot.sh, scripts/app-snapshot.sh). */
function applyScenario({ state, autosend }: { state?: string | null; autosend?: string | null }) {
  if (autosend) void actions.send(autosend);
  switch (state) {
    case "streaming":
      void actions.send("Explain the streaming pipeline once more, with the code sample.");
      break;
    case "streaming-html":
      void actions.send("Make me a tiny landing page.");
      break;
    case "picker":
      actions.togglePicker(true);
      break;
    case "settings":
      actions.openSettings();
      break;
    case "json":
      (document.querySelector(".inspector .seg:last-child") as HTMLElement | null)?.click();
      break;
    case "html-expanded":
      setTimeout(() => (document.querySelector("pre.code.html .code-preview") as HTMLElement | null)?.click(), 600);
      break;
    case "scrolled":
      // Reader has scrolled up: the jump-to-bottom button should be showing.
      requestAnimationFrame(() => {
        const t = document.querySelector(".transcript")!;
        t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 500);
      });
      break;
    case "resized": {
      // Synthetic drags on both handles: sidebar +80px, inspector +60px.
      const drag = (sel: string, from: number, to: number) => {
        const el = document.querySelector(sel);
        el?.dispatchEvent(new MouseEvent("mousedown", { clientX: from, button: 0, bubbles: true }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: to }));
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: to }));
      };
      drag(".resizer.right", 180, 260);
      drag(".resizer.left", window.innerWidth - 300, window.innerWidth - 360);
      break;
    }
    case "error":
      void actions.send("One more thing…");
      break;
    case "edit":
      actions.editLast();
      break;
    case "collapse":
      // Slow the slide right down so a snapshot lands in the middle of it.
      document.documentElement.style.setProperty("--dur", "4s");
      setTimeout(() => actions.toggleSidebar(), 300);
      break;
    case "collapse-frames": {
      // Real-speed collapse; logs how many frames it painted (RUST_LOG=webview=warn).
      const sidebar = document.querySelector(".sidebar")!;
      let frames = 0;
      let running = false;
      const tick = () => {
        frames++;
        if (running) requestAnimationFrame(tick);
      };
      sidebar.addEventListener("transitionstart", (e) => {
        if ((e as TransitionEvent).propertyName !== "width") return;
        running = true;
        requestAnimationFrame(tick);
      });
      sidebar.addEventListener("transitionend", (e) => {
        if ((e as TransitionEvent).propertyName !== "width") return;
        running = false;
        console.warn(`collapse: ${frames} frames in ${(e as TransitionEvent).elapsedTime * 1000}ms`);
      });
      setTimeout(() => actions.toggleSidebar(), 300);
      break;
    }
  }
}

/** Surface webview failures in the native process log (`RUST_LOG=webview=info`). */
function forwardErrors() {
  const send = (level: string, message: string) =>
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("log_message", { level, message })).catch(() => {});
  window.addEventListener("error", (e) => send("error", `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => send("error", `unhandled rejection: ${String(e.reason?.stack ?? e.reason)}`));
  const error = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    error(...args);
    send("error", args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" "));
  };
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    warn(...args);
    send("warn", args.map(String).join(" "));
  };
}

/** In Tauri these come from the native menu; in a browser we map them by hand. */
function installBrowserShortcuts() {
  const map: Record<string, string> = {
    "meta+n": "new_chat",
    "meta+,": "settings",
    "meta+k": "choose_model",
    "meta+.": "stop",
    "meta+r": "regenerate",
    "meta+e": "edit_last",
    "ctrl+meta+s": "toggle_sidebar",
    "alt+meta+t": "toggle_inspector",
    "meta+shift+[": "prev_chat",
    "meta+shift+]": "next_chat",
    "meta+shift+e": "export_chat",
  };
  window.addEventListener("keydown", (e) => {
    const combo = [e.ctrlKey && "ctrl", e.altKey && "alt", e.metaKey && "meta", e.shiftKey && "shift", (e.altKey ? e.code.replace(/^Key/, "") : e.key).toLowerCase()].filter(Boolean).join("+");
    const id = map[combo];
    if (id) {
      e.preventDefault();
      actions.handleMenu(id);
    }
  });
}

void main();
