import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMermaidEmphasis,
  findMermaidNodes,
  mermaidInitConfig,
  mermaidShadowStyles,
  mermaidThemeKey,
  parseMermaidClicks,
  prepareExportSvg,
  type MermaidThemeKey,
} from "@kw/lib/mermaidTheme";

let mermaidReady = false;
let lastTheme: MermaidThemeKey | "" = "";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

async function getMermaid() {
  const { default: mermaid } = await import("mermaid");
  return mermaid;
}

async function ensureInit(theme: MermaidThemeKey) {
  const mermaid = await getMermaid();
  if (!mermaidReady || lastTheme !== theme) {
    mermaid.initialize(mermaidInitConfig(theme));
    mermaidReady = true;
    lastTheme = theme;
  }
  return mermaid;
}

function clampZoom(nextZoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking in the same turn cancels the download in Safari / some Chromium builds.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

type Props = {
  chart: string;
  focus?: string[];
  dim?: string[];
  onNavigate?: (path: string) => void;
  onNodeClick?: (id: string) => void;
};

export function MermaidDiagram({ chart, focus, dim, onNavigate, onNodeClick }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [theme, setTheme] = useState<MermaidThemeKey>(() => mermaidThemeKey());
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(`kiwi-mermaid-${Math.random().toString(36).slice(2)}`);
  const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = mermaidThemeKey();
      setTheme((prev) => (prev !== next ? next : prev));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setSvg(null);
      setError(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });

      try {
        const mermaid = await ensureInit(theme);
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
  }, [chart, theme]);

  const handleHref = useCallback((href: string, id: string) => {
    onNodeClick?.(id);
    if (!href) return;
    if (href.startsWith("#")) {
      const el = document.getElementById(href.slice(1));
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      window.open(href, "_blank", "noreferrer");
      return;
    }
    const page = href.replace(/^\//, "");
    onNavigate?.(page);
  }, [onNavigate, onNodeClick]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !svg) return;

    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${mermaidShadowStyles()}</style>${svg}`;
    const svgEl = root.querySelector("svg");
    if (svgEl) bindFunctionsRef.current?.(svgEl);

    const clicks = parseMermaidClicks(chart);
    for (const click of clicks) {
      for (const node of findMermaidNodes(root, click.id)) {
        node.setAttribute("data-kiwi-clickable", "true");
        node.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          handleHref(click.href, click.id);
        });
      }
    }
    if (onNodeClick) {
      root.querySelectorAll<SVGGElement>("g.node, g.actor").forEach((el) => {
        const m = el.id.match(/^flowchart-(.+)-(\d+)$/);
        const id = m?.[1] || el.id.replace(/-[0-9]+$/, "");
        if (!id) return;
        el.setAttribute("data-kiwi-clickable", "true");
        el.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onNodeClick(id);
        });
      });
    }
  }, [svg, chart, handleHref, onNodeClick]);

  useEffect(() => {
    const host = containerRef.current;
    const root = host?.shadowRoot;
    if (!root) return;
    applyMermaidEmphasis(root, focus ?? [], dim ?? []);
  }, [svg, focus, dim]);

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

  const exportedSvg = useCallback(() => {
    const root = containerRef.current?.shadowRoot;
    const svgEl = root?.querySelector("svg");
    if (!svgEl) return null;
    return prepareExportSvg(svgEl, theme);
  }, [svg, theme]);

  const downloadSvg = useCallback(() => {
    const exported = exportedSvg();
    if (!exported) return;
    downloadBlob("diagram.svg", new Blob([exported.markup], { type: "image/svg+xml;charset=utf-8" }));
  }, [exportedSvg]);

  const downloadPng = useCallback(() => {
    const exported = exportedSvg();
    if (!exported) return;
    const scale = 2;
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(exported.markup)}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(exported.width, 1) * scale;
      canvas.height = Math.max(exported.height, 1) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = exported.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((png) => {
        if (png) downloadBlob("diagram.png", png);
      }, "image/png");
    };
    img.onerror = () => {
      console.error("Mermaid PNG export failed to rasterize the SVG");
    };
    img.src = dataUrl;
  }, [exportedSvg]);

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
    <figure className="kiwi-mermaid relative rounded-md border border-border bg-card p-2">
      {svg ? (
        <>
          <div
            className="mb-1 flex items-center justify-end gap-1 px-0.5 text-xs"
            aria-label="Mermaid diagram controls"
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
            <button
              type="button"
              className="rounded-sm border border-border bg-card px-2 py-1 font-medium hover:bg-accent"
              onClick={downloadSvg}
              title="Download SVG"
            >
              SVG
            </button>
            <button
              type="button"
              className="rounded-sm border border-border bg-card px-2 py-1 font-medium hover:bg-accent"
              onClick={downloadPng}
              title="Download PNG"
            >
              PNG
            </button>
          </div>
          <div
            ref={viewportRef}
            className="overflow-hidden"
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
