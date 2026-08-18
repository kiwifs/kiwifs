import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "@kw/lib/api";
import { isCanvasFile, isExcalidrawFile, titleize } from "@kw/lib/paths";
import { figureClassName, type EmbedDisplay } from "@kw/lib/figureLayout";
import { jsonCanvasToExcalidrawScene, type JSONCanvas } from "@kw/lib/jsonCanvasExcalidraw";
import { ExcalidrawMarkdownPreview } from "./ExcalidrawMarkdownPreview";

type Props = {
  path: string;
  display?: EmbedDisplay;
  onNavigate?: (path: string) => void;
};

function CanvasSvgPreview({ canvas }: { canvas: JSONCanvas }) {
  const scene = useMemo(() => jsonCanvasToExcalidrawScene(canvas), [canvas]);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    import("@excalidraw/excalidraw")
      .then(({ exportToSvg }) =>
        exportToSvg({
          elements: (scene.elements ?? []).filter((el) => el?.isDeleted !== true) as any,
          appState: {
            exportBackground: false,
            exportWithDarkMode: dark,
          },
          files: {},
          exportPadding: 16,
        }),
      )
      .then((node: SVGSVGElement) => {
        if (cancelled) return;
        node.removeAttribute("width");
        node.removeAttribute("height");
        node.setAttribute("style", "display:block;width:100%;height:auto;max-width:100%;");
        setSvg(node.outerHTML);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [scene]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!svg) return <p className="text-sm text-muted-foreground">Rendering canvas…</p>;
  return <div className="kiwi-canvas-embed" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function KiwiEmbed({ path, display, onNavigate }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = isExcalidrawFile(path) ? "excalidraw" : isCanvasFile(path) ? "canvas" : "unknown";
  const shown = display ?? { width: "inline" as const, pin: false };
  const caption = shown.caption || titleize(path);

  useEffect(() => {
    let cancelled = false;
    api.readFile(path)
      .then((res) => {
        if (!cancelled) setContent(res.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const canvas = useMemo<JSONCanvas | null>(() => {
    if (kind !== "canvas" || !content) return null;
    try {
      const parsed = JSON.parse(content) as JSONCanvas;
      if (!Array.isArray(parsed.nodes)) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [kind, content]);

  return (
    <figure className={figureClassName(shown)}>
      <div className="kiwi-figure-media kiwi-embed-frame">
        {error && <p className="text-sm text-destructive p-3">{error}</p>}
        {!error && !content && <p className="text-sm text-muted-foreground p-3">Loading drawing…</p>}
        {content && kind === "excalidraw" && (
          <ExcalidrawMarkdownPreview markdown={content} title={caption} />
        )}
        {content && kind === "canvas" && canvas && <CanvasSvgPreview canvas={canvas} />}
        {content && kind === "unknown" && (
          <p className="text-sm text-muted-foreground p-3">Cannot embed {path}</p>
        )}
        {onNavigate && (
          <button type="button" className="kiwi-embed-open" onClick={() => onNavigate(path)}>
            <ExternalLink className="h-3 w-3" />
            Open to edit
          </button>
        )}
      </div>
      <figcaption className="kiwi-figcaption">
        {caption}
        <span className="kiwi-figsource"> from {path}</span>
      </figcaption>
    </figure>
  );
}
