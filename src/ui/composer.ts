// Auto-growing textarea. Return sends unless an IME composition is in
// progress (CJK input) or Shift is held. Escape stops generation / edit.
// Images pasted, dropped or chosen (File → Attach Image…) sit in a strip
// above the text until the message goes out.

import * as actions from "../actions";
import { h, icon, replaceChildren } from "../dom";
import { type State, store } from "../state";

export function createComposer(): HTMLElement {
  const textarea = h("textarea", {
    class: "input",
    rows: 1,
    placeholder: "Message",
    spellcheck: true,
    autofocus: true,
  }) as HTMLTextAreaElement;
  const button = h(
    "button",
    { class: "send", type: "button", "aria-label": "Send" },
    icon("arrowUp"),
  ) as HTMLButtonElement;
  const editBar = h(
    "div",
    { class: "edit-bar" },
    h("span", null, "Editing last message"),
    h(
      "button",
      { class: "link", onclick: () => actions.cancelEdit() },
      "Cancel",
    ),
  );
  const strip = h("div", { class: "attachments", hidden: true });
  const root = h(
    "div",
    { class: "composer" },
    editBar,
    h(
      "div",
      { class: "field" },
      strip,
      h("div", { class: "field-row" }, textarea, button),
    ),
  );

  let attachments: string[] = [];

  const resize = () => {
    textarea.style.height = "0px";
    const max = Math.max(120, window.innerHeight * 0.4);
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
    textarea.style.overflowY = textarea.scrollHeight > max ? "auto" : "hidden";
  };

  const paintAttachments = () => {
    strip.hidden = attachments.length === 0;
    replaceChildren(
      strip,
      attachments.map((url, i) =>
        h(
          "div",
          { class: "attachment" },
          h("img", { src: url, alt: "" }),
          h(
            "button",
            {
              class: "attachment-remove",
              type: "button",
              title: "Remove",
              "aria-label": "Remove image",
              onclick: () =>
                setAttachments(attachments.filter((_, j) => j !== i)),
            },
            icon("close"),
          ),
        ),
      ),
    );
    updateButton(store.state);
  };
  const setAttachments = (next: string[]) => {
    attachments = next;
    paintAttachments();
  };

  let composing = false;
  textarea.addEventListener("compositionstart", () => (composing = true));
  textarea.addEventListener("compositionend", () => (composing = false));
  textarea.addEventListener("input", () => {
    resize();
    updateButton(store.state);
  });
  textarea.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    e.preventDefault();
    void actions.attachImages(files);
  });

  const submit = () => {
    const text = textarea.value;
    if (!text.trim() && attachments.length === 0) return;
    if (!actions.canSend()) {
      if (store.isStreaming(store.state.currentId)) return;
      actions.togglePicker(true);
      return;
    }
    const images = attachments;
    textarea.value = "";
    setAttachments([]);
    resize();
    void actions.send(text, images);
  };

  textarea.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      if (composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      if (store.isStreaming(store.state.currentId)) void actions.cancel();
      else if (store.state.editing) actions.cancelEdit();
      else if (store.state.pickerOpen) actions.togglePicker(false);
    }
  });

  button.addEventListener("click", () => {
    if (store.isStreaming(store.state.currentId)) void actions.cancel();
    else submit();
  });

  const updateButton = (s: State) => {
    const streaming = store.isStreaming(s.currentId);
    button.replaceChildren(icon(streaming ? "stop" : "arrowUp"));
    button.classList.toggle("stop", streaming);
    button.setAttribute("aria-label", streaming ? "Stop" : "Send");
    button.disabled =
      !streaming && !textarea.value.trim() && attachments.length === 0;
  };

  let lastSession: string | null | undefined;
  const render = (s: State) => {
    editBar.hidden = !s.editing;
    root.classList.toggle("editing", s.editing);
    const model = actions.currentModel();
    textarea.placeholder = model?.model
      ? `Message ${model.model}`
      : s.providers.length
        ? "Choose a model"
        : "Message";
    updateButton(s);
    if (s.currentId !== lastSession) {
      lastSession = s.currentId;
      if (!s.editing) {
        textarea.value = "";
        setAttachments([]);
        resize();
      }
      if (s.view === "chat") requestAnimationFrame(() => textarea.focus());
    }
  };

  actions.registerComposer({
    seed: (text, images) => {
      textarea.value = text;
      setAttachments(images);
      resize();
      textarea.focus();
      textarea.setSelectionRange(text.length, text.length);
    },
    attach: (images) => {
      setAttachments([...attachments, ...images]);
      textarea.focus();
    },
    type: (text) => {
      textarea.value = text;
      resize();
      updateButton(store.state);
    },
    submit,
  });

  store.subscribe(render);
  render(store.state);
  requestAnimationFrame(resize);
  return root;
}
