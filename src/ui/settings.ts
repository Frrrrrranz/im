// In-window settings, laid out like System Settings: grouped lists with a
// label on the left and the control on the right. Every field saves itself
// when you leave it — there is no Save button. Providers are groups; a new one
// comes from the native "Add Provider" menu and is edited in place.

import type { Backend } from "../api";
import * as actions from "../actions";
import { h, replaceChildren } from "../dom";
import { PROTOCOLS } from "../presets";
import { store, type State } from "../state";
import type { Appearance, Protocol, ProviderView } from "../types";

export function createSettings(backend: Backend): HTMLElement {
  const providersList = h("div", { class: "groups" });
  const general = h("div", { class: "group" });
  const data = h("div", { class: "group" });

  const root = h(
    "div",
    { class: "settings", hidden: true },
    h(
      "div",
      { class: "settings-scroll" },
      h(
        "div",
        { class: "settings-column" },
        h("h1", null, "Settings"),
        section("Providers", "Anything that speaks Chat Completions, Anthropic Messages or Responses. Keys never leave this Mac."),
        providersList,
        h("button", { class: "add-row", onclick: () => actions.chooseProviderPreset() }, h("span", { class: "add-plus" }, "+"), "Add Provider"),
        section("General"),
        general,
        section("Data"),
        data,
      ),
    ),
  );

  // Provider groups are keyed by id and updated in place, so saving one field
  // never rebuilds (and un-focuses) the card you are typing in.
  const cards = new Map<string, ProviderCard>();
  const renderProviders = (providers: ProviderView[]) => {
    const seen = new Set<string>();
    const els: HTMLElement[] = [];
    for (const p of providers) {
      seen.add(p.id);
      let card = cards.get(p.id);
      if (!card) {
        card = providerCard(p, backend);
        cards.set(p.id, card);
      } else {
        card.update(p);
      }
      els.push(card.el);
    }
    for (const id of [...cards.keys()]) if (!seen.has(id)) cards.delete(id);
    replaceChildren(providersList, els.length ? els : [h("div", { class: "group-empty" }, "No providers yet — add one below.")]);
  };

  // "Version 0.1.0 · Check for Updates" → "0.2.0 available · Update" → "Downloading… 42%".
  const versionRow = () => {
    const s = store.state;
    const u = s.update;
    let control: HTMLElement;
    if (u && (u.phase === "downloading" || u.phase === "installing")) {
      control = h("span", { class: "srow-value" }, u.phase === "installing" ? "Installing…" : `Downloading… ${Math.round((u.progress ?? 0) * 100)}%`);
    } else if (u) {
      control = h("div", { class: "srow-inline" }, h("span", { class: `srow-value${u.phase === "failed" ? " err" : ""}`, title: u.error ?? u.notes ?? "" }, u.phase === "failed" ? "Update failed" : `${u.version} available`), tbtn(u.phase === "failed" ? "Retry" : "Update", () => void actions.installUpdate()));
    } else if (s.updateCheck === "checking") {
      control = h("span", { class: "srow-value" }, "Checking…");
    } else if (s.updateCheck === "uptodate") {
      control = h("span", { class: "srow-value" }, "Up to date");
    } else if (s.updateCheck === "failed") {
      control = h("div", { class: "srow-inline" }, h("span", { class: "srow-value err" }, "Couldn't reach the release feed"), tbtn("Retry", () => void actions.checkForUpdates(true)));
    } else {
      control = tbtn("Check for Updates", () => void actions.checkForUpdates(true));
    }
    return srow("Version", control, s.version ? `im ${s.version}` : undefined);
  };
  let versionEl: HTMLElement | null = null;

  const renderGeneral = (s: State) => {
    const settings = s.settings;
    const seg = h(
      "div",
      { class: "segmented", role: "radiogroup", "aria-label": "Appearance" },
      (["system", "light", "dark"] as Appearance[]).map((a) =>
        h(
          "button",
          { class: `seg${settings.appearance === a ? " on" : ""}`, role: "radio", "aria-checked": String(settings.appearance === a), onclick: () => void actions.setAppearance(a) },
          a[0]!.toUpperCase() + a.slice(1),
        ),
      ),
    );
    const maxTokens = h("input", { class: "sfield num", type: "number", min: 1, step: 1, value: String(settings.max_tokens) }) as HTMLInputElement;
    maxTokens.addEventListener("change", () => {
      const n = Math.max(1, Math.floor(Number(maxTokens.value) || 8192));
      maxTokens.value = String(n);
      void actions.saveSettings({ ...store.state.settings, max_tokens: n });
    });
    const prompt = h("textarea", { class: "sfield area", rows: 3, placeholder: "Copied into every new chat as its system prompt.", value: settings.system_prompt ?? "" }) as HTMLTextAreaElement;
    prompt.addEventListener("change", () => void actions.saveSettings({ ...store.state.settings, system_prompt: prompt.value.trim() || undefined }));
    versionEl = versionRow();
    replaceChildren(
      general,
      versionEl,
      srow("Appearance", seg),
      srow("Max output tokens", maxTokens, "Sent where the protocol needs one (Anthropic)."),
      srow("System prompt", null, undefined, prompt),
    );
  };

  const renderData = async () => {
    const dir = await backend.dataDir().catch(() => "");
    replaceChildren(
      data,
      srow("Folder", h("div", { class: "srow-inline" }, h("code", { class: "path" }, dir), tbtn("Show in Finder", () => actions.revealData()))),
      srow("Export", tbtn("All chats as JSONL…", () => void actions.exportAll()), "One session per line; messages are replayable {role, content} pairs."),
    );
  };

  let wasOpen = false;
  let lastProviders: ProviderView[] | null = null;
  store.subscribe((s) => {
    const open = s.view === "settings";
    root.hidden = !open;
    if (open && s.providers !== lastProviders) {
      lastProviders = s.providers;
      renderProviders(s.providers);
    }
    if (open && !wasOpen) {
      renderGeneral(s);
      void renderData();
    } else if (open) {
      // Appearance may have changed from the menu; keep the segmented control honest.
      general.querySelectorAll(".seg").forEach((b, i) => b.classList.toggle("on", (["system", "light", "dark"] as Appearance[])[i] === s.settings.appearance));
      if (versionEl) {
        const next = versionRow();
        versionEl.replaceWith(next);
        versionEl = next;
      }
    }
    if (open && s.focusProvider) {
      const id = s.focusProvider;
      store.state.focusProvider = null;
      requestAnimationFrame(() => cards.get(id)?.focus());
    }
    wasOpen = open;
  });
  return root;
}

function section(title: string, note?: string): HTMLElement {
  return h("div", { class: "section" }, h("h2", null, title), note ? h("p", { class: "section-note" }, note) : null);
}

/** One list row: label · control (right); optional note under the label and a
 *  full-width block (textarea) beneath. */
function srow(label: string, control: HTMLElement | null, note?: string, block?: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: `srow${block ? " has-block" : ""}` },
    h("div", { class: "srow-label" }, label, note ? h("div", { class: "srow-note" }, note) : null),
    control ? h("div", { class: "srow-control" }, control) : null,
    block ? h("div", { class: "srow-block" }, block) : null,
  );
}

function tbtn(label: string, onClick: () => void, danger = false): HTMLButtonElement {
  return h("button", { class: `tbtn${danger ? " danger" : ""}`, type: "button", onclick: onClick }, label) as HTMLButtonElement;
}

interface ProviderCard {
  el: HTMLElement;
  update(p: ProviderView): void;
  focus(): void;
}

function providerCard(initial: ProviderView, backend: Backend): ProviderCard {
  let p = initial;
  const name = h("input", { class: "sfield name", value: p.name, placeholder: "Name", spellcheck: false }) as HTMLInputElement;
  const id = h("div", { class: "provider-id" }, p.id);
  const protocol = h("select", { class: "popup" }, PROTOCOLS.map((x) => h("option", { value: x.value, selected: x.value === p.protocol }, x.label))) as HTMLSelectElement;
  const baseUrl = h("input", { class: "sfield mono", value: p.base_url, placeholder: "https://host/v1", spellcheck: false, type: "url" }) as HTMLInputElement;
  const key = h("input", { class: "sfield mono", type: "password", placeholder: p.has_key ? "••••••••" : "Not set", autocomplete: "off", spellcheck: false }) as HTMLInputElement;
  const models = h("textarea", { class: "sfield area mono", rows: rowsFor(p.models.length), placeholder: "one model id per line", spellcheck: false, value: p.models.join("\n") }) as HTMLTextAreaElement;
  const count = h("span", { class: "srow-value" });
  const fetchBtn = tbtn("Fetch", () => void fetchModels());
  const endpoint = h("div", { class: "srow-note mono end" });

  const modelList = () => [...new Set(models.value.split(/\r?\n/).map((m) => m.trim()).filter(Boolean))];
  const say = (text: string, err = false) => {
    count.textContent = text;
    count.classList.toggle("err", err);
  };
  const paintCount = () => say(`${modelList().length || "no"} model${modelList().length === 1 ? "" : "s"}`);
  const paintEndpoint = () => {
    const proto = PROTOCOLS.find((x) => x.value === protocol.value)!;
    endpoint.textContent = baseUrl.value.trim() ? `${baseUrl.value.trim().replace(/\/+$/, "")}${proto.path}` : "";
  };

  const save = async (apiKey?: string) => {
    try {
      const providers = await backend.saveProvider({
        id: p.id,
        name: name.value.trim() || p.id,
        protocol: protocol.value as Protocol,
        base_url: baseUrl.value.trim(),
        models: modelList(),
        api_key: apiKey,
      });
      store.set({ providers });
    } catch (e) {
      say(String(e), true);
    }
  };

  const fetchModels = async () => {
    fetchBtn.disabled = true;
    say("Fetching…");
    try {
      const ids = await backend.fetchModels(protocol.value as Protocol, baseUrl.value.trim(), key.value.trim() || undefined, p.id);
      if (ids.length) {
        models.value = ids.join("\n");
        models.rows = rowsFor(ids.length);
        await save();
      }
      paintCount();
    } catch (e) {
      say(String(e), true);
    } finally {
      fetchBtn.disabled = false;
    }
  };

  name.addEventListener("change", () => void save());
  protocol.addEventListener("change", () => (paintEndpoint(), void save()));
  baseUrl.addEventListener("input", paintEndpoint);
  baseUrl.addEventListener("change", () => void save());
  key.addEventListener("change", () => {
    const k = key.value.trim();
    if (!k) return;
    key.value = "";
    void save(k);
  });
  models.addEventListener("input", paintCount);
  models.addEventListener("change", () => (models.rows = rowsFor(modelList().length), void save()));
  paintEndpoint();
  paintCount();

  const remove = async () => {
    const ok = await backend.confirm(`Remove “${p.name}”? Its API key is deleted too; chats are kept.`, "Remove Provider", "Remove");
    if (!ok) return;
    const providers = await backend.deleteProvider(p.id);
    const draft = store.state.draft?.providerId === p.id ? null : store.state.draft;
    store.set({ providers, draft });
  };

  const el = h(
    "div",
    { class: "group provider" },
    h("div", { class: "srow provider-head" }, h("div", { class: "srow-label" }, name, id), h("div", { class: "srow-control" }, protocol)),
    h("div", { class: "srow" }, h("div", { class: "srow-label" }, "Base URL"), h("div", { class: "srow-control stack" }, baseUrl, endpoint)),
    srow("API key", key),
    h("div", { class: "srow has-block" }, h("div", { class: "srow-label" }, "Models"), h("div", { class: "srow-control srow-inline" }, count, fetchBtn), h("div", { class: "srow-block" }, models)),
    h("div", { class: "srow provider-foot" }, tbtn("Remove Provider…", () => void remove(), true)),
  );

  return {
    el,
    update(next) {
      p = next;
      if (document.activeElement !== name) name.value = next.name;
      if (document.activeElement !== protocol) protocol.value = next.protocol;
      if (document.activeElement !== baseUrl) baseUrl.value = next.base_url;
      if (document.activeElement !== models) {
        models.value = next.models.join("\n");
        models.rows = rowsFor(next.models.length);
      }
      key.placeholder = next.has_key ? "••••••••" : "Not set";
      paintEndpoint();
      paintCount();
    },
    focus() {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      (baseUrl.value ? key : baseUrl).focus();
    },
  };
}

function rowsFor(n: number): number {
  return Math.min(10, Math.max(2, n + 1));
}
