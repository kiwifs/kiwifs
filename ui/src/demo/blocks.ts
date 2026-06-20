/** Parameterized markdown block builders for demo pages. */

export function chart(opts: {
  type: "bar" | "line" | "area" | "pie" | "radar";
  title: string;
  xKey: string;
  series: { key: string; name: string; color?: string }[];
  data: Record<string, string | number>[];
  grid?: boolean;
  legend?: boolean;
}): string {
  const seriesYaml = opts.series
    .map((s) => `  - key: ${s.key}\n    name: ${s.name}${s.color ? `\n    color: "${s.color}"` : ""}`)
    .join("\n");
  const rows = opts.data
    .map((row) => {
      const entries = Object.entries(row);
      const first = entries[0];
      const rest = entries.slice(1);
      const lines = [`  - ${first[0]}: ${yamlVal(first[1])}`];
      for (const [k, v] of rest) {
        lines.push(`    ${k}: ${yamlVal(v)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
  return `\`\`\`kiwi-chart
type: ${opts.type}
title: ${opts.title}
xKey: ${opts.xKey}
${opts.grid ? "grid: true" : ""}
${opts.legend ? "legend: true" : ""}
series:
${seriesYaml}
data:
${rows}
\`\`\``;
}

function yamlVal(v: string | number): string {
  if (typeof v === "number") return String(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return `"${v}"`;
  return v;
}

export function progress(opts: {
  type: "bar" | "gauge";
  title: string;
  items: { label: string; value: number; color?: string; max?: number }[];
  showPercent?: boolean;
}): string {
  const items = opts.items
    .map((i) => {
      const lines = [`  - label: ${i.label}`, `    value: ${i.value}`];
      if (i.color) lines.push(`    color: "${i.color}"`);
      if (i.max) lines.push(`    max: ${i.max}`);
      return lines.join("\n");
    })
    .join("\n");
  return `\`\`\`kiwi-progress
type: ${opts.type}
title: ${opts.title}
${opts.showPercent ? "showPercent: true" : ""}
items:
${items}
\`\`\``;
}

export function colorPalette(opts: {
  name: string;
  colors: { hex: string; label: string }[];
  showContrast?: boolean;
  size?: "small" | "medium" | "large";
}): string {
  const colors = opts.colors
    .map((c) => `  - value: "${c.hex}"\n    label: ${c.label}`)
    .join("\n");
  return `\`\`\`kiwi-color
palette: ${opts.name}
${opts.showContrast ? "showContrast: true" : ""}
${opts.size ? `swatchSize: ${opts.size}` : ""}
colors:
${colors}
\`\`\``;
}

export function tabs(items: { label: string; body: string }[]): string {
  const body = items
    .map((t) => `::tab[${t.label}]\n${t.body.trim()}`)
    .join("\n\n");
  return `:::tabs\n${body}\n:::`;
}

export function columns(ratio: string | null, cols: string[]): string {
  const directive = ratio ? `:::columns ratio="${ratio}"` : cols.length > 1 ? `:::columns cols="${cols.length}"` : ":::columns";
  const body = cols.map((c) => `:::col\n${c.trim()}`).join("\n\n");
  return `${directive}\n${body}\n:::`;
}

export function queryTable(dql: string): string {
  return `\`\`\`kiwi-query\n${dql}\n\`\`\``;
}

export function mermaid(source: string): string {
  return `\`\`\`mermaid\n${source.trim()}\n\`\`\``;
}

export function kiwiApp(height: number, html: string): string {
  return `\`\`\`kiwi-app meta="height=${height}"\n${html.trim()}\n\`\`\``;
}

export function playground(opts: {
  title: string;
  widgets: string[];
}): string {
  return `\`\`\`kiwi-playground
title: ${opts.title}
widgets:
${opts.widgets.map((w) => `  - ${w}`).join("\n")}
\`\`\``;
}

export function diff(opts: {
  language?: string;
  before: string;
  after: string;
  title?: string;
}): string {
  if (opts.title) {
    return `\`\`\`kiwi-diff
title: ${opts.title}
${opts.language ? `language: ${opts.language}` : ""}
---
${opts.before}
===
${opts.after}
\`\`\``;
  }
  return `\`\`\`kiwi-diff${opts.language ? ` meta="language=${opts.language}"` : ""}
${opts.before}
===
${opts.after}
\`\`\``;
}

export const counterApp = kiwiApp(
  220,
  `<!DOCTYPE html>
<html><head><style>
  body { font-family: system-ui; margin: 0; padding: 16px; background: var(--background,#fff); color: var(--foreground,#111); }
  .row { display: flex; gap: 8px; align-items: center; }
  button { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border,#ccc); background: var(--card,#f8f8f8); cursor: pointer; }
  .count { font-size: 2rem; font-weight: 700; min-width: 3ch; text-align: center; color: var(--primary,#84cc16); }
</style></head><body>
  <div class="row">
    <button id="dec">−</button>
    <div class="count" id="n">0</div>
    <button id="inc">+</button>
  </div>
  <script>
    let n = 0; const el = document.getElementById('n');
    document.getElementById('inc').onclick = () => { n++; el.textContent = n; };
    document.getElementById('dec').onclick = () => { n--; el.textContent = n; };
  </script>
</body></html>`,
);

export const eventCounterApp = kiwiApp(
  160,
  `<!DOCTYPE html>
<html><head><style>
  body { font-family: ui-monospace, monospace; margin: 0; padding: 12px 16px; background: var(--card); border-radius: 8px; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted-foreground); }
  .value { font-size: 28px; font-weight: 700; color: var(--primary); }
</style></head><body>
  <div class="label">Events today</div>
  <div class="value" id="v">47</div>
  <script>
    let n = 47;
    setInterval(() => { n++; document.getElementById('v').textContent = n; }, 4000);
  </script>
</body></html>`,
);
