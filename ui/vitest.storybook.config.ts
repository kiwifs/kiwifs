import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config";

const here = path.dirname(fileURLToPath(import.meta.url));

// Every story renders in a real browser and its play function runs, so a
// broken story fails here rather than on the deployed Storybook.
export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [storybookTest({ configDir: path.join(here, ".storybook") })],
    resolve: {
      alias: {
        // Excalidraw exports its stylesheet only under the development and
        // production conditions, neither of which the story runner sets.
        "@excalidraw/excalidraw/index.css": path.join(here, "node_modules/@excalidraw/excalidraw/dist/prod/index.css"),
      },
    },
    test: {
      name: "storybook",
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
      },
      setupFiles: [".storybook/vitest.setup.ts"],
      // Showcase play functions wait up to 20s for deferred blocks; the 15s
      // default cuts them off under a full parallel run.
      testTimeout: 30_000,
    },
  }),
);
