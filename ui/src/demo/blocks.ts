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
    .map((t) => `:::tab{label="${t.label}"}\n${t.body.trim()}\n:::`)
    .join("\n\n");
  return `::::tabs\n${body}\n::::`;
}

export function columns(ratio: string | null, cols: string[]): string {
  const directive = ratio ? `::::columns{ratio="${ratio}"}` : cols.length > 1 ? `::::columns{cols="${cols.length}"}` : "::::columns";
  const body = cols.map((c) => `:::col\n${c.trim()}\n:::`).join("\n\n");
  return `${directive}\n${body}\n::::`;
}

export function queryTable(dql: string): string {
  return `\`\`\`kiwi-query\n${dql}\n\`\`\``;
}

export function mermaid(source: string): string {
  return `\`\`\`mermaid\n${source.trim()}\n\`\`\``;
}

export function kiwiApp(html: string, meta = ""): string {
  const opening = meta ? `kiwi-app ${meta}` : "kiwi-app";
  return `\`\`\`${opening}\n${html.trim()}\n\`\`\``;
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

/**
 * A stepped kiwi-app written the way docs/APPS.md recommends: kit classes for
 * the look, `kiwi.steps` for the clock, so the reader gets arrow keys, the
 * transport and a `#?step.write-path=N` link without the app writing any of it.
 */
export const pipelineApp = kiwiApp(
  `<div class="k-app">
  <div class="k-eyebrow">Write path</div>
  <p class="k-lede" id="note"></p>
  <div class="k-lanes" id="lanes"></div>
  <div class="k-ctl">
    <button class="k-btn" onclick="kiwi.prev()">Back</button>
    <button class="k-btn primary" onclick="kiwi.next()">Next</button>
    <span class="k-pill info" id="where"></span>
  </div>
</div>
<script>
  var stages = ["Storage", "Git commit", "Index", "SSE broadcast"];
  var notes = [
    "The file lands on disk first. Everything after this can be rebuilt from it.",
    "A commit records who wrote it and gives the write an ETag.",
    "Search and metadata indexes catch up from the committed file.",
    "Open tabs hear about the change and refresh."
  ];
  function render(i) {
    document.getElementById("lanes").innerHTML = stages.map(function (s, j) {
      return '<div class="k-lane ' + (j < i ? '' : j === i ? 'on' : 'dead') + '"><div class="k-eyebrow">' + (j + 1) + '</div>' + s + '</div>';
    }).join("");
    document.getElementById("note").textContent = notes[i];
    document.getElementById("where").textContent = "step " + (i + 1) + " of " + stages.length;
  }
  kiwi.steps({ count: stages.length, labels: stages, onStep: render });
</script>`,
  'id=write-path controls=host caption="Every write goes through the same four stages, in order."',
);

export const eventStatApp = kiwiApp(
  `<div class="k-app">
  <div class="k-stat"><span>Events today</span><b id="v">47</b></div>
</div>
<script>
  var n = 47;
  setInterval(function () { n++; document.getElementById("v").textContent = n; }, 4000);
</script>`,
);

/**
 * A widget fence. The demo uses these to show that the fence platform is for
 * runbooks and ADRs, not only for algorithm walkthroughs — if a picture only
 * ever makes sense on a LeetCode page, it failed the genericity test.
 */
export function fence(lang: string, body: string, meta = ""): string {
  const opening = meta ? `${lang} ${meta}` : lang;
  return `\`\`\`${opening}\n${body.trim()}\n\`\`\``;
}
