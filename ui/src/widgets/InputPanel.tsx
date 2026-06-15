export interface InputField {
  key: string;
  label: string;
  type: "number" | "text" | "array" | "boolean";
  defaultValue: unknown;
  /** For numbers: min value. */
  min?: number;
  /** For numbers: max value. */
  max?: number;
  /** For arrays: separator (default ","). */
  separator?: string;
}

export interface InputPanelProps {
  fields: InputField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Optional title. */
  title?: string;
  /** Layout: "row" or "column". Default "row". */
  layout?: "row" | "column";
}

const DEFAULTS = {
  dimColor: "var(--kw-widget-dim, #94a3b8)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
};

function parseArray(s: string, sep: string): number[] {
  return s.split(sep).map((v) => v.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n));
}

export function InputPanel({
  fields,
  values,
  onChange,
  title,
  layout = "row",
}: InputPanelProps) {
  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${DEFAULTS.border}`,
      padding: "8px 12px",
      fontSize: "0.8rem",
    }}>
      {title && (
        <div style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          color: DEFAULTS.dimColor,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}>
          {title}
        </div>
      )}
      <div style={{
        display: "flex",
        flexDirection: layout === "row" ? "row" : "column",
        gap: layout === "row" ? 16 : 8,
        flexWrap: "wrap",
        alignItems: layout === "row" ? "center" : undefined,
      }}>
        {fields.map((field) => {
          const val = values[field.key] ?? field.defaultValue;

          return (
            <div key={field.key} style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <label style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: DEFAULTS.dimColor,
                whiteSpace: "nowrap",
              }}>
                {field.label}
              </label>

              {field.type === "number" && (
                <input
                  type="number"
                  value={val as number}
                  min={field.min}
                  max={field.max}
                  onChange={(e) => onChange(field.key, Number(e.target.value))}
                  style={{
                    width: 64,
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${DEFAULTS.border}`,
                    background: "transparent",
                    color: DEFAULTS.text,
                    fontSize: "0.8rem",
                    fontFamily: "ui-monospace, monospace",
                    fontVariantNumeric: "tabular-nums",
                  }}
                />
              )}

              {field.type === "text" && (
                <input
                  type="text"
                  value={val as string}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  style={{
                    width: 120,
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${DEFAULTS.border}`,
                    background: "transparent",
                    color: DEFAULTS.text,
                    fontSize: "0.8rem",
                  }}
                />
              )}

              {field.type === "array" && (
                <input
                  type="text"
                  value={Array.isArray(val) ? (val as number[]).join(field.separator ?? ", ") : String(val)}
                  onChange={(e) => onChange(field.key, parseArray(e.target.value, field.separator ?? ","))}
                  style={{
                    width: 180,
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: `1px solid ${DEFAULTS.border}`,
                    background: "transparent",
                    color: DEFAULTS.text,
                    fontSize: "0.8rem",
                    fontFamily: "ui-monospace, monospace",
                  }}
                />
              )}

              {field.type === "boolean" && (
                <button
                  onClick={() => onChange(field.key, !val)}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    border: `1px solid ${DEFAULTS.border}`,
                    background: val ? "var(--kw-widget-highlight, #22c55e)" + "2e" : "transparent",
                    color: val ? "var(--kw-widget-highlight, #22c55e)" : DEFAULTS.dimColor,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {val ? "true" : "false"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
