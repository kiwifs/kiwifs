import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * In dev mode Vite always serves index.html for SPA fallback.
 * This plugin rewrites HTML page requests to demo.html instead,
 * while leaving Vite internals (/@*, /node_modules/*, /src/*) alone.
 */
function demoHtmlPlugin(): Plugin {
  return {
    name: "demo-html-entry",
    configureServer(server) {
      return () => {
        server.middlewares.use((req, _res, next) => {
          const url = req.url ?? "/";
          const accept = req.headers.accept ?? "";
          if (
            accept.includes("text/html") &&
            !url.startsWith("/@") &&
            !url.startsWith("/src/") &&
            !url.startsWith("/node_modules/")
          ) {
            req.url = "/demo.html";
          }
          next();
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [demoHtmlPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@kw": path.resolve(__dirname, "src"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "demo-static",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "demo.html"),
      },
    },
  },
});
