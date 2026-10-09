import { useEffect, useRef, useState } from "react";

export interface Point {
  x: number;
  y: number;
}

function signature<K>(m: Map<K, Point>): string {
  let s = "";
  for (const [k, p] of m) s += `${String(k)}:${Math.round(p.x)},${Math.round(p.y)};`;
  return s;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Animate keyed positions toward `target` whenever it changes, so a node that
 * moves between playback steps glides instead of teleporting. Motion starts
 * from wherever the node is drawn now, so stepping mid-animation stays smooth.
 * New keys appear at their target; removed keys drop out immediately.
 *
 * SVG geometry attributes (`cx`, `x1`, …) do not CSS-transition, which is why
 * this tweens in JS rather than relying on `transition` styles.
 */
export function useTweenedPositions<K>(
  target: Map<K, Point>,
  { duration = 320, enabled = true }: { duration?: number; enabled?: boolean } = {},
): Map<K, Point> {
  const [frame, setFrame] = useState(target);
  const shown = useRef(target);
  const latest = useRef(target);
  latest.current = target;
  const sig = signature(target);

  useEffect(() => {
    const to = latest.current;
    const from = shown.current;
    const canAnimate = enabled && duration > 0 && typeof requestAnimationFrame === "function" && !prefersReducedMotion();
    const moves = [...to].some(([k, p]) => {
      const f = from.get(k);
      return f !== undefined && (Math.abs(f.x - p.x) > 0.5 || Math.abs(f.y - p.y) > 0.5);
    });
    if (!canAnimate || !moves) {
      shown.current = to;
      setFrame(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      const next = new Map<K, Point>();
      for (const [k, p] of to) {
        const f = from.get(k) ?? p;
        next.set(k, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e });
      }
      shown.current = next;
      setFrame(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sig, duration, enabled]);

  const out = new Map<K, Point>();
  for (const [k, p] of target) out.set(k, frame.get(k) ?? p);
  return out;
}
