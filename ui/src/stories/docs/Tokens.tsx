import { useEffect, useRef, useState, type CSSProperties } from "react";
import themeCss from "@kw/styles/kiwi-theme.css?raw";
import { presets, type ThemePreset } from "@kw/themes";

const ROOT_BLOCK = /:root\s*\{([\s\S]*?)\n\}/;
const NAMES = [...new Set([...(themeCss.match(ROOT_BLOCK)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!))];

const GROUPS: { title: string; test: (name: string) => boolean }[] = [
  { title: "Widget", test: (n) => n.startsWith("--kw-widget-") },
  { title: "Graph", test: (n) => n.startsWith("--kiwi-graph-") },
  {
    title: "Typography",
    test: (n) => /^--(font|heading|line-height|code-font-size)/.test(n),
  },
  { title: "Accent", test: (n) => /^--(primary|destructive|ring|link)/.test(n) },
  { title: "Text", test: (n) => /foreground$/.test(n) },
  { title: "Surface", test: (n) => /^--(background|card|popover|secondary|muted|accent|border|input|code-)/.test(n) },
  { title: "Other", test: () => true },
];

function grouped(): { title: string; names: string[] }[] {
  const left = new Set(NAMES);
  return GROUPS.map(({ title, test }) => {
    const names = [...left].filter(test);
    names.forEach((n) => left.delete(n));
    return { title, names };
  }).filter((g) => g.names.length > 0);
}

function isColor(value: string): boolean {
  return /^(#|rgb|hsl|oklch|oklab|lab|lch|color)/.test(value);
}

function Swatch({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (ref.current) setValue(getComputedStyle(ref.current).getPropertyValue(name).trim());
  });
  const color = isColor(value);
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <div
        style={{
          width: 28,
          height: 28,
          flex: "none",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: color ? `var(${name})` : "transparent",
        }}
      />
      <div style={{ minWidth: 0, font: "12px/1.3 var(--font-mono)" }}>
        <div style={{ color: "var(--foreground)" }}>{name}</div>
        <div style={{ color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function paletteStyle(tokens: Record<string, string> | undefined): CSSProperties {
  if (!tokens) return {};
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [`--${k.replace(/^--/, "")}`, v])) as CSSProperties;
}

/**
 * Every token declared in `kiwi-theme.css`, read from the stylesheet itself
 * so a new token shows up here without anyone touching this file.
 */
export function TokenSwatches({ mode = "light", palette }: { mode?: "light" | "dark"; palette?: string }) {
  const preset: ThemePreset | undefined = palette ? presets.find((p) => p.name.toLowerCase() === palette) : undefined;
  return (
    <div
      className={mode === "dark" ? "dark" : undefined}
      style={{
        ...paletteStyle(preset?.[mode]),
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--border)",
        margin: "12px 0 28px",
      }}
    >
      {grouped().map((group) => (
        <section key={group.title} style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px", font: "600 11px/1 var(--font-mono)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
            {group.title}
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {group.names.map((name) => (
              <Swatch key={name} name={name} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const PALETTES = presets.map((p) => ({ id: p.name.toLowerCase(), name: p.name, description: p.description }));
