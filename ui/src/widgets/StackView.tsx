import { alpha } from "./colors";
import { hasMath } from "./widgetLabel";
import { WidgetText } from "./WidgetText";

export interface StackPointer {
  index: number;
  label: string;
  color?: string;
}

export interface StackViewProps {
  /** Items from the bottom of the stack to the top. */
  values: (string | number)[];
  /** Index of the active item. Defaults to the top of the stack. */
  activeIndex?: number;
  highlightIndices?: Set<number>;
  dimIndices?: Set<number>;
  /** Named markers beside individual items. */
  pointers?: StackPointer[];
  /** Where the top of the stack is drawn. Default "top". */
  growth?: "top" | "bottom";
  /** Caption on the open end. Default "top". */
  topLabel?: string;
  /** Show the index of each item. Default true. */
  showIndices?: boolean;
  /** Scroll past this height rather than growing the page. Default 300. */
  maxHeight?: number;
  itemWidth?: number;
  itemHeight?: number;
  title?: string;
  empty?: string;
  activeColor?: string;
  highlightColor?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  itemWidth: 72,
  itemHeight: 30,
  maxHeight: 300,
};

/**
 * A vertical stack that pushes and pops at one end.
 *
 * Use it for anything last-in-first-out: an explicit DFS stack, a monotonic
 * stack beside a BarView, the operator stack in an expression parser.
 */
export function StackView({
  values,
  activeIndex,
  highlightIndices,
  dimIndices,
  pointers = [],
  growth = "top",
  topLabel = "top",
  showIndices = true,
  maxHeight = DEFAULTS.maxHeight,
  itemWidth = DEFAULTS.itemWidth,
  itemHeight = DEFAULTS.itemHeight,
  title,
  empty = "(empty)",
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
}: StackViewProps) {
  const active = activeIndex ?? values.length - 1;

  const ptrMap = new Map<number, StackPointer[]>();
  for (const p of pointers) {
    const list = ptrMap.get(p.index) ?? [];
    list.push(p);
    ptrMap.set(p.index, list);
  }

  const order = values.map((value, index) => ({ value, index }));
  if (growth === "top") order.reverse();

  const openEnd = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: itemWidth,
        justifyContent: "center",
        fontSize: "0.62rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: DEFAULTS.dimColor,
        textTransform: "uppercase",
      }}
    >
      {values.length > 0 ? `↑ ${topLabel}` : ""}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.5rem 0" }}>
      {title && (
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: DEFAULTS.dimColor, letterSpacing: "0.04em", marginBottom: 4 }}>
          {hasMath(title) ? <WidgetText text={title} /> : title.toUpperCase()}
        </div>
      )}

      {growth === "top" && openEnd}

      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight, overflowY: "auto", padding: "2px 0" }}>
        {values.length === 0 ? (
          <div
            style={{
              width: itemWidth,
              height: itemHeight,
              border: `2px dashed ${DEFAULTS.border}`,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.65rem",
              color: DEFAULTS.dimColor,
            }}
          >
            {empty}
          </div>
        ) : (
          order.map(({ value, index }) => {
            const isActive = index === active;
            const isHighlight = highlightIndices?.has(index) ?? false;
            const isDim = dimIndices?.has(index) ?? false;
            const ptrs = ptrMap.get(index);

            let bg = "transparent";
            let border = DEFAULTS.border;
            let color = DEFAULTS.text;
            let opacity = 1;

            if (isActive) {
              bg = activeColor;
              border = activeColor;
              color = "var(--kw-widget-active-foreground, #111827)";
            } else if (isHighlight) {
              bg = alpha(highlightColor, 18);
              border = highlightColor;
            } else if (isDim) {
              border = DEFAULTS.dimColor;
              opacity = 0.5;
            }

            return (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {showIndices && (
                  <span
                    style={{
                      width: 16,
                      textAlign: "right",
                      fontSize: "0.6rem",
                      color: DEFAULTS.dimColor,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {index}
                  </span>
                )}
                <div
                  style={{
                    width: itemWidth,
                    height: itemHeight,
                    border: `2px solid ${border}`,
                    borderRadius: 6,
                    background: bg,
                    color,
                    opacity,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    transition: "all 0.2s ease",
                  }}
                >
                  <WidgetText text={value} />
                </div>
                <span style={{ fontSize: "0.65rem", fontWeight: 600, display: "flex", gap: 4 }}>
                  {ptrs?.map((p, j) => (
                    <span key={j} style={{ color: p.color ?? activeColor }}><WidgetText text={p.label} /></span>
                  ))}
                </span>
              </div>
            );
          })
        )}
      </div>

      {growth === "bottom" && openEnd}

      {/* Closed end of the stack */}
      <div
        style={{
          width: itemWidth + (showIndices ? 22 : 0),
          borderTop: `2px solid ${DEFAULTS.dimColor}`,
          opacity: 0.5,
          marginTop: 2,
        }}
      />
    </div>
  );
}
