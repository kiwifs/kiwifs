import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ZoomPanelProps {
  children: ReactNode;
  minZoom?: number;
  maxZoom?: number;
  /** Fixed viewport height in px. Default: the content's own height. */
  height?: number;
}

const STEP = 0.25;

const buttonStyle: React.CSSProperties = {
  minWidth: 26,
  height: 24,
  padding: "0 6px",
  borderRadius: 4,
  border: "1px solid var(--kw-widget-border, #3f3f46)",
  background: "var(--kw-widget-surface, #18181b)",
  color: "var(--kw-widget-text, #e5e7eb)",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  cursor: "pointer",
};

/**
 * Zoom and pan any widget content: −/+ buttons, Ctrl/⌘ + scroll, and drag.
 * A drag only starts after the pointer moves a few px, so clicks inside the
 * content still reach it.
 */
export function ZoomPanel({ children, minZoom = 0.5, maxZoom = 4, height }: ZoomPanelProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; id: number; moved: boolean } | null>(null);
  const clamp = useCallback((z: number) => Math.min(maxZoom, Math.max(minZoom, z)), [minZoom, maxZoom]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z + (e.deltaY > 0 ? -STEP : STEP)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clamp]);

  const isDefault = zoom === 1 && pan.x === 0 && pan.y === 0;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginBottom: 4 }}>
        <button type="button" style={buttonStyle} aria-label="Zoom out" disabled={zoom <= minZoom} onClick={() => setZoom((z) => clamp(z - STEP))}>
          −
        </button>
        <span style={{ minWidth: 40, textAlign: "center", fontSize: 11, fontVariantNumeric: "tabular-nums", color: "var(--kw-widget-text, #e5e7eb)" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" style={buttonStyle} aria-label="Zoom in" disabled={zoom >= maxZoom} onClick={() => setZoom((z) => clamp(z + STEP))}>
          +
        </button>
        {!isDefault && (
          <button type="button" style={buttonStyle} aria-label="Reset zoom" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            Reset
          </button>
        )}
      </div>
      <div
        ref={viewport}
        style={{ overflow: "hidden", height, cursor: drag.current?.moved ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, id: e.pointerId, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved) {
            if (Math.hypot(dx, dy) < 4) return;
            d.moved = true;
            viewport.current?.setPointerCapture(d.id);
          }
          setPan({ x: d.panX + dx, y: d.panY + dy });
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (d?.moved) viewport.current?.releasePointerCapture(d.id);
          drag.current = null;
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center top",
            transition: drag.current?.moved ? undefined : "transform 120ms ease",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
