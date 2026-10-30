import React from "react";
import type { Decorator, Preview } from "@storybook/react-vite";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { applyKiwiTheme, removeKiwiTheme } from "../src/lib/kiwiTheme";
import { findPreset, presetToOverrides, presets } from "../src/themes";
import { resetClocks } from "../src/widgets/playbackClock";
import "../src/index.css";

type ThemeMode = "light" | "dark" | "both";

const BACKGROUND = { light: "hsl(0 0% 100%)", dark: "hsl(0 0% 5%)" };

const PALETTE_ORDER = ["kiwi", "forest", "ocean", "sunset", "neutral"];
const palettes = [...presets].sort(
  (a, b) => PALETTE_ORDER.indexOf(a.name.toLowerCase()) - PALETTE_ORDER.indexOf(b.name.toLowerCase()),
);

let appliedPalette = "kiwi";
function applyPalette(name: string) {
  if (name === appliedPalette) return;
  appliedPalette = name;
  removeKiwiTheme();
  const preset = findPreset(name);
  // kiwi is the stylesheet's own palette; applying it would only duplicate it.
  if (preset && name !== "kiwi") applyKiwiTheme(presetToOverrides(preset));
}

/**
 * Playback clocks and `#?step.<id>=N` keys are page-scoped, and to the page a
 * story switch is not a navigation. Reset both whenever the story changes, so
 * a step deep link from one story does not leak into the next.
 */
let lastStory = "";
const cleanClocks: Decorator = (Story, context) => {
  if (context.id !== lastStory) {
    lastStory = context.id;
    resetClocks();
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return <Story />;
};

const withTheme: Decorator = (Story, context) => {
  const mode = (context.globals.theme || "light") as ThemeMode;
  applyPalette(String(context.globals.palette || "kiwi"));

  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode === "dark" ? "dark" : "light";
  document.body.style.backgroundColor = mode === "dark" ? BACKGROUND.dark : BACKGROUND.light;

  if (mode !== "both") return <Story />;
  // Dark tokens are scoped to `.dark`, so a nested `.dark` themes its subtree
  // without touching <html>. Portals (tooltips, popovers) attach to <body>
  // and still show the light theme in this mode. The story mounts twice, so
  // both copies share element ids and playback clocks.
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "100vh" }}>
      <div style={{ background: BACKGROUND.light, minWidth: 0 }}>
        <Story />
      </div>
      <div className="dark" style={{ background: BACKGROUND.dark, color: "hsl(0 0% 95%)", colorScheme: "dark", minWidth: 0 }}>
        <Story />
      </div>
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Light, dark, or both side by side",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "both", title: "Side by side", icon: "sidebyside" },
        ],
        dynamicTitle: true,
      },
    },
    palette: {
      description: "Workspace palette",
      toolbar: {
        title: "Palette",
        icon: "paintbrush",
        items: palettes.map((p) => ({ value: p.name.toLowerCase(), title: p.name, right: p.description })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
    palette: "kiwi",
  },
  parameters: {
    layout: "fullscreen",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: [
          "Introduction",
          "Authoring",
          "Showcase",
          "Fences",
          "Widgets",
          "Blocks",
          "Content",
          "Pages",
          "Screens",
          "Navigation",
          "Bases",
          "Kanban",
          "Canvas",
          "Dialogs",
          "Editing",
          "Editor",
          "Feedback",
          "Host",
          "Analytics",
          "UI",
        ],
      },
    },
    viewport: {
      options: {
        phone: { name: "Phone", styles: { width: "390px", height: "844px" }, type: "mobile" },
        tablet: { name: "Tablet", styles: { width: "820px", height: "1180px" }, type: "tablet" },
        desktop: { name: "Desktop", styles: { width: "1280px", height: "800px" }, type: "desktop" },
        wide: { name: "Wide", styles: { width: "1600px", height: "900px" }, type: "desktop" },
      },
    },
    a11y: {
      // Reported in the panel and by the story tests, without failing them yet.
      test: "todo",
    },
  },
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={200}>
        <Story />
      </TooltipProvider>
    ),
    withTheme,
    cleanClocks,
  ],
};

export default preview;
