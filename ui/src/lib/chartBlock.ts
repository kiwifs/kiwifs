/**
 * chartBlock — pure parsing and data-shaping logic for ```kiwi-chart blocks.
 *
 * Extracted from KiwiChart.tsx so it can be unit tested without a React
 * render harness, matching the kanbanBlock.ts / KiwiKanbanBlock.tsx split.
 * Nothing here imports React or Recharts.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SeriesConfig {
  key: string;
  color?: string;
  name?: string;
  stackId?: string;
}

export interface ChartConfig {
  type: "bar" | "line" | "area" | "pie" | "radar" | "scatter";
  title?: string;
  data: Record<string, unknown>[];
  /**
   * A DQL query whose result rows become the chart data. When present it
   * takes precedence over inline `data`, which stays as the offline fallback
   * (and as what renders if the query errors).
   */
  query?: string;
  xKey?: string;
  yKey?: string;
  series?: SeriesConfig[];
  legend?: boolean;
  grid?: boolean;
  height?: number;
  stacked?: boolean;
  colors?: string[];
}

// ── Default color palette ────────────────────────────────────────────────────

export const DEFAULT_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#6366f1", // indigo
];

// ── YAML Parser (lightweight, no external dependency) ────────────────────────

export function parseYaml(source: string): unknown {
  const lines = source.split("\n");
  return parseYamlLines(lines, 0, 0).value;
}

interface ParseResult {
  value: unknown;
  endIndex: number;
}

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function parseYamlLines(lines: string[], startIndex: number, baseIndent: number): ParseResult {
  const result: Record<string, unknown> = {};
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // Unexpected deeper indent

    const trimmed = line.trim();

    // Key-value pair
    const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      const value = rawValue.trim();

      // Block scalars. Multi-line DQL is the common case for `query: |`, and
      // feeding those lines back through the mapping parser would mangle any
      // clause containing a colon.
      if (value === "|" || value === ">") {
        const block = parseBlockScalar(lines, i + 1, indent);
        result[key] = value === "|" ? block.text : block.text.replace(/\s*\n\s*/g, " ").trim();
        i = block.endIndex;
        continue;
      }

      if (value === "") {
        // Check if next lines are a list or nested object
        const nextNonEmpty = findNextNonEmpty(lines, i + 1);
        if (nextNonEmpty !== -1) {
          const nextIndent = getIndent(lines[nextNonEmpty]);
          const nextTrimmed = lines[nextNonEmpty].trim();
          if (nextIndent > indent && nextTrimmed.startsWith("- ")) {
            // It's a list
            const listResult = parseYamlList(lines, nextNonEmpty, nextIndent);
            result[key] = listResult.value;
            i = listResult.endIndex;
            continue;
          } else if (nextIndent > indent) {
            // Nested object
            const nested = parseYamlLines(lines, nextNonEmpty, nextIndent);
            result[key] = nested.value;
            i = nested.endIndex;
            continue;
          }
        }
        result[key] = null;
      } else {
        result[key] = parseYamlScalar(value);
      }
      i++;
    } else if (trimmed.startsWith("- ")) {
      // We're at the start of a list at this level
      const listResult = parseYamlList(lines, i, baseIndent);
      return { value: listResult.value, endIndex: listResult.endIndex };
    } else {
      i++;
    }
  }

  return { value: result, endIndex: i };
}

/**
 * parseBlockScalar collects the indented body of a `|` / `>` block, dedented
 * by the first content line's indent so the caller gets the literal text.
 */
function parseBlockScalar(
  lines: string[],
  startIndex: number,
  parentIndent: number
): { text: string; endIndex: number } {
  const collected: string[] = [];
  let i = startIndex;
  let blockIndent = -1;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line only belongs to the block if more block content follows.
      collected.push("");
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent <= parentIndent) break;
    if (blockIndent === -1) blockIndent = indent;
    collected.push(line.slice(Math.min(blockIndent, indent)));
    i++;
  }

  // Trailing blank lines belong to whatever comes next, not to the block.
  while (collected.length > 0 && collected[collected.length - 1] === "") {
    collected.pop();
  }
  return { text: collected.join("\n"), endIndex: i };
}

function parseYamlList(lines: string[], startIndex: number, baseIndent: number): ParseResult {
  const result: unknown[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent && result.length > 0) {
      // Continuation of previous list item (nested content)
      i++;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) break;

    const itemContent = trimmed.slice(2).trim();

    // Check if it's a single-line mapping: "- key: value key2: value2"
    if (itemContent.includes(":")) {
      // It could be an inline object (- month: Jan) or start of a multi-line object
      const inlineObj: Record<string, unknown> = {};
      const firstKvMatch = itemContent.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (firstKvMatch) {
        const [, fKey, fVal] = firstKvMatch;
        inlineObj[fKey] = parseYamlScalar(fVal.trim());

        // Check for additional keys on subsequent indented lines
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          if (!nextLine.trim() || nextLine.trim().startsWith("#")) {
            j++;
            continue;
          }
          const nextIndent = getIndent(nextLine);
          if (nextIndent <= indent) break;
          const nextTrimmed = nextLine.trim();
          const nextKvMatch = nextTrimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (nextKvMatch) {
            const [, nKey, nVal] = nextKvMatch;
            inlineObj[nKey] = parseYamlScalar(nVal.trim());
          }
          j++;
        }
        result.push(inlineObj);
        i = j;
        continue;
      }
    }

    // Simple scalar list item
    result.push(parseYamlScalar(itemContent));
    i++;
  }

  return { value: result, endIndex: i };
}

function findNextNonEmpty(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].trim() && !lines[i].trim().startsWith("#")) return i;
  }
  return -1;
}

function parseYamlScalar(value: string): unknown {
  if (value === "true" || value === "True") return true;
  if (value === "false" || value === "False") return false;
  if (value === "null" || value === "~" || value === "") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Inline array: [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => parseYamlScalar(s.trim()));
  }
  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ── Config parser ────────────────────────────────────────────────────────────

export function parseChartConfig(source: string): ChartConfig {
  const trimmed = source.trim();

  // Try JSON first
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as ChartConfig;
  }

  // Parse as YAML
  const parsed = parseYaml(trimmed) as Record<string, unknown>;

  const query = typeof parsed.query === "string" ? parsed.query.trim() : undefined;

  return {
    type: (parsed.type as ChartConfig["type"]) || "bar",
    title: parsed.title as string | undefined,
    data: (parsed.data as Record<string, unknown>[]) || [],
    query: query || undefined,
    xKey: parsed.xKey as string | undefined,
    yKey: parsed.yKey as string | undefined,
    series: parsed.series as SeriesConfig[] | undefined,
    legend: parsed.legend as boolean | undefined,
    grid: parsed.grid as boolean | undefined,
    height: parsed.height as number | undefined,
    stacked: parsed.stacked as boolean | undefined,
    colors: parsed.colors as string[] | undefined,
  };
}

// ── Query result → chart data ────────────────────────────────────────────────

/**
 * ID_COLUMN is prepended to every DQL TABLE result unless the query says
 * WITHOUT ID. It is a file path, never something worth plotting, so column
 * inference skips it when any other categorical column is available.
 */
export const ID_COLUMN = "_path";

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * isNumericColumn treats a column as plottable when it has at least one
 * numeric value and no non-numeric ones. Nulls are ignored rather than
 * disqualifying — a sparse metric column is still a metric column.
 */
export function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  let sawNumber = false;
  for (const row of rows) {
    const v = row[col];
    if (v == null) continue;
    if (toNumber(v) == null) return false;
    sawNumber = true;
  }
  return sawNumber;
}

/**
 * inferChartColumns picks the x axis and the numeric series when the block
 * did not name them: the first non-numeric column becomes the x axis and
 * every remaining numeric column becomes a series.
 */
export function inferChartColumns(
  rows: Record<string, unknown>[],
  columns?: string[]
): { xKey: string | undefined; seriesKeys: string[] } {
  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (cols.length === 0) return { xKey: undefined, seriesKeys: [] };

  const numeric = new Set(cols.filter((c) => isNumericColumn(rows, c)));
  const categorical = cols.filter((c) => !numeric.has(c));

  const xKey = categorical.find((c) => c !== ID_COLUMN) ?? categorical[0] ?? cols[0];
  const seriesKeys = cols.filter((c) => c !== xKey && numeric.has(c));

  return { xKey, seriesKeys };
}

/**
 * queryRowsToChartData maps a QueryResponse into Recharts-ready rows,
 * coercing numeric strings so a value that arrives as "0.42" still plots.
 * An explicit xKey or series in the block always wins over inference.
 */
export function queryRowsToChartData(
  rows: Record<string, unknown>[],
  columns: string[] | undefined,
  config: Pick<ChartConfig, "xKey" | "series" | "colors">
): { data: Record<string, unknown>[]; xKey: string | undefined; series: SeriesConfig[] } {
  if (!rows || rows.length === 0) {
    return { data: [], xKey: config.xKey, series: config.series ?? [] };
  }

  const inferred = inferChartColumns(rows, columns);
  const xKey = config.xKey ?? inferred.xKey;

  // Re-derive series when the block named an xKey that inference did not pick,
  // otherwise the chosen x column could also show up as a plotted series.
  const seriesKeys =
    config.series && config.series.length > 0
      ? config.series.map((s) => s.key)
      : inferred.seriesKeys.filter((k) => k !== xKey);

  const series: SeriesConfig[] =
    config.series && config.series.length > 0
      ? config.series
      : seriesKeys.map((key, i) => ({
          key,
          color: config.colors?.[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        }));

  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  const numericCols = new Set(seriesKeys);

  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of cols) {
      const v = row[col];
      out[col] = numericCols.has(col) ? toNumber(v) : v;
    }
    return out;
  });

  return { data, xKey, series };
}

// ── Infer series from data if not specified ──────────────────────────────────

export function inferSeries(config: ChartConfig): SeriesConfig[] {
  if (config.series && config.series.length > 0) return config.series;

  // Auto-detect numeric keys (excluding xKey)
  const firstRow = config.data[0];
  if (!firstRow) return [];

  const numericKeys = Object.keys(firstRow).filter(
    (k) => k !== config.xKey && typeof firstRow[k] === "number"
  );

  return numericKeys.map((key, i) => ({
    key,
    color: config.colors?.[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
  }));
}
