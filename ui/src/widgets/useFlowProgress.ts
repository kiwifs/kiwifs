import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A 0 → 1 progress value that replays (ease-out) every time `signature`
 * changes — e.g. once per playback step, to move a packet along an edge.
 * Holds at `rest` (default 1) when disabled, when `signature` is empty, or
 * when the user prefers reduced motion.
 */
export function useFlowProgress(
  signature: string,
  { duration = 900, enabled = true, rest = 1 }: { duration?: number; enabled?: boolean; rest?: number } = {},
): number {
  const active = enabled && signature !== "" && !prefersReducedMotion();
  const [progress, setProgress] = useState(active ? 0 : rest);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(rest);
      return;
    }
    const start = performance.now();
    setProgress(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setProgress(1 - (1 - t) * (1 - t));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [signature, duration, active, rest]);

  return progress;
}

/** Opacity for a moving marker: solid in flight, fading over the last stretch. */
export function arrivalOpacity(t: number): number {
  return Math.max(0, Math.min(1, (1 - t) / 0.18));
}
