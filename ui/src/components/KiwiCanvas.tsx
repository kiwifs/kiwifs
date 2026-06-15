// KiwiCanvas — JSON Canvas renderer using React Flow.
// Excalidraw-in-Markdown (for .md pages) is a separate system — untouched.

import { ArrowLeft } from "lucide-react";
import { Button } from "@kw/components/ui/button";
import { FlowCanvas } from "./canvas/FlowCanvas";
import type { TreeEntry } from "@kw/lib/api";

type Props = {
  path: string | null;
  embedded?: boolean;
  onClose?: () => void;
  onNavigate: (path: string) => void;
  tree?: TreeEntry | null;
};

export function KiwiCanvas({ path, embedded = false, onClose, onNavigate, tree = null }: Props) {
  if (!path) {
    return (
      <div className="h-full grid place-items-center text-muted-foreground text-sm">
        No canvas selected.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {!embedded && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back to pages</span>
            </Button>
          )}
          <div className="font-semibold text-sm">Canvas: {path}</div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <FlowCanvas key={path} path={path} onNavigate={onNavigate} tree={tree} />
      </div>
    </div>
  );
}
