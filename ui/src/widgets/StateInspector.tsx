export interface StateInspectorProps {
  /** Key-value pairs to display. Values can be primitives, arrays, or objects. */
  state: Record<string, unknown>;
  /** Set of keys that changed on this step (will be highlighted). */
  changedKeys?: Set<string>;
  /** Optional title above the inspector. */
  title?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  dimColor: "var(--kw-widget-dim, #94a3b8)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
};

function renderValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map(renderValue).join(", ") + "]";
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return "{ " + entries.map(([k, v]) => k + ": " + renderValue(v)).join(", ") + " }";
  }
  return String(val);
}

function typeColor(val: unknown): string {
  if (val === null || val === undefined) return DEFAULTS.dimColor;
  if (typeof val === "boolean") return "#f59e0b";
  if (typeof val === "number") return "#60a5fa";
  if (typeof val === "string") return "#34d399";
  if (Array.isArray(val)) return "#c084fc";
  return DEFAULTS.text;
}

export function StateInspector({ state, changedKeys, title }: StateInspectorProps) {
  const entries = Object.entries(state);

  if (entries.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 12, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
        (no state)
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${DEFAULTS.border}`,
      overflow: "hidden",
      fontSize: "0.8rem",
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
    }}>
      {title && (
        <div style={{
          padding: "4px 12px",
          fontSize: "0.7rem",
          fontWeight: 600,
          color: DEFAULTS.dimColor,
          borderBottom: `1px solid ${DEFAULTS.border}`,
          background: DEFAULTS.border + "33",
          fontFamily: "system-ui, sans-serif",
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: "4px 0" }}>
        {entries.map(([key, val]) => {
          const changed = changedKeys?.has(key) ?? false;
          return (
            <div
              key={key}
              style={{
                display: "flex",
                padding: "3px 12px",
                background: changed ? DEFAULTS.activeColor + "15" : "transparent",
                transition: "background 0.15s ease",
                gap: 8,
                alignItems: "baseline",
              }}
            >
              <span style={{
                color: changed ? DEFAULTS.activeColor : DEFAULTS.dimColor,
                fontWeight: 600,
                flexShrink: 0,
                minWidth: 60,
              }}>
                {key}
              </span>
              <span style={{ color: "var(--kw-widget-dim, #64748b)", flexShrink: 0 }}>=</span>
              <span style={{
                color: changed ? DEFAULTS.text : typeColor(val),
                wordBreak: "break-all",
              }}>
                {renderValue(val)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
