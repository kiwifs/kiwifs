import type { CSSProperties, ReactNode } from "react";
import katex from "katex";

import { alpha } from "./colors";
import { hasMath, labelSegments, plainHeaderLength } from "./widgetLabel";

export interface WidgetTextProps {
  text: string | number | null | undefined;
  /** Parse `**bold**`, `*italic*`, and `code` in the non-math parts. */
  markdown?: boolean;
}

/**
 * Render a widget caption. Math islands (`$n^k$`, `e^{t^2/2}`, `M'(0)`) go
 * through KaTeX; the rest stays ordinary text, optionally with inline markdown.
 */
export function WidgetText({ text, markdown = false }: WidgetTextProps) {
  if (text == null) return null;
  if (typeof text === "number") return <>{text}</>;

  const segs = labelSegments(text);
  if (segs.length === 0) return null;
  if (segs.length === 1 && segs[0]!.kind === "text" && !markdown) {
    return <>{segs[0]!.value}</>;
  }

  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === "math" ? (
          <MathSpan key={i} src={seg.value} />
        ) : markdown ? (
          <span key={i}>{parseInlineMarkdown(seg.value)}</span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}

function MathSpan({ src }: { src: string }) {
  const html = katex.renderToString(src, {
    throwOnError: false,
    displayMode: false,
    output: "html",
  });
  return (
    <span
      className="kw-widget-math"
      style={{ color: "inherit", lineHeight: 1.15 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

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
        <code
          key={key++}
          style={{
            background: alpha("var(--kw-widget-dim, #94a3b8)", 18),
            padding: "1px 5px",
            borderRadius: 4,
            fontSize: "0.8em",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          {match[4]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [text];
}

export interface SvgLabelProps {
  x: number;
  y: number;
  text: string | number;
  fill?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  anchor?: "start" | "middle" | "end";
  dominantBaseline?: "auto" | "central";
  /** Halo color so the label stays readable on a stroke or fill. */
  halo?: string;
  style?: CSSProperties;
}

/**
 * SVG caption that stays native `<text>` when there is no math, and uses a
 * foreignObject + KaTeX otherwise. Axis ticks (plain numbers) stay sharp.
 */
export function SvgLabel({
  x,
  y,
  text,
  fill,
  fontSize = 10,
  fontWeight,
  fontFamily,
  anchor = "start",
  dominantBaseline = "auto",
  halo,
  style,
}: SvgLabelProps) {
  const raw = String(text);
  if (!hasMath(raw)) {
    return (
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        dominantBaseline={dominantBaseline}
        fill={fill}
        fontSize={fontSize}
        fontWeight={fontWeight}
        fontFamily={fontFamily}
        style={{
          ...(halo ? { paintOrder: "stroke", stroke: halo, strokeWidth: 3 } : null),
          ...style,
        }}
      >
        {raw}
      </text>
    );
  }

  const w = Math.max(28, plainHeaderLength(raw) * fontSize * 0.64 + 14);
  const h = fontSize * 1.75;
  let ox = x;
  let oy = dominantBaseline === "central" ? y - h / 2 : y - fontSize * 0.9;
  if (anchor === "middle") ox = x - w / 2;
  if (anchor === "end") ox = x - w;
  const align = anchor === "end" ? "right" : anchor === "middle" ? "center" : "left";

  return (
    <foreignObject x={ox} y={oy} width={w} height={h} style={{ overflow: "visible" }}>
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        style={{
          color: fill,
          fontSize,
          fontWeight,
          fontFamily,
          textAlign: align,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          textShadow: halo ? `0 0 2px ${halo}, 0 0 2px ${halo}, 0 0 3px ${halo}` : undefined,
        }}
      >
        <WidgetText text={raw} />
      </div>
    </foreignObject>
  );
}
