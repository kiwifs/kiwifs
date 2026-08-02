import React from "react";
import type { Preview } from "@storybook/react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import "../src/index.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Toggle light / dark mode",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    layout: "fullscreen",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || "light";

      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.style.colorScheme = theme;
      document.body.style.backgroundColor =
        theme === "dark" ? "hsl(0 0% 5%)" : "hsl(0 0% 100%)";

      return (
        <TooltipProvider delayDuration={200}>
          <Story />
        </TooltipProvider>
      );
    },
  ],
};

export default preview;
