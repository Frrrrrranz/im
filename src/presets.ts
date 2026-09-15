// Protocol facts shared by Settings (the popup) and the endpoint preview.

import type { Protocol } from "./types";

export const PROTOCOLS: { value: Protocol; label: string; path: string }[] = [
  { value: "chat", label: "Chat Completions", path: "/chat/completions" },
  { value: "anthropic", label: "Anthropic Messages", path: "/messages" },
  { value: "responses", label: "OpenAI Responses", path: "/responses" },
];
