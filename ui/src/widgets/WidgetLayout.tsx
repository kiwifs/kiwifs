import { useState, type ReactNode } from "react";

import { hasMath } from "./widgetLabel";
import { WidgetText } from "./WidgetText";

export interface WidgetLayoutProps {
  /**
   * How to arrange the panels. `"row"` (default) and `"column"` are flex;
   * `"grid"` wraps into `columns` tracks; `"tabs"` shows one at a time, which
   * is what you want for comparing two runs of the same algorithm — side by
   * side you compare shapes, in tabs you compare values.
   */
  direction?: "row" | "column" | "grid" | "tabs";
  /** Grid only: how many tracks. Default 2. */
  columns?: number;
  /** Gap between panels in px. Default 12. */
  gap?: number;
  /**
   * Tabs only: which panel is open. Default 0. The reader can switch tabs; a
   * new value from the author (a walkthrough step) switches it again.
   */
  tab?: number;
  /** Tabs only: the reader opened another panel. */
  onTabChange?: (tab: number) => void;
  /** Children are rendered as panels. */
  children: ReactNode;
}

export function WidgetLayout({
  direction = "row",
  columns = 2,
  gap = 12,
  tab = 0,
  onTabChange,
  children,
}: WidgetLayoutProps) {
  const panels = toPanelList(children);
  const [open, setOpenState] = useState(tab);
  const [lastTab, setLastTab] = useState(tab);
  if (tab !== lastTab) {
    setLastTab(tab);
    setOpenState(tab);
  }
  const setOpen = (i: number) => {
    setOpenState(i);
    onTabChange?.(i);
  };

  if (direction === "tabs" && panels.length > 1) {
    const current = Math.max(0, Math.min(open, panels.length - 1));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {panels.map((panel, i) => {
            const selected = i === current;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setOpen(i)}
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  padding: "2px 10px",
                  borderRadius: 999,
                  border: `1px solid ${selected ? "var(--kw-widget-active, #a78bfa)" : "var(--kw-widget-border, #3f3f46)"}`,
                  background: selected ? "color-mix(in srgb, var(--kw-widget-active, #a78bfa) 18%, transparent)" : "transparent",
                  color: selected ? "var(--kw-widget-text, #e5e7eb)" : "var(--kw-widget-dim, #94a3b8)",
                  cursor: "pointer",
                }}
              >
                <WidgetText text={panel.title ?? `Panel ${i + 1}`} />
              </button>
            );
          })}
        </div>
        {/* Only the open panel is mounted, so a heavy canvas in a closed tab
            costs nothing — and a shared clock keeps the hidden one in step
            when the reader switches back. The key stops two panels of the
            same component type from sharing one instance's state. */}
        <div key={current} role="tabpanel">{panels[current]?.node}</div>
      </div>
    );
  }

  if (direction === "grid") {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
          gap,
          width: "100%",
        }}
      >
        {children}
      </div>
    );
  }

  // "tabs" with a single panel falls through to a plain row.
  const flexDirection = direction === "column" ? "column" : "row";
  return (
    <div style={{
      display: "flex",
      flexDirection,
      gap,
      width: "100%",
      flexWrap: flexDirection === "row" ? "wrap" : undefined,
    }}>
      {children}
    </div>
  );
}

interface PanelEntry {
  title?: string;
  node: ReactNode;
}

/**
 * Children as a list, reading each `WidgetPanel`'s title for the tab strip.
 * Done by inspecting props rather than by cloning, so a child that is not a
 * panel still renders.
 */
function toPanelList(children: ReactNode): PanelEntry[] {
  const list = Array.isArray(children) ? children : [children];
  return list.flat(2).filter(Boolean).map((node) => {
    const props = (node as { props?: { title?: string } } | null)?.props;
    return { title: props?.title, node: node as ReactNode };
  });
}

export interface WidgetPanelProps {
  /** Flex value. Default "1 1 0". Ignored in grid and tabs layouts. */
  flex?: string;
  /** Minimum width before wrapping (for row layout). */
  minWidth?: number;
  /** Optional label above the panel; also the tab caption. */
  title?: string;
  /** Panel content. */
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
          textTransform: hasMath(title) ? "none" : "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}>
          <WidgetText text={title} />
        </div>
      )}
      {children}
    </div>
  );
}
