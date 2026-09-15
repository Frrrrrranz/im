#!/usr/bin/env node
// Open a URL in headless Chrome in *real* time and, after a delay, evaluate an
// expression or take a screenshot — for scenarios that measure something
// (`?state=select-test`) or animate (`?state=html-expanded`).
//   scripts/eval.mjs <url> <delay-ms> [expression | shot:<out.png>] [WxH]
// Unlike --virtual-time-budget, timers and animation frames run at their real
// pace here, so streaming and transitions behave as they do for a user.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, delay = "5000", expression = "document.title", size = "1100x720"] = process.argv.slice(2);
if (!url) {
  console.error("usage: scripts/eval.mjs <url> <delay-ms> [expression | shot:<out.png>] [WxH]");
  process.exit(2);
}
const [width, height] = size.split("x").map(Number);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "im-chrome-"));
const port = 9222 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--proxy-server=direct://",
  "--proxy-bypass-list=*",
  `--window-size=${width},${height}`,
  "--force-device-scale-factor=2",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
]);
const cleanup = () => {
  proc.kill("SIGKILL");
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Chrome may still be flushing its profile; the OS cleans /tmp */
  }
};
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === "page");
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.error("chrome did not come up");
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
// Page console output (console.warn/error) is echoed here, prefixed, so scenarios can report through it.
const logs = [];
const onMsg = ws.onmessage;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "warning" || m.params.type === "error")) {
    logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
  onMsg(e);
};
await send("Page.navigate", { url });
await sleep(Number(delay));
for (const l of logs) console.error(l);
if (expression.startsWith("shot:")) {
  const out = expression.slice(5);
  const res = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(res.result.data, "base64"));
  console.log(out);
} else {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  console.log(res.result?.result?.value ?? JSON.stringify(res.result ?? res));
}
ws.close();
process.exit(0);
