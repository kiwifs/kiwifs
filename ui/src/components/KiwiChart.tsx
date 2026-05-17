/**
 * KiwiChart — Data visualization component for fenced code blocks.
 *
 * Renders charts from YAML or JSON config inside ```kiwi-chart blocks.
 * Uses Recharts for the actual rendering. Supports: bar, line, area, pie,
 * radar, and scatter chart types.
 *
 * Config format (YAML or JSON):
 * ```kiwi-chart
 * type: bar
 * title: Monthly Revenue
 * data:
 *   - month: Jan
 *     revenue: 4000
 *   - month: Feb
 *     revenue: 3000
 * xKey: month
 * series:
 *   - key: revenue
 *     color: "#3b82f6"
 * legend: true
 * grid: true
 * ```
 */

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface SeriesConfig {
  key: string;
  color?: string;
  name?: string;
  stackId?: string;
}

interface ChartConfig {
  type: "bar" | "line" | "area" | "pie" | "radar" | "scatter";
  title?: string;
  data: Record<string, unknown>[];
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

const DEFAULT_COLORS = [
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

function parseYaml(source: string): unknown {
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

      if (value === "" || value === "|" || value === ">") {
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
        result[key] = value === "" ? null : value;
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

function parseChartConfig(source: string): ChartConfig {
  const trimmed = source.trim();

  // Try JSON first
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as ChartConfig;
  }

  // Parse as YAML
  const parsed = parseYaml(trimmed) as Record<string, unknown>;

  return {
    type: (parsed.type as ChartConfig["type"]) || "bar",
    title: parsed.title as string | undefined,
    data: (parsed.data as Record<string, unknown>[]) || [],
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

// ── Infer series from data if not specified ──────────────────────────────────

function inferSeries(config: ChartConfig): SeriesConfig[] {
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

// ── Chart Component ──────────────────────────────────────────────────────────

export function KiwiChart({ source }: { source: string }) {
  const { config, error } = useMemo(() => {
    try {
      const cfg = parseChartConfig(source);
      if (!cfg.data || !Array.isArray(cfg.data) || cfg.data.length === 0) {
        return { config: null, error: "No data provided or data is not an array" };
      }
      return { config: cfg, error: null };
    } catch (e) {
      return { config: null, error: e instanceof Error ? e.message : "Failed to parse chart config" };
    }
  }, [source]);

  if (error || !config) {
    return (
      <div className="kiwi-chart-error rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <strong>Chart Error:</strong> {error}
      </div>
    );
  }

  const series = inferSeries(config);
  const chartHeight = config.height || 300;

  return (
    <figure className="kiwi-chart not-prose my-4">
      {config.title && (
        <figcaption className="mb-2 text-sm font-medium text-foreground">
          {config.title}
        </figcaption>
      )}
      <div className="rounded-md border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={chartHeight}>
          {renderChart(config, series)}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

// ── Chart type renderers ─────────────────────────────────────────────────────

function renderChart(config: ChartConfig, series: SeriesConfig[]): React.ReactElement {
  const { type, data, xKey, grid, legend, stacked } = config;

  switch (type) {
    case "bar":
      return (
        <BarChart data={data}>
          {grid && <CartesianGrid strokeDasharray="3 3" className="opacity-30" />}
          {xKey && <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />}
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name || s.key}
              fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              stackId={stacked ? "stack" : s.stackId}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      );

    case "line":
      return (
        <LineChart data={data}>
          {grid && <CartesianGrid strokeDasharray="3 3" className="opacity-30" />}
          {xKey && <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />}
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name || s.key}
              stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      );

    case "area":
      return (
        <AreaChart data={data}>
          {grid && <CartesianGrid strokeDasharray="3 3" className="opacity-30" />}
          {xKey && <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />}
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => {
            const color = s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name || s.key}
                stroke={color}
                fill={color}
                fillOpacity={0.2}
                strokeWidth={2}
                stackId={stacked ? "stack" : s.stackId}
              />
            );
          })}
        </AreaChart>
      );

    case "pie": {
      const nameKey = xKey || (data[0] ? Object.keys(data[0]).find((k) => typeof data[0][k] === "string") : undefined);
      const valueKey = series[0]?.key || (data[0] ? Object.keys(data[0]).find((k) => typeof data[0][k] === "number") : undefined);
      const colors = config.colors || DEFAULT_COLORS;

      return (
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey || "value"}
            nameKey={nameKey || "name"}
            cx="50%"
            cy="50%"
            outerRadius="70%"
            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            labelLine
          >
            {data.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </PieChart>
      );
    }

    case "radar": {
      const angleKey = xKey || (data[0] ? Object.keys(data[0]).find((k) => typeof data[0][k] === "string") : undefined);
      return (
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid />
          <PolarAngleAxis dataKey={angleKey} tick={{ fontSize: 11 }} />
          <PolarRadiusAxis tick={{ fontSize: 10 }} />
          {series.map((s, i) => (
            <Radar
              key={s.key}
              name={s.name || s.key}
              dataKey={s.key}
              stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              fillOpacity={0.2}
            />
          ))}
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </RadarChart>
      );
    }

    case "scatter":
      return (
        <ScatterChart>
          {grid && <CartesianGrid strokeDasharray="3 3" className="opacity-30" />}
          <XAxis dataKey={xKey || "x"} type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey={config.yKey || series[0]?.key || "y"} type="number" tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ strokeDasharray: "3 3" }} />
          {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Scatter
              key={s.key}
              name={s.name || s.key}
              data={data}
              fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
            />
          ))}
        </ScatterChart>
      );

    default:
      return (
        <BarChart data={data}>
          {grid && <CartesianGrid strokeDasharray="3 3" />}
          {xKey && <XAxis dataKey={xKey} />}
          <YAxis />
          <Tooltip />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
          ))}
        </BarChart>
      );
  }
}
