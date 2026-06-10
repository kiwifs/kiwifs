export interface StateEntry {
  label: string;
  value: string | number | boolean;
  /** If true, this entry changed on the current step (will be highlighted). */
  changed?: boolean;
}

export interface StateTableProps {
  entries: StateEntry[];
  /** Optional title above the table. */
  title?: string;
}

export function StateTable({ entries, title }: StateTableProps) {
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
          background: "var(--kw-widget-border, #3f3f46)" + "33",
        }}>
          {title}
        </div>
      )}
      <div style={{ display: "flex" }}>
        {entries.map((entry, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "6px 14px",
              borderRight: i < entries.length - 1 ? "1px solid var(--kw-widget-border, #3f3f46)" : undefined,
              transition: "background 0.15s ease",
              background: entry.changed ? "var(--kw-widget-active, #a78bfa)" + "1a" : "transparent",
            }}
          >
            <span style={{
              fontSize: "0.65rem",
              fontWeight: 600,
              color: "var(--kw-widget-dim, #94a3b8)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              {entry.label}
            </span>
            <span style={{
              fontWeight: 700,
              color: entry.changed
                ? "var(--kw-widget-active, #a78bfa)"
                : "var(--kw-widget-text, #e5e7eb)",
              marginTop: 2,
            }}>
              {String(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
