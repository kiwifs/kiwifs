import { useCallback, useEffect, useRef, useState } from "react";

let mermaidReady = false;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

async function getMermaid() {
  const { default: mermaid } = await import("mermaid");
  return mermaid;
}

async function ensureInit() {
  const mermaid = await getMermaid();
  if (!mermaidReady) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
    });
    mermaidReady = true;
  }
  return mermaid;
}

function clampZoom(nextZoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(`kiwi-mermaid-${Math.random().toString(36).slice(2)}`);
  const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setSvg(null);
      setError(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });

      try {
        const mermaid = await ensureInit();
        const rendered = await mermaid.render(renderIdRef.current, chart);
        if (cancelled) return;

        bindFunctionsRef.current = rendered.bindFunctions;
        setSvg(rendered.svg);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !svg) return;

    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: block; }
      svg { display: block; width: 100%; max-width: 100%; height: auto; }
    </style>${svg}`;
    const svgEl = root.querySelector("svg");
    if (svgEl) bindFunctionsRef.current?.(svgEl);
  }, [svg]);

  // Scroll-wheel zoom (also handles trackpad pinch via ctrlKey)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => clampZoom(z + delta));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svg]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = viewportRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    el.style.cursor = "grabbing";
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({
      x: d.startPanX + (e.clientX - d.startX),
      y: d.startPanY + (e.clientY - d.startY),
    });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    const el = viewportRef.current;
    if (el) {
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = "grab";
    }
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (error) {
    return (
      <figure className="kiwi-mermaid rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <figcaption className="mb-2 text-sm font-medium text-destructive">
          Mermaid render error
        </figcaption>
        <pre className="overflow-x-auto text-xs">
          <code>{error}</code>
        </pre>
      </figure>
    );
  }

  const isDefaultView = zoom === 1 && pan.x === 0 && pan.y === 0;

  return (
    <figure className="kiwi-mermaid relative rounded-md border border-border bg-card p-4">
      {svg ? (
        <>
          <div
            className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 text-xs shadow-md"
            aria-label="Mermaid diagram zoom controls"
          >
            <button
              type="button"
              className="h-7 w-7 rounded-sm border border-border bg-card font-semibold leading-none hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zoom out Mermaid diagram"
              title="Zoom out"
            >
              −
            </button>
            <span className="min-w-12 px-1.5 py-1 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            {!isDefaultView && (
              <button
                type="button"
                className="rounded-sm border border-border bg-card px-2 py-1 font-medium hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                onClick={resetView}
                aria-label="Reset Mermaid diagram zoom"
                title="Reset zoom and pan"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              className="h-7 w-7 rounded-sm border border-border bg-card font-semibold leading-none hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom in Mermaid diagram"
              title="Zoom in"
            >
              +
            </button>
          </div>
          <div
            ref={viewportRef}
            className="overflow-hidden pt-10"
            style={{ cursor: "grab", touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div
              ref={containerRef}
              className="mx-auto origin-center"
              style={{
                width: `${zoom * 100}%`,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            />
          </div>
          {!isDefaultView && (
            <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground">
              drag to pan · Ctrl+scroll to zoom
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          Rendering Mermaid diagram&hellip;
        </div>
      )}
    </figure>
  );
}
