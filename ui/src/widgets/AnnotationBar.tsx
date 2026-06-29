import type { ReactNode } from "react";

export interface AnnotationBarProps {
  /** Step explanation. Supports inline markdown: **bold**, *italic*, `code`. */
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

/** Parse inline markdown (**bold**, *italic*, `code`) into React elements. */
function parseInlineMarkdown(text: string): (string | ReactNode)[] {
  const parts: (string | ReactNode)[] = [];
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(
        <code key={key++} style={{
          background: "rgba(255,255,255,0.08)",
          padding: "1px 5px",
          borderRadius: 4,
          fontSize: "0.8em",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        }}>
          {match[4]}
        </code>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

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
      {parseInlineMarkdown(text)}
    </div>
  );
}
