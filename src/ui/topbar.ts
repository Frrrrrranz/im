// The strip at the top of the main column: a drag region holding the model
// name as plain text. Clicking the model opens the picker.

import * as actions from "../actions";
import { h, icon, replaceChildren } from "../dom";
import { type State, store } from "../state";
import type { ProviderView } from "../types";

export function createTopbar(): HTMLElement {
  const modelBtn = h("button", {
    class: "model-btn",
    title: "Choose Model (⌘K)",
    onclick: () => actions.togglePicker(),
  });
  const picker = createPicker();
  const root = h(
    "header",
    { class: "topbar", "data-tauri-drag-region": "" },
    modelBtn,
    picker,
  );

  const render = (s: State) => {
    const m = actions.currentModel();
    const provider = s.providers.find((p) => p.id === m?.providerId);
    modelBtn.hidden = s.view !== "chat";
    replaceChildren(
      modelBtn,
      h(
        "span",
        { class: "model-name" },
        m?.model || (s.providers.length ? "Choose a model" : "No provider"),
      ),
      provider && s.providers.length > 1
        ? h("span", { class: "model-provider" }, provider.name)
        : null,
      icon("chevron"),
    );
    modelBtn.classList.toggle("open", s.pickerOpen);
    picker.hidden = !s.pickerOpen;
  };
  store.subscribe(render);
  render(store.state);
  return root;
}

interface Row {
  provider: ProviderView;
  model: string;
  custom?: boolean;
}

function createPicker(): HTMLElement {
  const input = h("input", {
    class: "picker-search",
    placeholder: "Search models",
    spellcheck: false,
  }) as HTMLInputElement;
  const list = h("div", { class: "picker-list", role: "listbox" });
  const root = h(
    "div",
    { class: "picker", role: "dialog", hidden: true },
    input,
    list,
  );
  root.addEventListener("mousedown", (e) => e.stopPropagation());

  let rows: Row[] = [];
  let highlighted = 0;

  const build = () => {
    const q = input.value.trim().toLowerCase();
    const { providers } = store.state;
    const current = actions.currentModel();
    rows = [];
    for (const p of providers) {
      for (const m of p.models)
        if (
          !q ||
          m.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
        )
          rows.push({ provider: p, model: m });
    }
    // Anything typed can be used verbatim with the current provider.
    const typed = input.value.trim();
    const target =
      providers.find((p) => p.id === current?.providerId) ?? providers[0];
    if (typed && target && !rows.some((r) => r.model === typed))
      rows.push({ provider: target, model: typed, custom: true });

    const currentIdx = rows.findIndex(
      (r) =>
        r.provider.id === current?.providerId && r.model === current?.model,
    );
    highlighted = Math.max(0, Math.min(highlighted, rows.length - 1));
    if (!q && currentIdx >= 0) highlighted = currentIdx;

    const items: HTMLElement[] = [];
    let group = "";
    rows.forEach((r, i) => {
      const label = r.custom ? "Use as typed" : r.provider.name;
      if (label !== group) {
        group = label;
        items.push(
          h(
            "div",
            { class: "picker-group" },
            label,
            r.custom
              ? ""
              : h("span", { class: "picker-proto" }, r.provider.protocol),
          ),
        );
      }
      const isCurrent = i === currentIdx;
      items.push(
        h(
          "div",
          {
            class: `picker-item${i === highlighted ? " active" : ""}${isCurrent ? " current" : ""}`,
            role: "option",
            "aria-selected": String(isCurrent),
            onmousemove: () => {
              if (highlighted !== i) {
                highlighted = i;
                paintHighlight();
              }
            },
            onclick: () => choose(i),
          },
          h("span", { class: "picker-model" }, r.model),
          isCurrent ? icon("check") : null,
          r.provider.has_key
            ? null
            : h(
                "span",
                { class: "picker-warn", title: "No API key" },
                "no key",
              ),
        ),
      );
    });
    replaceChildren(
      list,
      items.length
        ? items
        : [
            h(
              "div",
              { class: "picker-empty" },
              "No models. Add some in Settings.",
            ),
          ],
    );
    scrollActive();
  };

  const paintHighlight = () => {
    list.querySelectorAll(".picker-item").forEach((el, i) => {
      el.classList.toggle("active", i === highlighted);
    });
    scrollActive();
  };
  const scrollActive = () =>
    list
      .querySelector(".picker-item.active")
      ?.scrollIntoView({ block: "nearest" });

  const choose = (i: number) => {
    const r = rows[i];
    if (r) void actions.setModel(r.provider.id, r.model);
  };

  input.addEventListener("input", () => {
    highlighted = 0;
    build();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      highlighted = Math.min(rows.length - 1, highlighted + 1);
      paintHighlight();
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
      paintHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(highlighted);
    } else if (e.key === "Escape") {
      e.preventDefault();
      actions.togglePicker(false);
    }
  });

  const closeOnOutsideClick = (e: MouseEvent) => {
    if (
      !root.contains(e.target as Node) &&
      !(e.target as HTMLElement).closest(".model-btn")
    )
      actions.togglePicker(false);
  };

  let wasOpen = false;
  store.subscribe((s) => {
    if (s.pickerOpen && !wasOpen) {
      input.value = "";
      highlighted = 0;
      build();
      requestAnimationFrame(() => input.focus());
      window.addEventListener("mousedown", closeOnOutsideClick);
    } else if (s.pickerOpen) {
      build();
    } else if (wasOpen) {
      window.removeEventListener("mousedown", closeOnOutsideClick);
    }
    wasOpen = s.pickerOpen;
  });
  return root;
}
