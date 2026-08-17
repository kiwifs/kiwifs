import { alpha } from "./colors";
import { hasMath } from "./widgetLabel";
import { WidgetText } from "./WidgetText";

export interface CallFrame {
  /** How the call was made, e.g. `dfs(node=3, depth=2)`. */
  label: string;
  /** Locals and arguments to show inside the frame. */
  state?: Record<string, unknown>;
  /** The value this frame has computed, once it has one. */
  returns?: string | number | null;
  /** Line number the frame is paused on, shown as a badge. */
  line?: number | string;
}

export interface CallStackViewProps {
  /** Frames from the outermost call to the innermost. */
  frames: CallFrame[];
  /** Which frame is executing. Defaults to the innermost. */
  activeIndex?: number;
  /** Frames that have already returned, drawn faded above the live stack so a
   *  step-through can show a value being handed back. */
  returned?: CallFrame[];
  /** Where the innermost frame sits. Default "top". */
  growth?: "top" | "bottom";
  /** Scroll past this height rather than growing the page. Default 320. */
  maxHeight?: number;
  title?: string;
  activeColor?: string;
  highlightColor?: string;
  /** Message shown when the stack is empty. */
  empty?: string;
}

const DEFAULTS = {
  activeColor: "var(--kw-widget-active, #a78bfa)",
  highlightColor: "var(--kw-widget-highlight, #22c55e)",
  dimColor: "var(--kw-widget-dim, #64748b)",
  border: "var(--kw-widget-border, #3f3f46)",
  text: "var(--kw-widget-text, #e5e7eb)",
  surface: "var(--kw-widget-surface, #18181b)",
  maxHeight: 320,
};

function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(renderValue).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${renderValue(v)}`)
      .join(", ")}}`;
  }
  return String(value);
}

interface FrameRowProps {
  frame: CallFrame;
  depth: number;
  active: boolean;
  faded: boolean;
  activeColor: string;
  highlightColor: string;
}

function FrameRow({ frame, depth, active, faded, activeColor, highlightColor }: FrameRowProps) {
  const entries = Object.entries(frame.state ?? {});
  const hasReturn = frame.returns !== undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 8,
        opacity: faded ? 0.45 : 1,
        transition: "all 0.2s ease",
      }}
    >
      {/* Depth gutter */}
      <div
        style={{
          width: 22,
          flexShrink: 0,
          textAlign: "right",
          fontSize: "0.65rem",
          color: DEFAULTS.dimColor,
          fontVariantNumeric: "tabular-nums",
          paddingTop: 7,
        }}
      >
        {depth}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          border: `2px solid ${active ? activeColor : DEFAULTS.border}`,
          background: active ? alpha(activeColor, 14) : "transparent",
          borderRadius: 8,
          padding: "5px 9px",
          borderStyle: faded ? "dashed" : "solid",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: "0.8rem",
              fontWeight: 700,
              color: DEFAULTS.text,
            }}
          >
            <WidgetText text={frame.label} />
          </span>
          {frame.line !== undefined && (
            <span
              style={{
                fontSize: "0.6rem",
                fontWeight: 600,
                color: DEFAULTS.dimColor,
                border: `1px solid ${DEFAULTS.border}`,
                borderRadius: 4,
                padding: "0 4px",
              }}
            >
              L{frame.line}
            </span>
          )}
          {hasReturn && (
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: highlightColor,
              }}
            >
              → <WidgetText text={renderValue(frame.returns)} />
            </span>
          )}
        </div>

        {entries.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 3 }}>
            {entries.map(([key, value]) => (
              <span
                key={key}
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: "0.68rem",
                  color: DEFAULTS.dimColor,
                }}
              >
                {key}
                <span style={{ opacity: 0.6 }}>=</span>
                <span style={{ color: DEFAULTS.text }}><WidgetText text={renderValue(value)} /></span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A stack of call frames, innermost first. Pair it with a recursion tree to
 * show the difference between what has been explored and what is still live.
 */
export function CallStackView({
  frames,
  activeIndex,
  returned = [],
  growth = "top",
  maxHeight = DEFAULTS.maxHeight,
  title,
  activeColor = DEFAULTS.activeColor,
  highlightColor = DEFAULTS.highlightColor,
  empty = "(stack empty)",
}: CallStackViewProps) {
  const active = activeIndex ?? frames.length - 1;

  // `frames` is written outermost-first because that is the order a reader
  // thinks in; "top" growth flips it so the innermost call is on top.
  const ordered = frames.map((frame, i) => ({ frame, depth: i }));
  if (growth === "top") ordered.reverse();

  const returnedRows = returned.map((frame, i) => ({ frame, depth: frames.length + i }));

  return (
    <div
      style={{
        border: `1px solid ${DEFAULTS.border}`,
        borderRadius: 8,
        background: alpha(DEFAULTS.surface, 60),
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: DEFAULTS.dimColor, letterSpacing: "0.04em" }}>
          {title && hasMath(title) ? <WidgetText text={title} /> : (title ?? "CALL STACK").toUpperCase()}
        </span>
        <span style={{ fontSize: "0.65rem", color: DEFAULTS.dimColor, fontVariantNumeric: "tabular-nums" }}>
          depth {frames.length}
        </span>
      </div>

      {frames.length === 0 && returnedRows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 12, color: DEFAULTS.dimColor, fontSize: "0.8rem" }}>
          {empty}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight, overflowY: "auto" }}>
          {growth === "top" && returnedRows.map(({ frame, depth }, i) => (
            <FrameRow
              key={`r${i}`}
              frame={frame}
              depth={depth}
              active={false}
              faded
              activeColor={activeColor}
              highlightColor={highlightColor}
            />
          ))}
          {ordered.map(({ frame, depth }) => (
            <FrameRow
              key={depth}
              frame={frame}
              depth={depth}
              active={depth === active}
              faded={false}
              activeColor={activeColor}
              highlightColor={highlightColor}
            />
          ))}
          {growth === "bottom" && returnedRows.map(({ frame, depth }, i) => (
            <FrameRow
              key={`r${i}`}
              frame={frame}
              depth={depth}
              active={false}
              faded
              activeColor={activeColor}
              highlightColor={highlightColor}
            />
          ))}
        </div>
      )}
    </div>
  );
}
