import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    // CRITICAL: protocolRoot must be set so the polyfill's Buffer class is
    // a singleton across ALL chunks. Vite's chunk-splitting creates separate
    // module instances — GramJS's internal `instanceof Buffer` check then
    // fails on Windows WebView2 because it gets a Buffer from a different
    // polyfill instance than the one it bundled. Keeping all polyfill and
    // telegram modules in the same chunk fixes this.
    nodePolyfills({
      include: ["buffer", "events", "stream", "util", "crypto", "path", "os", "process"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Protocolimports: ensure the Buffer global shim is applied first,
      // before any module that imports it. This prevents the "dual Buffer"
      // problem on Windows WebView2.
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── CRITICAL: telegram + its Buffer/polyfill deps MUST be in the same chunk ──
          // Separating "buffer" from "telegram" creates two different Buffer class
          // instances. GramJS's serializeBytes() does `instanceof Buffer` — when the
          // passwordConfig bytes come from a different chunk's Buffer, this check fails
          // with "Bytes or str expected, not Uint8Array" on Windows WebView2.
          // Solution: keep telegram AND buffer in one chunk so they share a class ref.
          if (
            id.includes("node_modules/telegram") ||
            id.includes("node_modules/node-stdlib-browser") ||
            id.includes("node_modules/buffer") ||
            id.includes("node_modules/big-integer") ||
            id.includes("node_modules/events") ||
            id.includes("vite-plugin-node-polyfills")
          ) {
            return "telegram-vendor";
          }
          // Split CodeMirror into its own large chunk (970KB+ raw)
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) {
            return "codemirror-vendor";
          }
          // React core — tiny but changes often break caching if mixed
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          // Radix UI + shadcn/ui components
          if (id.includes("node_modules/@radix-ui") || id.includes("node_modules/cmdk")) {
            return "ui-vendor";
          }
          // react-router-dom
          if (id.includes("node_modules/react-router") || id.includes("node_modules/@remix-run")) {
            return "router-vendor";
          }
          // Zustand state management
          if (id.includes("node_modules/zustand")) {
            return "state-vendor";
          }
        },
      },
    },
    // Raise the warning threshold (we already split; remaining chunks are expected large)
    chunkSizeWarningLimit: 800,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
