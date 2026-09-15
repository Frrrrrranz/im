import * as actions from "../actions";
import { h, icon, relativeDay, replaceChildren } from "../dom";
import { store, type State } from "../state";

export function createSidebar(): HTMLElement {
  const list = h("div", { class: "sessions", role: "list" });
  const newChat = h(
    "button",
    { class: "nav-row", title: "New Chat (⌘N)", onclick: () => actions.newChat() },
    icon("compose"),
    h("span", { class: "nav-label" }, "New Chat"),
  );
  const inner = h(
    "div",
    { class: "sidebar-inner" },
    h("div", { class: "sidebar-head", "data-tauri-drag-region": "" }),
    h("div", { class: "nav" }, newChat),
    list,
  );
  const root = h("aside", { class: "sidebar" }, inner);

  let signature = "";
  const render = (s: State) => {
    newChat.classList.toggle("selected", s.currentId === null && s.view === "chat" && !s.session);
    const sig = [s.currentId, s.renamingId, s.view, s.sessions.map((x) => `${x.id}:${x.title}:${x.updated_at}`).join("|"), Object.keys(s.live).join(",")].join("\n");
    if (sig === signature) return;
    signature = sig;

    const rows: HTMLElement[] = [];
    let group = "";
    for (const sess of s.sessions) {
      const day = relativeDay(sess.updated_at);
      if (day !== group) {
        group = day;
        rows.push(h("div", { class: "group-label" }, day));
      }
      const selected = sess.id === s.currentId && s.view === "chat";
      const streaming = sess.id in s.live;
      const row = h("div", {
        class: `session${selected ? " selected" : ""}`,
        role: "listitem",
        dataset: { id: sess.id },
        onclick: () => {
          if (s.renamingId !== sess.id) void actions.selectSession(sess.id);
        },
        ondblclick: (e: MouseEvent) => {
          e.preventDefault();
          actions.startRename(sess.id);
        },
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          actions.popupMenu([
            { id: `ctx:rename:${sess.id}`, label: "Rename" },
            { id: `ctx:export:${sess.id}`, label: "Export…" },
            { separator: true },
            { id: `ctx:delete:${sess.id}`, label: "Delete" },
          ]);
        },
      });
      if (s.renamingId === sess.id) {
        const input = h("input", { class: "rename", value: sess.title, spellcheck: false }) as HTMLInputElement;
        let done = false;
        const finish = (commit: boolean) => {
          if (done) return;
          done = true;
          if (commit) void actions.finishRename(sess.id, input.value);
          else store.set({ renamingId: null });
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
          e.stopPropagation();
        });
        input.addEventListener("blur", () => finish(true));
        row.append(input);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } else {
        row.append(h("span", { class: "session-title" }, sess.title));
        if (streaming) row.append(h("span", { class: "dot", "aria-label": "generating" }));
      }
      rows.push(row);
    }
    replaceChildren(list, rows);
    const sel = list.querySelector(".session.selected");
    if (sel) (sel as HTMLElement).scrollIntoView({ block: "nearest" });
  };

  store.subscribe(render);
  render(store.state);
  return root;
}

/** Sidebar toggle and settings sit beside the traffic lights, fixed to the
 *  window, so they stay put while the sidebar slides under them. */
export function createWindowControls(): HTMLElement {
  const settings = h(
    "button",
    { class: "icon-btn", title: "Settings (⌘,)", "aria-label": "Settings", onclick: () => (store.state.view === "settings" ? actions.closeSettings() : actions.openSettings()) },
    icon("gear"),
    h("span", { class: "badge", hidden: true, "aria-label": "Update available" }),
  );
  store.subscribe((s) => {
    settings.classList.toggle("on", s.view === "settings");
    (settings.querySelector(".badge") as HTMLElement).hidden = !s.update || s.update.phase === "failed";
  });
  return h(
    "div",
    { class: "window-controls", "data-tauri-drag-region": "" },
    h("button", { class: "icon-btn", title: "Toggle Sidebar (⌃⌘S)", "aria-label": "Toggle Sidebar", onclick: () => actions.toggleSidebar() }, icon("sidebar")),
    settings,
  );
}

/** The trajectory toggle mirrors the cluster on the right edge of the window. */
export function createInspectorControls(): HTMLElement {
  return h(
    "div",
    { class: "window-controls right", "data-tauri-drag-region": "" },
    h("button", { class: "icon-btn", title: "Toggle Trajectory (⌥⌘T)", "aria-label": "Toggle Trajectory", onclick: () => actions.toggleInspector() }, icon("inspector")),
  );
}
