/**
 * KiwiProgress — Progress bars and radial gauges for ```kiwi-progress blocks.
 *
 * Renders progress indicators from YAML/JSON config.
 * Supports bar (horizontal) and gauge (radial SVG) types.
 *
 * Config format:
 * ```kiwi-progress
 * type: bar
 * items:
 *   - label: Backend API
 *     value: 85
 *     color: "#22c55e"
 *   - label: Frontend
 *     value: 60
 *     color: "#f59e0b"
 * ```
 */

import { useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────────���───────

interface ProgressItem {
  label: string;
  value: number;
  max?: number;
  color?: string;
}

interface ProgressConfig {
  type: "bar" | "gauge";
  title?: string;
  items: ProgressItem[];
  showPercent?: boolean;
  animated?: boolean;
}

// ── Auto color based on value ────────────────────────────────────────────────

function autoColor(value: number, max: number): string {
  const pct = (value / max) * 100;
  if (pct >= 75) return "#22c55e"; // green
  if (pct >= 50) return "#f59e0b"; // amber
  if (pct >= 25) return "#f97316"; // orange
  return "#ef4444"; // red
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parseProgressConfig(source: string): ProgressConfig {
  const trimmed = source.trim();

  // Try JSON
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as ProgressConfig;
  }

  // Simple YAML parser
  let type: "bar" | "gauge" = "bar";
  let title: string | undefined;
  let showPercent = true;
  let animated = true;
  const items: ProgressItem[] = [];

  const lines = trimmed.split("\n");
  let inItems = false;
  let currentItem: Partial<ProgressItem> = {};

  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;

    if (l.startsWith("type:")) {
      type = l.slice(5).trim() as "bar" | "gauge";
      inItems = false;
    } else if (l.startsWith("title:")) {
      title = l.slice(6).trim().replace(/^["']|["']$/g, "");
      inItems = false;
    } else if (l.startsWith("showPercent:")) {
      showPercent = l.slice(12).trim() !== "false";
      inItems = false;
    } else if (l.startsWith("animated:")) {
      animated = l.slice(9).trim() !== "false";
      inItems = false;
    } else if (l === "items:") {
      inItems = true;
    } else if (inItems) {
      if (l.startsWith("- ")) {
        if (currentItem.label) {
          items.push({
            label: currentItem.label,
            value: currentItem.value ?? 0,
            max: currentItem.max,
            color: currentItem.color,
          });
        }
        currentItem = {};
        const inlineKv = l.slice(2).trim();
        const kvMatch = inlineKv.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) {
          setItemField(currentItem, kvMatch[1], kvMatch[2]);
        }
      } else {
        const kvMatch = l.match(/^([A-Za-z]+):\s*(.*)$/);
        if (kvMatch) {
          setItemField(currentItem, kvMatch[1], kvMatch[2]);
        }
      }
    }
  }
  // Flush last
  if (currentItem.label) {
    items.push({
      label: currentItem.label,
      value: currentItem.value ?? 0,
      max: currentItem.max,
      color: currentItem.color,
    });
  }

  return { type, title, items, showPercent, animated };
}

function setItemField(item: Partial<ProgressItem>, key: string, val: string) {
  const v = val.trim().replace(/^["']|["']$/g, "");
  switch (key) {
    case "label":
      item.label = v;
      break;
    case "value":
      item.value = parseFloat(v);
      break;
    case "max":
      item.max = parseFloat(v);
      break;
    case "color":
      item.color = v;
      break;
  }
}

// ── Bar Component ────────────────────────────────────────────────────────────

function ProgressBar({ item, showPercent, animated }: { item: ProgressItem; showPercent: boolean; animated: boolean }) {
  const max = item.max || 100;
  const pct = Math.min(100, Math.max(0, (item.value / max) * 100));
  const color = item.color || autoColor(item.value, max);

  return (
    <div className="kiwi-progress-bar space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-foreground">{item.label}</span>
        {showPercent && (
          <span className="text-muted-foreground font-mono text-xs">
            {item.value}/{max} ({pct.toFixed(0)}%)
          </span>
        )}
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${animated ? "duration-1000 ease-out" : ""}`}
          style={{
            width: `${pct}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

// ── Gauge Component (Radial SVG) ─────────────────────────────────────────────

function ProgressGauge({ item, showPercent, animated }: { item: ProgressItem; showPercent: boolean; animated: boolean }) {
  const max = item.max || 100;
  const pct = Math.min(100, Math.max(0, (item.value / max) * 100));
  const color = item.color || autoColor(item.value, max);

  const size = 80;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="kiwi-progress-gauge flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={animated ? "transition-all duration-1000 ease-out" : ""}
        />
      </svg>
      <span className="text-xs font-medium text-foreground">{item.label}</span>
      {showPercent && (
        <span className="text-[10px] text-muted-foreground font-mono">{pct.toFixed(0)}%</span>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function KiwiProgress({ source }: { source: string }) {
  const { config, error } = useMemo(() => {
    try {
      const cfg = parseProgressConfig(source);
      if (!cfg.items || cfg.items.length === 0) {
        return { config: null, error: "No progress items defined" };
      }
      return { config: cfg, error: null };
    } catch (e) {
      return { config: null, error: e instanceof Error ? e.message : "Failed to parse progress config" };
    }
  }, [source]);

  if (error || !config) {
    return (
      <div className="kiwi-progress-error rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <strong>Progress Error:</strong> {error}
      </div>
    );
  }

  const { type, title, items, showPercent = true, animated = true } = config;

  return (
    <figure className="kiwi-progress not-prose my-4">
      {title && (
        <figcaption className="mb-3 text-sm font-medium text-foreground">{title}</figcaption>
      )}
      {type === "gauge" ? (
        <div className="flex flex-wrap gap-4 justify-center">
          {items.map((item, i) => (
            <ProgressGauge key={i} item={item} showPercent={showPercent} animated={animated} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <ProgressBar key={i} item={item} showPercent={showPercent} animated={animated} />
          ))}
        </div>
      )}
    </figure>
  );
}
