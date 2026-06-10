export interface CodeHighlightProps {
  /** The source code to display (plain text, one line per array entry or newline-separated string). */
  code: string | string[];
  /** 0-based line index to highlight. -1 or undefined means no highlight. */
  activeLine?: number;
  /** Optional label above the code block. */
  title?: string;
}

export function CodeHighlight({ code, activeLine, title }: CodeHighlightProps) {
  const lines = Array.isArray(code) ? code : code.split("\n");

  return (
    <div style={{
      borderRadius: 8,
      border: "1px solid var(--kw-widget-border, #3f3f46)",
      overflow: "hidden",
      fontSize: "0.8rem",
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
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
      <div style={{ padding: "8px 0" }}>
        {lines.map((line, i) => {
          const active = i === activeLine;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "1px 12px",
                background: active ? "var(--kw-widget-active, #a78bfa)" + "22" : "transparent",
                borderLeft: active
                  ? "3px solid var(--kw-widget-active, #a78bfa)"
                  : "3px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{
                width: 28,
                textAlign: "right",
                marginRight: 12,
                color: active
                  ? "var(--kw-widget-active, #a78bfa)"
                  : "var(--kw-widget-dim, #64748b)",
                userSelect: "none",
                flexShrink: 0,
              }}>
                {i + 1}
              </span>
              <span style={{
                color: active
                  ? "var(--kw-widget-text, #e5e7eb)"
                  : "var(--kw-widget-dim, #94a3b8)",
                whiteSpace: "pre",
              }}>
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
