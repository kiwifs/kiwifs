import type { Preview } from "@storybook/react";
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

      // Toggle .dark class on the document element so CSS variables switch
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.body.style.backgroundColor =
        theme === "dark" ? "hsl(0 0% 5%)" : "hsl(0 0% 100%)";

      return Story();
    },
  ],
};

export default preview;
