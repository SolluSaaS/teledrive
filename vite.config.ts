import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), nodePolyfills()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Vendor chunks ────────────────────────────────────────────────
          // Split CodeMirror into its own large chunk (970KB+ raw)
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) {
            return "codemirror-vendor";
          }
          // Telegram MTProto client — large, rarely changes
          if (id.includes("node_modules/@mtcute") || id.includes("node_modules/mtcute")) {
            return "telegram-vendor";
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
    chunkSizeWarningLimit: 600,
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
