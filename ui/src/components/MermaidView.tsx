import { MermaidDiagram } from "./MermaidDiagram";

export interface MermaidViewProps {
  chart: string;
  /** Tokens to light up — see `applyMermaidEmphasis`. A comma list also works. */
  focus?: string[] | string;
  dim?: string[] | string;
  onNodeClick?: (id: string) => void;
}

const toList = (v: string[] | string | undefined) =>
  Array.isArray(v) ? v : (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Mermaid for widgets: re-rendering with a new `focus` only repaints emphasis,
 * so a playback step can walk a request path through an existing diagram.
 */
export function MermaidView({ chart, focus, dim, onNodeClick }: MermaidViewProps) {
  return <MermaidDiagram chart={chart} focus={toList(focus)} dim={toList(dim)} onNodeClick={onNodeClick} />;
}
