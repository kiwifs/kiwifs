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
 *
 * Instead of inline `data`, a block may carry a `query:` holding DQL. The
 * rows come back from /api/kiwi/query, the x axis is the first non-numeric
 * column and every remaining numeric column becomes a series:
 *
 * ```kiwi-chart
 * type: bar
 * query: |
 *   TABLE title, priority FROM "datasets" SORT priority DESC
 * ```
 *
 * Parsing and row-shaping live in ../lib/chartBlock so they can be tested
 * without a React render harness.
 */

import React, { useEffect, useMemo, useState } from "react";
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

import { api } from "../lib/api";
import type { QueryResponse } from "../lib/api";
import {
  DEFAULT_COLORS,
  inferSeries,
  parseChartConfig,
  queryRowsToChartData,
} from "../lib/chartBlock";
import type { ChartConfig, SeriesConfig } from "../lib/chartBlock";

// ── Chart Component ──────────────────────────────────────────────────────────

export function KiwiChart({ source }: { source: string }) {
  const { config, error: parseError } = useMemo(() => {
    try {
      const cfg = parseChartConfig(source);
      // A query supplies the data, so an empty inline `data` is only an
      // error for blocks that have no query.
      if (!cfg.query && (!cfg.data || !Array.isArray(cfg.data) || cfg.data.length === 0)) {
        return { config: null, error: "No data provided or data is not an array" };
      }
      return { config: cfg, error: null };
    } catch (e) {
      return { config: null, error: e instanceof Error ? e.message : "Failed to parse chart config" };
    }
  }, [source]);

  const dql = config?.query;
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    if (!dql) {
      setResult(null);
      setQueryError(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    setQueryError(null);
    api
      .query(dql)
      .then((resp) => {
        if (!cancelled) setResult(resp);
      })
      .catch((e) => {
        if (!cancelled) setQueryError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [dql]);

  // Resolve the rows the chart actually renders. Inline `data` stays the
  // fallback so a block that carries both keeps working offline.
  const resolved = useMemo(() => {
    if (!config) return null;
    if (!config.query) {
      return { data: config.data, xKey: config.xKey, series: inferSeries(config) };
    }
    if (!result) return null;
    return queryRowsToChartData(result.rows, result.columns, config);
  }, [config, result]);

  const error = parseError ?? queryError;
  if (error || !config) {
    return (
      <div className="kiwi-chart-error rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <strong>Chart Error:</strong> {error}
      </div>
    );
  }

  const chartHeight = config.height || 300;

  if (!resolved) {
    return (
      <div className="kiwi-chart-loading text-muted-foreground text-sm" style={{ minHeight: chartHeight }}>
        Loading chart…
      </div>
    );
  }

  if (resolved.data.length === 0) {
    return (
      <div className="kiwi-chart-empty rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        No rows matched this query.
      </div>
    );
  }

  const chartConfig: ChartConfig = { ...config, data: resolved.data, xKey: resolved.xKey };

  return (
    <figure className="kiwi-chart not-prose my-4">
      {config.title && (
        <figcaption className="mb-2 text-sm font-medium text-foreground">
          {config.title}
        </figcaption>
      )}
      <div className="rounded-md border border-border bg-card p-4">
        <ResponsiveContainer width="100%" height={chartHeight}>
          {renderChart(chartConfig, resolved.series)}
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
