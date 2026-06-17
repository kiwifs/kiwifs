import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { HexColorPicker } from "react-colorful";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { applyKiwiTheme, type KiwiThemeOverrides, type KiwiTokens } from "../lib/kiwiTheme";
import { getCustomTheme, setCustomTheme } from "../hooks/useTheme";
import { api } from "../lib/api";
import {
  builtinPresets,
  findPreset,
  mergeThemePresets,
  presetToOverrides,
  type ThemePreset,
  type ThemePresetLoadError,
} from "../themes";

interface TokenGroup {
  label: string;
  tokens: { key: keyof KiwiTokens; label: string }[];
}

interface TextTokenGroup {
  label: string;
  tokens: { key: string; label: string; placeholder: string }[];
}

const TOKEN_GROUPS: TokenGroup[] = [
  {
    label: "Brand / Primary",
    tokens: [
      { key: "primary", label: "Primary" },
      { key: "primary-foreground", label: "Primary text" },
      { key: "primary-hover", label: "Primary hover" },
    ],
  },
  {
    label: "Secondary",
    tokens: [
      { key: "secondary", label: "Secondary" },
      { key: "secondary-foreground", label: "Secondary text" },
      { key: "secondary-hover", label: "Secondary hover" },
    ],
  },
  {
    label: "Backgrounds",
    tokens: [
      { key: "background", label: "Background" },
      { key: "card", label: "Card" },
      { key: "popover", label: "Popover" },
      { key: "muted", label: "Muted" },
    ],
  },
  {
    label: "Text",
    tokens: [
      { key: "foreground", label: "Foreground" },
      { key: "card-foreground", label: "Card text" },
      { key: "popover-foreground", label: "Popover text" },
      { key: "muted-foreground", label: "Muted text" },
    ],
  },
  {
    label: "Borders & Accents",
    tokens: [
      { key: "border", label: "Border" },
      { key: "input", label: "Input border" },
      { key: "ring", label: "Ring" },
      { key: "accent", label: "Accent" },
      { key: "accent-foreground", label: "Accent text" },
    ],
  },
  {
    label: "Destructive",
    tokens: [
      { key: "destructive", label: "Destructive" },
      { key: "destructive-foreground", label: "Destructive text" },
    ],
  },
  {
    label: "Code Blocks",
    tokens: [
      { key: "code-bg", label: "Code background" },
      { key: "code-border", label: "Code border" },
    ],
  },
];

const TEXT_TOKEN_GROUPS: TextTokenGroup[] = [
  {
    label: "Typography",
    tokens: [
      { key: "font-sans", label: "Sans font", placeholder: "ui-sans-serif, system-ui, sans-serif" },
      { key: "font-mono", label: "Mono font", placeholder: "ui-monospace, monospace" },
      { key: "font-serif", label: "Serif font", placeholder: "ui-serif, Georgia, serif" },
      { key: "font-size-base", label: "Base size", placeholder: "1rem" },
      { key: "font-size-sm", label: "Small size", placeholder: "0.875rem" },
      { key: "font-size-lg", label: "Large size", placeholder: "1.125rem" },
      { key: "line-height-base", label: "Line height", placeholder: "1.75" },
      { key: "line-height-tight", label: "Tight line height", placeholder: "1.3" },
    ],
  },
  {
    label: "Spacing & Layout",
    tokens: [
      { key: "spacing-unit", label: "Spacing unit", placeholder: "8px" },
      { key: "content-max-width", label: "Content width", placeholder: "48rem" },
      { key: "sidebar-width", label: "Sidebar width", placeholder: "288px" },
      { key: "radius", label: "Border radius", placeholder: "0.625rem" },
    ],
  },
  {
    label: "Headings",
    tokens: [
      { key: "heading-scale", label: "Scale multiplier", placeholder: "1" },
      { key: "heading-1-size", label: "H1 size", placeholder: "1.875rem" },
      { key: "heading-2-size", label: "H2 size", placeholder: "1.5rem" },
      { key: "heading-3-size", label: "H3 size", placeholder: "1.25rem" },
      { key: "heading-4-size", label: "H4 size", placeholder: "1.125rem" },
    ],
  },
  {
    label: "Code",
    tokens: [
      { key: "code-font-size", label: "Code font size", placeholder: "0.875em" },
    ],
  },
  {
    label: "Links",
    tokens: [
      { key: "link-color", label: "Link color", placeholder: "var(--foreground)" },
      { key: "link-decoration", label: "Decoration", placeholder: "underline" },
    ],
  },
];

function cssColorToHex(raw: string): string {
  const v = raw.trim();
  if (!v) return "#888888";

  // #rrggbb
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  // #rgb → #rrggbb
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  // #rrggbbaa → take first 7 chars
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7);

  // rgb(r, g, b) or rgb(r g b) — browsers often resolve hsl/hex to this
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgbMatch) {
    const toHex = (n: string) => Math.round(parseFloat(n)).toString(16).padStart(2, "0");
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }

  // hsl(h, s%, l%) or hsl(h s% l%) or bare "h s% l%"
  let inner = v;
  const hslMatch = v.match(/^hsla?\(\s*(.+?)\s*\)?$/i);
  if (hslMatch) inner = hslMatch[1];

  const parts = inner.replace(/,/g, " ").replace(/%/g, "").split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    if (!isNaN(h) && !isNaN(s) && !isNaN(l)) {
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, "0");
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }
  }

  // oklch / color() — use a canvas to resolve any valid CSS color
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000000";
      ctx.fillStyle = v;
      const resolved = ctx.fillStyle;
      if (resolved !== "#000000" || v === "#000000" || v.toLowerCase() === "black") {
        // ctx.fillStyle normalizes to #rrggbb or rgb()
        if (/^#[0-9a-fA-F]{6}$/.test(resolved)) return resolved;
        const m = resolved.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        if (m) {
          const hex = (n: string) => Math.round(parseFloat(n)).toString(16).padStart(2, "0");
          return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
        }
      }
    }
  } catch {}

  return "#888888";
}

// Keep old name as alias for backward compat within this file
const hslToHex = cssColorToHex;

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function getCurrentTokens(): KiwiTokens {
  // When running inside the cloud app, CSS overrides target .kiwi-workspace-scope
  // instead of :root, so read computed values from that element.
  const scopeEl = document.querySelector(".kiwi-workspace-scope");
  const style = getComputedStyle(scopeEl || document.documentElement);
  const tokens: KiwiTokens = {};
  const allTokenKeys: string[] = [];
  for (const group of TOKEN_GROUPS) {
    for (const t of group.tokens) allTokenKeys.push(t.key as string);
  }
  for (const group of TEXT_TOKEN_GROUPS) {
    for (const t of group.tokens) allTokenKeys.push(t.key);
  }
  for (const key of allTokenKeys) {
    const val = style.getPropertyValue(`--${key}`).trim();
    if (val) tokens[key] = val;
  }
  return tokens;
}

function readTokensFromStylesheets(isDark: boolean): KiwiTokens {
  const tokens: KiwiTokens = {};
  const allTokenKeys = new Set<string>();
  for (const group of TOKEN_GROUPS) {
    for (const t of group.tokens) allTokenKeys.add(t.key as string);
  }
  for (const group of TEXT_TOKEN_GROUPS) {
    for (const t of group.tokens) allTokenKeys.add(t.key);
  }

  // Walk stylesheets and find values for the target mode
  const targetSelector = isDark ? ".dark" : ":root";
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule) {
            const sel = rule.selectorText;
            if (sel === targetSelector || (isDark && sel?.includes(".dark")) || (!isDark && sel === ":root")) {
              for (const key of allTokenKeys) {
                const val = rule.style.getPropertyValue(`--${key}`).trim();
                if (val) tokens[key] = val;
              }
            }
          }
        }
      } catch {
        // cross-origin stylesheets throw
      }
    }
  } catch {}
  return tokens;
}

interface Props {
  onClose: () => void;
  onPresetReset: () => void;
  embedded?: boolean;
  presets?: ThemePreset[];
  presetErrors?: ThemePresetLoadError[];
  activePreset?: string;
  onSelectPreset?: (name: string) => void;
}

export function KiwiThemeEditor({
  onClose,
  onPresetReset,
  embedded,
  presets: presetsProp,
  presetErrors: presetErrorsProp,
  activePreset,
  onSelectPreset,
}: Props) {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [lightTokens, setLightTokens] = useState<KiwiTokens>({});
  const [darkTokens, setDarkTokens] = useState<KiwiTokens>({});
  const [availablePresets, setAvailablePresets] = useState<ThemePreset[]>(presetsProp || builtinPresets);
  const [presetErrors, setPresetErrors] = useState<ThemePresetLoadError[]>(presetErrorsProp || []);
  const [selectedPreset, setSelectedPreset] = useState(activePreset || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (presetsProp) {
      setAvailablePresets(presetsProp);
    }
  }, [presetsProp]);

  useEffect(() => {
    if (presetErrorsProp) {
      setPresetErrors(presetErrorsProp);
    }
  }, [presetErrorsProp]);

  useEffect(() => {
    if (activePreset) {
      setSelectedPreset(activePreset);
    }
  }, [activePreset]);

  useEffect(() => {
    if (presetsProp) return;
    api.getThemePresets().then((res) => {
      setAvailablePresets(
        mergeThemePresets(res.presets, res.allowed ? res.builtin : undefined),
      );
      setPresetErrors(res.errors || []);
    }).catch(() => {
      setAvailablePresets(builtinPresets);
      setPresetErrors([]);
    });
  }, [presetsProp]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const existing = getCustomTheme();
    if (existing) {
      setLightTokens(existing.light || {});
      setDarkTokens(existing.dark || {});
    } else {
      // Read current mode from computed styles (most accurate)
      const current = getCurrentTokens();
      // Read the opposite mode from stylesheets (since it's not applied to DOM)
      const opposite = readTokensFromStylesheets(!isDark);

      if (isDark) {
        setDarkTokens(current);
        if (Object.keys(opposite).length > 0) setLightTokens(opposite);
      } else {
        setLightTokens(current);
        if (Object.keys(opposite).length > 0) setDarkTokens(opposite);
      }
    }
  }, [isDark]);

  const activeTokens = isDark ? darkTokens : lightTokens;
  const setActiveTokens = isDark ? setDarkTokens : setLightTokens;

  const updateToken = useCallback(
    (key: string, hex: string) => {
      const hsl = hexToHsl(hex);
      setActiveTokens((prev) => {
        const next = { ...prev, [key]: hsl };
        const overrides: KiwiThemeOverrides = isDark
          ? { light: lightTokens, dark: next }
          : { light: next, dark: darkTokens };
        applyKiwiTheme(overrides);
        return next;
      });
    },
    [isDark, lightTokens, darkTokens, setActiveTokens],
  );

  const updateTextToken = useCallback(
    (key: string, value: string) => {
      setActiveTokens((prev) => {
        const next = { ...prev, [key]: value || undefined };
        if (!value) delete next[key];
        const overrides: KiwiThemeOverrides = isDark
          ? { light: lightTokens, dark: next }
          : { light: next, dark: darkTokens };
        applyKiwiTheme(overrides);
        return next;
      });
    },
    [isDark, lightTokens, darkTokens, setActiveTokens],
  );

  const save = useCallback(() => {
    const overrides: KiwiThemeOverrides = { light: lightTokens, dark: darkTokens };
    setCustomTheme(overrides);
    applyKiwiTheme(overrides);
    api.putTheme(overrides as unknown as Record<string, unknown>).catch(() => {});
  }, [lightTokens, darkTokens]);

  const handleExport = useCallback(() => {
    const overrides = { light: lightTokens, dark: darkTokens };
    const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kiwifs-theme.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [lightTokens, darkTokens]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as KiwiThemeOverrides;
          if (data.light) setLightTokens(data.light);
          if (data.dark) setDarkTokens(data.dark);
          applyKiwiTheme(data);
          setCustomTheme(data);
        } catch {
          /* ignore invalid */
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [],
  );

  const handleReset = useCallback(() => {
    setCustomTheme(null);
    onPresetReset();
    onClose();
  }, [onPresetReset, onClose]);

  const handlePresetSelect = useCallback(
    (name: string) => {
      setSelectedPreset(name);
      setCustomTheme(null);
      const found = findPreset(name, availablePresets);
      if (!found) return;
      setLightTokens(found.light);
      setDarkTokens(found.dark);
      applyKiwiTheme(presetToOverrides(found));
      onSelectPreset?.(name);
    },
    [availablePresets, onSelectPreset],
  );

  return (
    <div className="h-full flex flex-col">
      {!embedded && (
        <header className="flex items-center gap-2 px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold flex-1">Theme Editor</h2>
          <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-muted">
            {isDark ? "Dark" : "Light"} mode
          </span>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
      )}

      <div className={`flex-1 overflow-auto ${embedded ? "p-0 pt-2" : "p-4 sm:p-6"} space-y-6 kiwi-scroll`}>
        <div className="space-y-2">
          <Label className="text-sm">Preset</Label>
          <Select value={selectedPreset} onValueChange={handlePresetSelect}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue placeholder="Choose a preset" />
            </SelectTrigger>
            <SelectContent>
              {availablePresets.map((p) => (
                <SelectItem key={p.id} value={p.name}>
                  {p.name}
                  {p.source === "workspace" ? " (workspace)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {presetErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-1">
              {presetErrors.map((err) => (
                <div key={err.file}>
                  <span className="font-mono">{err.file}</span>: {err.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {TOKEN_GROUPS.map((group) => (
          <div key={group.label}>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {group.tokens.map((t) => {
                const val = activeTokens[t.key as string] || "";
                const hex = val ? hslToHex(val) : "#888888";
                return (
                  <Popover key={t.key as string}>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-2 group cursor-pointer rounded-md px-1.5 py-1 -mx-1.5 hover:bg-accent transition-colors">
                        <span
                          className="h-7 w-7 rounded-md border border-border shrink-0 shadow-sm"
                          style={{ background: hex }}
                        />
                        <div className="text-left">
                          <Label className="text-xs cursor-pointer">{t.label}</Label>
                          <div className="text-[10px] text-muted-foreground font-mono">{hex}</div>
                        </div>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="start" className="w-auto p-3">
                      <HexColorPicker
                        color={hex}
                        onChange={(c) => updateToken(t.key as string, c)}
                      />
                      <input
                        type="text"
                        value={hex}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^#[0-9a-fA-F]{6}$/.test(v)) updateToken(t.key as string, v);
                        }}
                        className="mt-2 w-full text-xs font-mono px-2 py-1 rounded border border-border bg-background text-foreground"
                      />
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          </div>
        ))}

        <div className="h-px bg-border" />

        {TEXT_TOKEN_GROUPS.map((group) => (
          <div key={group.label}>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {group.tokens.map((t) => (
                <div key={t.key}>
                  <Label className="text-xs">{t.label}</Label>
                  <Input
                    value={activeTokens[t.key] || ""}
                    onChange={(e) => updateTextToken(t.key, e.target.value)}
                    placeholder={t.placeholder}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <footer className={`flex flex-wrap items-center gap-2 ${embedded ? "px-0 py-4" : "px-4 sm:px-6 py-3 border-t border-border"} shrink-0`}>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Reset
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </footer>
    </div>
  );
}
