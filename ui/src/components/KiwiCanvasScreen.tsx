// KiwiCanvasScreen — Multi-canvas hub: list, create, edit.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Network,
  Plus,
} from "lucide-react";
import { api, type CanvasEntry, type TreeEntry } from "@kw/lib/api";
import { Button } from "@kw/components/ui/button";
import { Input } from "@kw/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kw/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kw/components/ui/select";
import { KiwiCanvas } from "./KiwiCanvas";

type Props = {
  initialCanvasPath?: string | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onTreeRefresh?: () => void;
  tree?: TreeEntry | null;
};

const LAST_CANVAS_KEY = "kiwifs-last-canvas";

function canvasPathFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || `canvas-${Date.now()}`;
  return `canvases/${base}.canvas.json`;
}

export function KiwiCanvasScreen({ initialCanvasPath, onClose, onNavigate, onTreeRefresh, tree = null }: Props) {
  const [canvases, setCanvases] = useState<CanvasEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(initialCanvasPath ?? null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const refreshList = useCallback(async () => {
    const res = await api.listCanvases();
    const list = res.canvases ?? [];
    setCanvases(list);
    return list;
  }, []);

  const createCanvas = useCallback(async (name: string) => {
    const path = canvasPathFromName(name);
    setCreating(true);
    try {
      await api.saveCanvas(path, { nodes: [], edges: [] });
      await refreshList();
      setActivePath(path);
      setNewOpen(false);
      setNewName("");
      onTreeRefresh?.();
    } catch (e) {
      console.error("Create canvas failed:", e);
    } finally {
      setCreating(false);
    }
  }, [refreshList, onTreeRefresh]);

  useEffect(() => {
    refreshList()
      .then((list) => {
        if (initialCanvasPath) {
          setActivePath(initialCanvasPath);
        } else if (list.length === 0) {
          createCanvas("Untitled");
        }
      })
      .catch(() => setCanvases([]))
      .finally(() => setListLoading(false));
  }, [refreshList, initialCanvasPath, createCanvas]);

  useEffect(() => {
    if (initialCanvasPath) {
      setActivePath(initialCanvasPath);
    }
  }, [initialCanvasPath]);

  useEffect(() => {
    if (activePath || canvases.length === 0) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LAST_CANVAS_KEY);
    } catch {
      saved = null;
    }
    const pick =
      saved && canvases.some((c) => c.path === saved) ? saved : canvases[0].path;
    setActivePath(pick);
  }, [canvases, activePath]);

  useEffect(() => {
    if (!activePath) return;
    try {
      localStorage.setItem(LAST_CANVAS_KEY, activePath);
    } catch {}
  }, [activePath]);

  const handleCreate = () => createCanvas(newName);

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="font-semibold text-sm">Canvas</div>

        {canvases.length > 0 && (
          <Select value={activePath ?? ""} onValueChange={setActivePath}>
            <SelectTrigger className="h-8 w-48 text-sm">
              <SelectValue placeholder="Select canvas" />
            </SelectTrigger>
            <SelectContent>
              {canvases.map((c) => (
                <SelectItem key={c.path} value={c.path}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New canvas</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {listLoading ? (
          <div className="h-full grid place-items-center text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading canvases...
            </div>
          </div>
        ) : activePath ? (
          <KiwiCanvas
            key={activePath}
            path={activePath}
            embedded
            onNavigate={onNavigate}
            tree={tree}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground">
            <Network className="h-10 w-10 opacity-40" />
            <p className="text-sm max-w-sm">
              No canvases yet. Create a blank board to get started.
            </p>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New canvas
            </Button>
          </div>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New canvas</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="e.g. project-board"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
