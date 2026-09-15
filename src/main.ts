import * as actions from "./actions";
import { createBackend, isTauri, sampleImage } from "./api";
import { h } from "./dom";
import { normalizeImage } from "./images";
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
  // On a wide window the reading column can be widened from either edge; the
  // column is centred, so one edge moving by dx widens it by 2dx.
  for (const edge of ["left", "right"] as const) {
    chat.append(
      Object.assign(
        createResizer({
          varName: "--column-w",
          setting: "column",
          edge,
          factor: 2,
          min: 480,
          max: () => chat.clientWidth - 48,
          fallback: 720,
        }),
        { className: `resizer column-handle ${edge}` },
      ),
    );
  }
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
    applyColumnWidths(s.settings.sidebar_width, s.settings.inspector_width, s.settings.column_width);
    if (s.fatal) app.append(h("div", { class: "fatal" }, s.fatal));
  });

  await backend.onMenu(actions.handleMenu);
  await backend.onQuick(actions.quickSend);
  // Image files dropped anywhere on the window land in the composer.
  await backend.onDrop(
    (files) => void actions.attachImages(files),
    (over) => document.body.classList.toggle("dropping", over),
  );
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
function applyScenario({ state, autosend, attach, query }: { state?: string | null; autosend?: string | null; attach?: string | null; query?: string | null }) {
  // Switches for a scenario: `?click=1200&close=1500&frames=1` in the browser, `IM_QUERY=…` in the app.
  const opts = new URLSearchParams(query ?? location.search);
  if (attach) {
    // IM_ATTACH=/path: the file goes through read_image → normalizeImage exactly as a drop would.
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<ArrayBuffer>("read_image", { path: attach }))
      .then((buf) => actions.attachImages([buf]))
      .then(() => autosend && actions.typeAndSend(autosend));
  } else if (autosend) void actions.send(autosend);
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
    case "html-expanded": {
      // `click=<ms>` delays the click (a cold headless run needs ~1s before the pane has rendered);
      // `close=<ms>` presses ⤡ that much later; `frames=1` reports, per motion, how many frames it
      // painted and how long the click took to start moving (console.warn → the Rust log in the app).
      const clickAt = Number(opts.get("click") ?? 600);
      let clicked = 0;
      let phase = "open";
      setTimeout(() => {
        clicked = performance.now();
        (document.querySelector("pre.code.html .code-preview") as HTMLElement | null)?.click();
      }, clickAt);
      if (opts.has("close")) {
        setTimeout(() => {
          clicked = performance.now();
          phase = "close";
          (document.querySelector(".lightbox-close") as HTMLElement | null)?.click();
        }, clickAt + Number(opts.get("close")));
      }
      if (opts.has("frames")) {
        let frames = 0;
        let running = false;
        let moving: EventTarget | null = null; // remembered from transitionstart: dispose() strips the class before the end event bubbles here
        const isCard = (e: TransitionEvent) => e.propertyName === "transform" && (e.target === moving || (e.target as HTMLElement).classList.contains("lightbox-card"));
        const tick = () => {
          frames++;
          if (running) requestAnimationFrame(tick);
        };
        document.addEventListener("transitionstart", (e) => {
          if (!isCard(e)) return;
          moving = e.target;
          frames = 0;
          running = true;
          console.warn(`lift(${phase}): motion began ${Math.round(performance.now() - clicked)}ms after the click`);
          requestAnimationFrame(tick);
        });
        document.addEventListener("transitioncancel", (e) => {
          if (isCard(e as TransitionEvent)) console.warn(`lift(${phase}): transform transition CANCELLED after ${frames} frames`);
        });
        document.addEventListener("transitionend", (e) => {
          if (!isCard(e)) return;
          running = false;
          const line = `lift(${phase}): ${frames} frames in ${Math.round(e.elapsedTime * 1000)}ms`;
          console.warn(line);
          document.title += ` | ${line}`;
        });
      }
      break;
    }
    case "image-expanded":
      setTimeout(() => (document.querySelector(".turn.user .images img") as HTMLElement | null)?.click(), Number(opts.get("click") ?? 600));
      break;
    case "scrolled":
      // Reader has scrolled up: the jump-to-bottom button should be showing.
      requestAnimationFrame(() => {
        const t = document.querySelector(".transcript")!;
        t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 500);
      });
      break;
    case "close":
      // Debug: ask the window to close the way the red button does; it must hide, not die.
      setTimeout(() => void import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().close()), 800);
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
    case "attach":
      // An image waiting in the composer, as after a paste or drop.
      void actions.attachImages([sampleImage()]);
      break;
    case "send-image":
      // A whole turn with an image, end to end (PROVIDER=mock shows `+1i` in the server log).
      void normalizeImage(sampleImage()).then((url) => actions.send("What does this chart say?", [url]));
      break;
    case "collapse":
      // Slow the slide right down so a snapshot lands in the middle of it.
      document.documentElement.style.setProperty("--dur", "4s");
      setTimeout(() => actions.toggleSidebar(), 300);
      break;
    case "select-test": {
      // Does a selection inside the *growing* paragraph survive the per-frame patch?
      // Result lands in document.title for `chrome --dump-dom`.
      void actions.send("Explain the streaming pipeline once more, with the code sample.");
      const sel = getSelection()!;
      let want = "";
      let frames = 0;
      let lost = 0;
      let panes = 0;
      let ticks = 0;
      let liveSeen = 0;
      const seen = new Set<Element>();
      const report = h("div", { style: { position: "fixed", top: "44px", left: "50%", transform: "translateX(-50%)", zIndex: "99", padding: "4px 10px", background: "#ffe45c", color: "#000", font: "13px/1.4 Menlo, monospace", whiteSpace: "pre" } });
      document.body.append(report);
      const tick = () => {
        ticks++;
        if (document.querySelector(".turn.live")) liveSeen++;
        document.querySelectorAll(".transcript .pane").forEach((p) => seen.add(p));
        panes = seen.size;
        if (!want) {
          const p = Array.from(document.querySelectorAll(".turn.live .body > p")).pop();
          const t = Array.from(p?.childNodes ?? []).find((n): n is Text => n.nodeType === Node.TEXT_NODE && (n as Text).length > 20);
          if (t) {
            sel.setBaseAndExtent(t, 2, t, 12);
            want = sel.toString();
          }
        } else {
          frames++;
          if (sel.toString() !== want) lost++;
        }
        report.textContent = document.title = `select-test ${frames < 150 ? "running" : "done"} ticks=${ticks} live=${liveSeen} frames=${frames} lost=${lost} panes=${panes} want=${JSON.stringify(want)}`;
        if (frames < 150) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      break;
    }
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
    "meta+shift+a": "attach_image",
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

main().catch(async (e) => {
  // Never leave a hidden window behind: show it and say what went wrong.
  console.error(e);
  const app = document.getElementById("app");
  app?.append(h("div", { class: "fatal" }, String(e)));
  try {
    const backend = await createBackend();
    await backend.showWindow();
  } catch {
    /* nothing left to try */
  }
});
