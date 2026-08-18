import type { ReactNode } from "react";
import { figureClassName, type FigureWidth } from "@kw/lib/figureLayout";

type Props = {
  width?: FigureWidth;
  pin?: boolean;
  caption?: string;
  children: ReactNode;
};

export function KiwiFigure({ width = "inline", pin = false, caption, children }: Props) {
  const kids = Array.isArray(children) ? children : [children];
  const media = kids[0];
  const rest = kids.slice(1);

  return (
    <figure className={figureClassName({ width, pin })} data-width={width} data-pin={pin ? "true" : undefined}>
      <div className="kiwi-figure-media">{media}</div>
      {(rest.length > 0 || caption) && (
        <div className="kiwi-figure-body">
          {caption && <figcaption className="kiwi-figcaption">{caption}</figcaption>}
          {rest}
        </div>
      )}
    </figure>
  );
}
