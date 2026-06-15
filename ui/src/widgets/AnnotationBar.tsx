export interface AnnotationBarProps {
  /** The current step's text explanation. Supports simple text only. */
  text: string;
  /** Optional label prefix (e.g. step number). */
  label?: string;
  /** Variant affects styling. "info" = neutral, "success" = green, "warning" = yellow. */
  variant?: "info" | "success" | "warning";
}

const VARIANT_STYLES = {
  info: {
    border: "var(--kw-widget-active, #a78bfa)",
    bg: "var(--kw-widget-active, #a78bfa)",
  },
  success: {
    border: "var(--kw-widget-highlight, #22c55e)",
    bg: "var(--kw-widget-highlight, #22c55e)",
  },
  warning: {
    border: "#f59e0b",
    bg: "#f59e0b",
  },
};

export function AnnotationBar({ text, label, variant = "info" }: AnnotationBarProps) {
  const style = VARIANT_STYLES[variant];

  return (
    <div style={{
      borderLeft: `3px solid ${style.border}`,
      background: style.bg + "0d",
      borderRadius: "0 6px 6px 0",
      padding: "8px 14px",
      fontSize: "0.82rem",
      lineHeight: 1.5,
      color: "var(--kw-widget-text, #e5e7eb)",
      transition: "all 0.2s ease",
    }}>
      {label && (
        <span style={{
          fontWeight: 700,
          color: style.border,
          marginRight: 8,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}>
          {label}
        </span>
      )}
      {text}
    </div>
  );
}
