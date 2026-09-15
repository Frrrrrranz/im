// One vocabulary for "what this call cost", shared by the transcript's hover
// line and context menu and by the inspector: model · cached/input in ·
// output out · ttft · total, then anything abnormal about how it ended.

import { formatDuration, formatTokens } from "./dom";
import type { Message } from "./types";

export interface MetaOptions {
  /** Lead with the model name (omitted where it is already on screen). */
  model?: boolean;
  /** Mention reasoning time (the transcript shows it on the reasoning block instead). */
  reasoning?: boolean;
}

export function turnMeta(m: Message, opts: MetaOptions = {}): string {
  const meta = m.meta;
  if (!meta) return "";
  const parts: string[] = [];
  if (opts.model) parts.push(meta.model);
  const u = meta.usage;
  if (u?.input_tokens !== undefined) {
    parts.push(u.cached_input_tokens !== undefined ? `${formatTokens(u.cached_input_tokens)}/${formatTokens(u.input_tokens)} in` : `${formatTokens(u.input_tokens)} in`);
  }
  if (u?.output_tokens !== undefined) parts.push(`${formatTokens(u.output_tokens)} out`);
  if (meta.ttft_ms !== undefined) parts.push(`ttft ${formatDuration(meta.ttft_ms)}`);
  if (meta.latency_ms !== undefined) parts.push(formatDuration(meta.latency_ms));
  if (opts.reasoning && m.reasoning_content) parts.push(meta.thinking_ms ? `thought ${formatDuration(meta.thinking_ms)}` : "reasoning");
  if (meta.finish_reason === "cancelled") parts.push("stopped");
  else if (meta.finish_reason === "length" || meta.finish_reason === "max_tokens" || meta.finish_reason === "max_output_tokens") parts.push("cut off");
  if (meta.error) parts.push("error");
  return parts.join(" · ");
}

/** Long form for tooltips: the same facts, spelled out. */
export function turnMetaTitle(m: Message): string {
  const meta = m.meta;
  if (!meta) return "";
  const u = meta.usage;
  const lines = [meta.model];
  if (u?.input_tokens !== undefined) {
    lines.push(`${u.input_tokens.toLocaleString()} input tokens${u.cached_input_tokens !== undefined ? ` (${u.cached_input_tokens.toLocaleString()} from cache)` : ""}`);
  }
  if (u?.output_tokens !== undefined) lines.push(`${u.output_tokens.toLocaleString()} output tokens${u.reasoning_tokens ? ` (${u.reasoning_tokens.toLocaleString()} reasoning)` : ""}`);
  if (meta.ttft_ms !== undefined) lines.push(`${formatDuration(meta.ttft_ms)} to first token`);
  if (meta.latency_ms !== undefined) lines.push(`${formatDuration(meta.latency_ms)} total`);
  if (meta.finish_reason) lines.push(`finish_reason: ${meta.finish_reason}`);
  return lines.join("\n");
}
