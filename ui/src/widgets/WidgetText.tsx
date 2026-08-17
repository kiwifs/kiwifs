import katex from "katex";

import { mathSource } from "./widgetLabel";

export interface WidgetTextProps {
  text: string | number | null | undefined;
}

/**
 * Render a widget caption. `$n^k$` and other math-looking strings go through
 * KaTeX; everything else is plain text.
 */
export function WidgetText({ text }: WidgetTextProps) {
  if (text == null) return null;
  if (typeof text === "number") return <>{text}</>;

  const src = mathSource(text);
  if (!src) return <>{text}</>;

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
