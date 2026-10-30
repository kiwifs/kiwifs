import { addons } from "storybook/manager-api";
import { create } from "storybook/theming";

addons.setConfig({
  theme: create({
    base: "dark",
    brandTitle: "KiwiFS",
    brandUrl: "https://kiwifs.com",
    brandImage: "kiwifs.png",
    brandTarget: "_blank",
    colorPrimary: "hsl(65 80% 55%)",
    colorSecondary: "hsl(65 80% 45%)",
    appBg: "hsl(0 0% 8%)",
    appContentBg: "hsl(0 0% 5%)",
    appPreviewBg: "hsl(0 0% 100%)",
    appBorderColor: "hsl(0 0% 18%)",
    barBg: "hsl(0 0% 8%)",
    barSelectedColor: "hsl(65 80% 55%)",
    textColor: "hsl(0 0% 92%)",
    textMutedColor: "hsl(0 0% 60%)",
    fontBase: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    fontCode: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
  }),
});
