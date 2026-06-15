import type { ReactNode } from "react";

export interface WidgetLayoutProps {
  /** Layout direction. Default "row". */
  direction?: "row" | "column";
  /** Gap between panels in px. Default 12. */
  gap?: number;
  /** Children are rendered as panels. */
  children: ReactNode;
}

export function WidgetLayout({ direction = "row", gap = 12, children }: WidgetLayoutProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: direction,
      gap,
      width: "100%",
      flexWrap: direction === "row" ? "wrap" : undefined,
    }}>
      {children}
    </div>
  );
}

export interface WidgetPanelProps {
  /** Flex value. Default "1 1 0". */
  flex?: string;
  /** Minimum width before wrapping (for row layout). */
  minWidth?: number;
  /** Optional label above the panel. */
  title?: string;
  children: ReactNode;
}

export function WidgetPanel({ flex = "1 1 0", minWidth, title, children }: WidgetPanelProps) {
  return (
    <div style={{ flex, minWidth }}>
      {title && (
        <div style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "var(--kw-widget-dim, #94a3b8)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
