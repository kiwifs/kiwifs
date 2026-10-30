import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Kiwifs serves the built UI from ./dist via go:embed. The Go server handles
// /api/* and /health; the dev server proxies those during `npm run dev`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Distinct from host apps (e.g. cloud frontend) that use `@/*` → their own `./src`.
      "@kw": path.resolve(__dirname, "src"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333",
      "/health": "http://localhost:3333",
    },
  },
  test: {
    // Vitest blanks CSS by default, `?raw` included; the kiwi-app kit is
    // injected as text and its tests read it.
    css: { include: [/kiwiApp\/kit\.css/] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
