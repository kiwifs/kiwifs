import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const externalDeps = [
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.dependencies ?? {}),
];

// Match both bare imports ("react") and deep imports ("react/jsx-runtime")
const externalRe = new RegExp(
  `^(${externalDeps.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(/|$)`,
);

export default defineConfig({
  plugins: [react({ jsxRuntime: "automatic" })],
  resolve: {
    alias: {
      "@kw": path.resolve(__dirname, "src"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  publicDir: false,
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    outDir: "dist-lib",
    emptyOutDir: true,
    sourcemap: true,
    copyPublicDir: false,
    rollupOptions: {
      external: (id) => externalRe.test(id),
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
      },
    },
  },
});
