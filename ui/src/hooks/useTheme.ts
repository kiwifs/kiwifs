import { useCallback, useEffect, useState } from "react";
import {
  applyKiwiTheme,
  applyKiwiCustomCSS,
  removeKiwiTheme,
  type KiwiThemeOverrides,
} from "../lib/kiwiTheme";
import { api, getCurrentSpace, onSpaceChange } from "../lib/api";
import { guardedThemeAction } from "../lib/themeEditLock";
import { useUIConfigStore } from "../lib/uiConfigStore";
import { presets, presetToOverrides, findPreset } from "../themes";

export type Theme = "light" | "dark";

const LS_THEME = "kiwifs-theme";

function spaceKey(base: string): string {
  const space = getCurrentSpace();
  return space && space !== "default" ? `${base}:${space}` : base;
}

function lsPreset(): string { return spaceKey("kiwifs-preset"); }
function lsCustomTheme(): string { return spaceKey("kiwifs-custom-theme"); }

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

export function getCustomTheme(): KiwiThemeOverrides | null {
  try {
    const raw = localStorage.getItem(lsCustomTheme());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCustomTheme(t: KiwiThemeOverrides | null) {
  if (t) {
    writeLS(lsCustomTheme(), JSON.stringify(t));
  } else {
    try {
      localStorage.removeItem(lsCustomTheme());
    } catch {
      /* ignore */
    }
  }
}

// When running inside the cloud app, the cloud ThemeProvider exposes these
// globals so we delegate dark/light control to a single source of truth.
function externalThemeAPI(): {
  get: () => Theme;
  toggle: () => void;
  set: (t: Theme) => void;
} | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  if (
    typeof w.__kiwi_theme_get__ === "function" &&
    typeof w.__kiwi_theme_toggle__ === "function" &&
    typeof w.__kiwi_theme_set__ === "function"
  ) {
    return {
      get: w.__kiwi_theme_get__ as () => Theme,
      toggle: w.__kiwi_theme_toggle__ as () => void,
      set: w.__kiwi_theme_set__ as (t: Theme) => void,
    };
  }
  return null;
}

export function useTheme(): {
  theme: Theme;
  toggleTheme: () => void;
  preset: string;
  setPreset: (name: string) => void;
  presets: typeof presets;
  themeLocked: boolean;
} {
  const themeLocked = useUIConfigStore((s) => s.themeLocked);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  const [preset, setPresetState] = useState(() => readLS(lsPreset(), "Kiwi"));

  // Keep local state in sync with the DOM (handles both cloud-managed and
  // standalone scenarios — the cloud ThemeProvider changes the class,
  // and this observer picks it up).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next: Theme = document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
      setTheme((prev) => (prev !== next ? next : prev));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Standalone only: apply dark class to DOM when no external provider owns it.
  useEffect(() => {
    if (externalThemeAPI()) return;
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    writeLS(LS_THEME, theme);
    writeLS("app-theme", theme);
  }, [theme]);

  // On mount, fetch the server-side team default theme. localStorage preset
  // (per-user) overrides it — the server theme only kicks in when the user
  // hasn't picked a preset yet.
  useEffect(() => {
    const custom = getCustomTheme();
    if (custom) {
      applyKiwiTheme(custom);
      return;
    }

    const saved = readLS(lsPreset(), "");
    if (saved) return;

    api.getTheme().then((data) => {
      const name = data?.preset as string | undefined;
      if (name) {
        const found = findPreset(name);
        if (found) {
          setPresetState(name);
          applyKiwiTheme(presetToOverrides(found));
          return;
        }
      }
      if (data?.light || data?.dark) {
        applyKiwiTheme(data as KiwiThemeOverrides);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const custom = getCustomTheme();
    if (custom) {
      applyKiwiTheme(custom);
      return;
    }
    const found = findPreset(preset);
    if (found) {
      applyKiwiTheme(presetToOverrides(found));
    } else {
      removeKiwiTheme();
    }
  }, [preset]);

  // Workspace custom CSS loads after theme tokens and applies on every boot/reload.
  useEffect(() => {
    api.getCustomCSS().then(applyKiwiCustomCSS).catch(() => {});
  }, []);

  useEffect(() => {
    return onSpaceChange(() => {
      api.getCustomCSS().then(applyKiwiCustomCSS).catch(() => {});
    });
  }, []);

  useEffect(() => {
    return onSpaceChange(() => {
      const custom = getCustomTheme();
      if (custom) {
        applyKiwiTheme(custom);
        return;
      }
      const saved = readLS(lsPreset(), "");
      if (saved) {
        setPresetState(saved);
        const found = findPreset(saved);
        if (found) applyKiwiTheme(presetToOverrides(found));
        else removeKiwiTheme();
        return;
      }
      api.getTheme().then((data) => {
        const name = data?.preset as string | undefined;
        if (name) {
          const found = findPreset(name);
          if (found) {
            setPresetState(name);
            applyKiwiTheme(presetToOverrides(found));
            return;
          }
        }
        if (data?.light || data?.dark) {
          applyKiwiTheme(data as KiwiThemeOverrides);
        } else {
          removeKiwiTheme();
        }
      }).catch(() => {});
    });
  }, []);

  const toggleTheme = useCallback(() => {
    guardedThemeAction(themeLocked, () => {
      const ext = externalThemeAPI();
      if (ext) {
        ext.toggle();
      } else {
        setTheme((t) => (t === "dark" ? "light" : "dark"));
      }
    });
  }, [themeLocked]);

  const setPreset = useCallback((name: string) => {
    guardedThemeAction(themeLocked, () => {
      setCustomTheme(null);
      setPresetState(name);
      writeLS(lsPreset(), name);
      const found = findPreset(name);
      if (found) {
        api.putTheme({ preset: name, ...presetToOverrides(found) } as unknown as Record<string, unknown>).catch(() => {});
      }
    });
  }, [themeLocked]);

  return { theme, toggleTheme, preset, setPreset, presets, themeLocked };
}
