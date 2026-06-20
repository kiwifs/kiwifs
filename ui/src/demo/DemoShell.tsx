import { useEffect } from "react";
import App from "@kw/App";
import { MockApiProvider } from "@kw/components/__mocks__/apiMock";
import { useUIConfigStore } from "@kw/lib/uiConfigStore";
import { applyKiwiTheme, removeKiwiTheme } from "@kw/lib/kiwiTheme";
import { findPreset, presetToOverrides } from "@kw/themes";
import { DemoBanner } from "./DemoBanner";
import { demoOverrides } from "./helpers";
import type { DemoTemplateConfig } from "./types";

type DemoShellProps = {
  template: DemoTemplateConfig;
};

function applyDemoTheme(template: DemoTemplateConfig) {
  const preset = findPreset(template.themePreset);
  if (preset) {
    applyKiwiTheme(presetToOverrides(preset));
  }
  const dark = template.defaultTheme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("kiwifs-theme", dark ? "dark" : "light");
    localStorage.setItem("kiwifs-preset", template.themePreset);
    localStorage.removeItem("kiwifs-custom-theme");
  } catch {
    /* ignore */
  }
}

function DemoWorkspace({ template }: DemoShellProps) {
  useEffect(() => {
    void useUIConfigStore.getState().load();
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <DemoBanner template={template} />
      <div className="flex-1 min-h-0">
        <App />
      </div>
    </div>
  );
}

export function DemoShell({ template }: DemoShellProps) {
  window.__KIWIFS_CONFIG__ = {
    ...(window.__KIWIFS_CONFIG__ ?? {}),
    demo: {
      slug: template.slug,
      initialPath: template.initialPath,
      initialView: template.initialView,
    },
  };
  applyDemoTheme(template);

  useEffect(() => {
    return () => {
      removeKiwiTheme();
      if (window.__KIWIFS_CONFIG__?.demo?.slug === template.slug) {
        delete window.__KIWIFS_CONFIG__?.demo;
      }
    };
  }, [template]);

  const overrides = demoOverrides(template);

  return (
    <MockApiProvider overrides={overrides}>
      <DemoWorkspace template={template} />
    </MockApiProvider>
  );
}
