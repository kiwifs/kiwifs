import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(ts|tsx)",
  ],
  framework: "@storybook/react-vite",
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  staticDirs: ["./public"],
  viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: {
          "@kw": path.resolve(here, "../src"),
          "@": path.resolve(here, "../src"),
        },
      },
    });
  },
};

export default config;
