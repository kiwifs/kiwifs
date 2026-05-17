/**
 * KiwiColumns — Side-by-side column layout from :::columns directives.
 *
 * Renders a CSS grid layout from container directives. Supports:
 * - Auto-sizing equal columns (default)
 * - Custom ratios: :::columns{ratio="2:1"} or :::columns{ratio="1:2:1"}
 * - Explicit column count: :::columns{cols=3}
 * - Responsive: stacks on mobile, side-by-side on desktop
 *
 * Markdown syntax:
 * ```
 * :::columns
 * ::col
 * ### Left Side
 * Content here.
 *
 * ::col
 * ### Right Side
 * More content.
 * :::
 * ```
 */

import React, { useMemo, Children, isValidElement } from "react";

interface KiwiColumnsProps {
  children: React.ReactNode;
  ratio?: string;
  cols?: string;
}

/**
 * Extract column panels from children.
 * Each column is a div with data-kiwi-directive="col".
 */
function extractColumns(children: React.ReactNode): React.ReactNode[] {
  const columns: React.ReactNode[] = [];
  const childArray = Children.toArray(children);

  for (const child of childArray) {
    if (isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      if (props["data-kiwi-directive"] === "col") {
        columns.push(props.children as React.ReactNode);
      } else {
        // Check nested children for col elements
        const nested = extractColumns(props.children as React.ReactNode);
        if (nested.length > 0) {
          columns.push(...nested);
        }
      }
    }
  }

  return columns;
}

/**
 * Parse ratio string into CSS grid-template-columns.
 * "2:1" → "2fr 1fr"
 * "1:2:1" → "1fr 2fr 1fr"
 */
function ratioToGridTemplate(ratio: string): string {
  if (!ratio) return "";
  const parts = ratio.split(":").map((p) => p.trim());
  if (parts.some((p) => isNaN(Number(p)) || Number(p) <= 0)) return "";
  return parts.map((p) => `${p}fr`).join(" ");
}

export function KiwiColumns({ children, ratio, cols }: KiwiColumnsProps) {
  const columns = extractColumns(children);

  const gridStyle = useMemo(() => {
    if (ratio) {
      const template = ratioToGridTemplate(ratio);
      if (template) return { gridTemplateColumns: template };
    }
    if (cols) {
      const n = parseInt(cols, 10);
      if (n > 0) return { gridTemplateColumns: `repeat(${n}, 1fr)` };
    }
    // Default: equal columns based on number of ::col children
    if (columns.length > 0) {
      return { gridTemplateColumns: `repeat(${columns.length}, 1fr)` };
    }
    return { gridTemplateColumns: "1fr 1fr" };
  }, [ratio, cols, columns.length]);

  if (columns.length === 0) {
    return <div>{children}</div>;
  }

  return (
    <div
      className="kiwi-columns not-prose my-4 grid gap-4 md:gap-6"
      style={gridStyle}
    >
      {columns.map((col, index) => (
        <div key={index} className="kiwi-col min-w-0 kiwi-prose">
          {col}
        </div>
      ))}
      <style>{`
        @media (max-width: 768px) {
          .kiwi-columns { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
