import { alpha } from "./colors";
import { hasMath } from "./widgetLabel";
import { WidgetText } from "./WidgetText";

export interface AnnotationBarProps {
  /** Step explanation. Supports inline math and markdown: **bold**, *italic*, `code`. */
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
      background: alpha(style.bg, 5),
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
          textTransform: hasMath(label) ? "none" : "uppercase",
          letterSpacing: "0.04em",
        }}>
          <WidgetText text={label} />
        </span>
      )}
      <WidgetText text={text} markdown />
    </div>
  );
}
