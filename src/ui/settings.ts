// In-window settings, laid out like System Settings: grouped lists with a
// label on the left and the control on the right. Every field saves itself
// when you leave it — there is no Save button. "Add Provider" opens an empty
// card; it becomes a real provider the moment it has a name.

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
  const addRow = h("button", { class: "add-row", onclick: () => addDraft() }, h("span", { class: "add-plus" }, "+"), "Add Provider");

  const root = h(
    "div",
    { class: "settings", hidden: true },
    h(
      "div",
      { class: "settings-scroll" },
      h("div", { class: "settings-column" }, h("h1", null, "Settings"), section("Providers"), providersList, addRow, section("General"), general, section("Data"), data),
    ),
  );

  // Cards are keyed by provider id and updated in place, so saving one field
  // never rebuilds (and un-focuses) the card being typed in. A draft card has
  // no id yet; it registers itself once the first save gives it one.
  const cards = new Map<string, ProviderCard>();
  let draft: ProviderCard | null = null;
  const renderProviders = (providers: ProviderView[]) => {
    const seen = new Set<string>();
    const els: HTMLElement[] = [];
    for (const p of providers) {
      seen.add(p.id);
      let card = cards.get(p.id);
      if (!card) {
        card = providerCard(p, backend, hooks);
        cards.set(p.id, card);
      } else {
        card.update(p);
      }
      els.push(card.el);
    }
    for (const id of [...cards.keys()]) if (!seen.has(id)) cards.delete(id);
    if (draft) els.push(draft.el);
    replaceChildren(providersList, els.length ? els : [h("div", { class: "group-empty" }, "No providers yet.")]);
  };
  const hooks: CardHooks = {
    created(id, card) {
      cards.set(id, card);
      if (draft === card) draft = null;
    },
    discard(card) {
      if (draft === card) {
        draft = null;
        card.el.remove();
        if (cards.size === 0) renderProviders(store.state.providers);
      }
    },
  };
  const addDraft = () => {
    if (draft) {
      draft.focus();
      return;
    }
    draft = providerCard({ id: "", name: "", protocol: "chat", base_url: "", models: [], has_key: false }, backend, hooks);
    providersList.querySelector(".group-empty")?.remove();
    providersList.append(draft.el);
    draft.focus();
  };

  // "Version 0.1.0 · Check for Updates" → "0.2.0 available · Update" → "Downloading… 42%".
  const versionRow = () => {
    const s = store.state;
    const u = s.update;
    let control: HTMLElement;
    if (u && (u.phase === "downloading" || u.phase === "installing")) {
      control = h("span", { class: "srow-value" }, u.phase === "installing" ? "Installing…" : `Downloading… ${Math.round((u.progress ?? 0) * 100)}%`);
    } else if (u) {
      control = h(
        "div",
        { class: "srow-inline" },
        h("span", { class: `srow-value${u.phase === "failed" ? " err" : ""}`, title: u.error ?? u.notes ?? "" }, u.phase === "failed" ? "Update failed" : `${u.version} available`),
        tbtn(u.phase === "failed" ? "Retry" : "Update", () => void actions.installUpdate()),
      );
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
    const prompt = h("textarea", { class: "sfield area", rows: 3, placeholder: "Copied into every new chat as its system prompt.", value: settings.system_prompt ?? "" }) as HTMLTextAreaElement;
    prompt.addEventListener("change", () => void actions.saveSettings({ ...store.state.settings, system_prompt: prompt.value.trim() || undefined }));
    versionEl = versionRow();
    replaceChildren(general, versionEl, srow("Appearance", seg), srow("System prompt", null, undefined, prompt));
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
    wasOpen = open;
  });
  return root;
}

function section(title: string): HTMLElement {
  return h("div", { class: "section" }, h("h2", null, title));
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

interface CardHooks {
  created(id: string, card: ProviderCard): void;
  discard(card: ProviderCard): void;
}

/** `a-z0-9-` from a name, or the URL's host; unique among the current providers. */
function idFor(name: string, baseUrl: string): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) {
    try {
      base = new URL(baseUrl).hostname.split(".").slice(-2, -1)[0] ?? "";
    } catch {
      base = "";
    }
  }
  base = base || "provider";
  const taken = new Set(store.state.providers.map((p) => p.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

function providerCard(initial: ProviderView, backend: Backend, hooks: CardHooks): ProviderCard {
  let p = initial;
  const isDraft = () => p.id === "";
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

  // A draft becomes real on its first save; until it has a name (or a URL to
  // name it after) nothing is written.
  const save = async (apiKey?: string) => {
    if (isDraft() && !name.value.trim() && !baseUrl.value.trim()) return;
    const creating = isDraft();
    const pid = creating ? idFor(name.value.trim(), baseUrl.value.trim()) : p.id;
    try {
      const providers = await backend.saveProvider({
        id: pid,
        name: name.value.trim() || pid,
        protocol: protocol.value as Protocol,
        base_url: baseUrl.value.trim(),
        models: modelList(),
        api_key: apiKey,
      });
      if (creating) {
        p = providers.find((x) => x.id === pid) ?? { ...p, id: pid };
        id.textContent = pid;
        el.classList.remove("draft");
        footBtn.textContent = "Remove Provider…";
        hooks.created(pid, card);
      }
      store.set({ providers });
      if (creating && !store.state.draft) {
        const first = providers.find((x) => x.id === pid);
        if (first) store.set({ draft: { providerId: first.id, model: first.models[0] ?? "" } });
      }
    } catch (e) {
      say(String(e), true);
    }
  };

  const fetchModels = async () => {
    fetchBtn.disabled = true;
    say("Fetching…");
    try {
      const ids = await backend.fetchModels(protocol.value as Protocol, baseUrl.value.trim(), key.value.trim() || undefined, isDraft() ? undefined : p.id);
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
    if (isDraft()) {
      hooks.discard(card);
      return;
    }
    const ok = await backend.confirm(`Remove “${p.name}”? Its API key is deleted too; chats are kept.`, "Remove Provider", "Remove");
    if (!ok) return;
    const providers = await backend.deleteProvider(p.id);
    const draft = store.state.draft?.providerId === p.id ? null : store.state.draft;
    store.set({ providers, draft });
  };

  const footBtn = tbtn(isDraft() ? "Discard" : "Remove Provider…", () => void remove(), true);
  const el = h(
    "div",
    { class: `group provider${isDraft() ? " draft" : ""}` },
    h("div", { class: "srow provider-head" }, h("div", { class: "srow-label" }, name, id), h("div", { class: "srow-control" }, protocol)),
    h("div", { class: "srow" }, h("div", { class: "srow-label" }, "Base URL"), h("div", { class: "srow-control stack" }, baseUrl, endpoint)),
    srow("API key", key),
    h("div", { class: "srow has-block" }, h("div", { class: "srow-label" }, "Models"), h("div", { class: "srow-control srow-inline" }, count, fetchBtn), h("div", { class: "srow-block" }, models)),
    h("div", { class: "srow provider-foot" }, footBtn),
  );

  const card: ProviderCard = {
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
      id.textContent = next.id;
      paintEndpoint();
      paintCount();
    },
    focus() {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      (isDraft() ? name : baseUrl.value ? key : baseUrl).focus();
    },
  };
  return card;
}

function rowsFor(n: number): number {
  return Math.min(10, Math.max(2, n + 1));
}
