import { useRef } from "react";
import { alpha } from "./colors";
import { hasMath } from "./widgetLabel";
import { WidgetText } from "./WidgetText";

export interface PropertyEntry {
  label: string;
  value: string | number | boolean;
  /** Whether this entry changed on the current step. Detected automatically when omitted. */
  changed?: boolean;
}

export interface PropertyBarProps {
  entries: PropertyEntry[];
  /** Optional title above the table. */
  title?: string;
  /** Highlight entries whose value differs from the previous step. Default true. */
  autoChanged?: boolean;
}

/**
 * Labels whose value differs between the last two distinct snapshots. Kept
 * across re-renders that don't change any value, so a hover doesn't clear it.
 */
export function useChangedValues(pairs: [string, unknown][], enabled: boolean): Set<string> {
  const ref = useRef<{ sig: string; values: Map<string, string> | null; changed: Set<string> }>({
    sig: "",
    values: null,
    changed: new Set(),
  });
  if (!enabled) return ref.current.changed;
  const values = new Map(pairs.map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]));
  const sig = Array.from(values, ([k, v]) => `${k}=${v}`).join("\u0000");
  const st = ref.current;
  if (sig !== st.sig) {
    const changed = new Set<string>();
    if (st.values) for (const [k, v] of values) if (st.values.has(k) && st.values.get(k) !== v) changed.add(k);
    st.changed = changed;
    st.values = values;
    st.sig = sig;
  }
  return st.changed;
}

export function PropertyBar({ entries, title, autoChanged = true }: PropertyBarProps) {
  const auto = useChangedValues(entries.map((e) => [e.label, e.value]), autoChanged);
  return (
    <div style={{
      display: "inline-flex",
      flexDirection: "column",
      borderRadius: 8,
      border: "1px solid var(--kw-widget-border, #3f3f46)",
      overflow: "hidden",
      fontSize: "0.8rem",
      fontVariantNumeric: "tabular-nums",
    }}>
      {title && (
        <div style={{
          padding: "4px 12px",
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "var(--kw-widget-dim, #94a3b8)",
          borderBottom: "1px solid var(--kw-widget-border, #3f3f46)",
          background: alpha("var(--kw-widget-border, #3f3f46)", 20),
        }}>
          <WidgetText text={title} />
        </div>
      )}
      <div style={{ display: "flex" }}>
        {entries.map((e) => ({ ...e, changed: e.changed ?? auto.has(e.label) })).map((entry, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "6px 14px",
              borderRight: i < entries.length - 1 ? "1px solid var(--kw-widget-border, #3f3f46)" : undefined,
              transition: "background 0.15s ease",
              background: entry.changed ? alpha("var(--kw-widget-active, #a78bfa)", 10) : "transparent",
            }}
          >
            <span style={{
              fontSize: "0.65rem",
              fontWeight: 600,
              color: "var(--kw-widget-dim, #94a3b8)",
              textTransform: hasMath(entry.label) ? "none" : "uppercase",
              letterSpacing: "0.05em",
            }}>
              <WidgetText text={entry.label} />
            </span>
            <span style={{
              fontWeight: 700,
              color: entry.changed
                ? "var(--kw-widget-active, #a78bfa)"
                : "var(--kw-widget-text, #e5e7eb)",
              marginTop: 2,
            }}>
              <WidgetText text={String(entry.value)} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
