// Message content is a string until a message carries images; then it is a
// list of parts (src-tauri/src/model.rs `Content`). These read either shape.

import type { Content, Part } from "./types";

/** The text of a message (image parts contribute nothing). */
export function textOf(c: Content): string {
  if (typeof c === "string") return c;
  return c
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** The image `data:` URLs of a message, in order. */
export function imagesOf(c: Content): string[] {
  if (typeof c === "string") return [];
  return c
    .filter(
      (p): p is Extract<Part, { type: "image_url" }> => p.type === "image_url",
    )
    .map((p) => p.image_url.url);
}

/** Text plus images as the backend would store them; a plain string when there are none. */
export function contentWith(text: string, images: string[]): Content {
  if (images.length === 0) return text;
  const parts: Part[] = text ? [{ type: "text", text }] : [];
  for (const url of images)
    parts.push({ type: "image_url", image_url: { url } });
  return parts;
}
