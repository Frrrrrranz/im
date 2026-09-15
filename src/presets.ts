// Provider presets and protocol facts shared by Settings and the add-provider menu.

import type { Protocol, Provider } from "./types";

export interface Preset extends Provider {
  hint?: string;
}

export const PRESETS: Preset[] = [
  { id: "openai", name: "OpenAI", protocol: "responses", base_url: "https://api.openai.com/v1", models: [] },
  { id: "anthropic", name: "Anthropic", protocol: "anthropic", base_url: "https://api.anthropic.com/v1", models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"] },
  { id: "openrouter", name: "OpenRouter", protocol: "chat", base_url: "https://openrouter.ai/api/v1", models: [] },
  { id: "deepseek", name: "DeepSeek", protocol: "chat", base_url: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "ollama", name: "Ollama", protocol: "chat", base_url: "http://localhost:11434/v1", models: [], hint: "No key needed" },
  { id: "custom", name: "Custom", protocol: "chat", base_url: "", models: [] },
];

export const PROTOCOLS: { value: Protocol; label: string; path: string }[] = [
  { value: "chat", label: "Chat Completions", path: "/chat/completions" },
  { value: "anthropic", label: "Anthropic Messages", path: "/messages" },
  { value: "responses", label: "OpenAI Responses", path: "/responses" },
];
