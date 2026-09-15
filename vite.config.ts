import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari17",
    sourcemap: false,
    // Two pages: the app, and the quick-input panel's window.
    rollupOptions: {
      input: { main: page("index.html"), quick: page("quick.html") },
    },
  },
});
