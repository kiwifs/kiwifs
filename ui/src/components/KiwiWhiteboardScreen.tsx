import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  PenTool,
  Plus,
} from "lucide-react";
import { api, type TreeEntry } from "@kw/lib/api";
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
import {
  parseExcalidrawMarkdown,
  serializeExcalidrawMarkdown,
} from "./ExcalidrawMarkdownPreview";
import "@excalidraw/excalidraw/index.css";

const ExcalidrawCanvas = lazy(() =>
  import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw })),
);

type WhiteboardEntry = { path: string; name: string };

type Props = {
  initialPath?: string | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onTreeRefresh?: () => void;
};

const LAST_WB_KEY = "kiwifs-last-whiteboard";

const EMPTY_EXCALIDRAW_MD = `---
excalidraw-plugin: parsed
---

# Excalidraw Data

## Drawing

\`\`\`json
{"type":"excalidraw","version":2,"source":"kiwifs","elements":[],"appState":{"gridSize":null,"viewBackgroundColor":"#ffffff"},"files":{}}
\`\`\`
`;

function whiteboardPathFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || `whiteboard-${Date.now()}`;
  return `whiteboards/${base}.excalidraw.md`;
}

function collectExcalidrawFiles(entry: TreeEntry, out: WhiteboardEntry[]) {
  if (!entry.isDir && entry.path.endsWith(".excalidraw.md")) {
    const base = entry.path.split("/").pop() ?? entry.path;
    out.push({
      path: entry.path,
      name: base.replace(/\.excalidraw\.md$/i, "") || base,
    });
  }
  if (entry.children) {
    for (const child of entry.children) {
      collectExcalidrawFiles(child, out);
    }
  }
}

function sanitizeAppState(appState: Record<string, any> = {}): Record<string, any> {
  const { collaborators: _c, ...rest } = appState;
  return rest;
}

export function KiwiWhiteboardScreen({ initialPath, onClose, onNavigate: _onNavigate, onTreeRefresh }: Props) {
  const [boards, setBoards] = useState<WhiteboardEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(initialPath ?? null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const refreshList = useCallback(async () => {
    const tree = await api.tree("/");
    const entries: WhiteboardEntry[] = [];
    collectExcalidrawFiles(tree, entries);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    setBoards(entries);
    return entries;
  }, []);

  const createWhiteboard = useCallback(async (name: string) => {
    const path = whiteboardPathFromName(name);
    setCreating(true);
    try {
      await api.writeFile(path, EMPTY_EXCALIDRAW_MD);
      await refreshList();
      setActivePath(path);
      setNewOpen(false);
      setNewName("");
      onTreeRefresh?.();
    } catch (e) {
      console.error("Create whiteboard failed:", e);
    } finally {
      setCreating(false);
    }
  }, [refreshList, onTreeRefresh]);

  useEffect(() => {
    refreshList()
      .then((entries) => {
        if (initialPath) {
          setActivePath(initialPath);
        } else if (entries.length === 0) {
          createWhiteboard("Untitled");
        }
      })
      .catch(() => setBoards([]))
      .finally(() => setListLoading(false));
  }, [refreshList, initialPath, createWhiteboard]);

  useEffect(() => {
    if (initialPath) setActivePath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    if (activePath || boards.length === 0) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(LAST_WB_KEY); } catch { saved = null; }
    const pick = saved && boards.some((b) => b.path === saved) ? saved : boards[0].path;
    setActivePath(pick);
  }, [boards, activePath]);

  useEffect(() => {
    if (!activePath) return;
    try { localStorage.setItem(LAST_WB_KEY, activePath); } catch {}
  }, [activePath]);

  const handleCreate = () => createWhiteboard(newName);

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="font-semibold text-sm">Whiteboard</div>

        {boards.length > 0 && (
          <Select value={activePath ?? ""} onValueChange={setActivePath}>
            <SelectTrigger className="h-8 w-48 text-sm">
              <SelectValue placeholder="Select whiteboard" />
            </SelectTrigger>
            <SelectContent>
              {boards.map((b) => (
                <SelectItem key={b.path} value={b.path}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" size="sm" className="gap-1" onClick={() => setNewOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New whiteboard</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {listLoading ? (
          <div className="h-full grid place-items-center text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading whiteboards...
            </div>
          </div>
        ) : activePath ? (
          <WhiteboardEditor key={activePath} path={activePath} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground">
            <PenTool className="h-10 w-10 opacity-40" />
            <p className="text-sm max-w-sm">
              No whiteboards yet. Create one to start drawing.
            </p>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New whiteboard
            </Button>
          </div>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New whiteboard</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="e.g. architecture-sketch"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WhiteboardEditor({ path }: { path: string }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const etagRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMdRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.readFile(path).then((res) => {
      if (cancelled) return;
      setMarkdown(res.content);
      latestMdRef.current = res.content;
      etagRef.current = res.etag ?? null;
    }).catch(() => {
      if (!cancelled) setMarkdown(null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  const save = useCallback(async (md: string) => {
    setSaving(true);
    try {
      const res = await api.writeFile(path, md, etagRef.current || undefined);
      etagRef.current = res.etag ? `"${res.etag}"` : null;
    } catch (e) {
      console.error("Whiteboard save failed:", e);
    } finally {
      setSaving(false);
    }
  }, [path]);

  const scheduleAutosave = useCallback((md: string) => {
    latestMdRef.current = md;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(latestMdRef.current), 1500);
  }, [save]);

  const scene = useMemo(() => {
    if (!markdown) return null;
    return parseExcalidrawMarkdown(markdown);
  }, [markdown]);

  const handleChange = useCallback(
    (elements: readonly any[], appState: Record<string, any>, files: Record<string, any>) => {
      if (!scene || !markdown) return;
      const nextScene = {
        ...scene,
        elements: [...elements],
        appState: sanitizeAppState({ ...(scene.appState ?? {}), ...appState }),
        files: files ?? {},
      };
      const nextMd = serializeExcalidrawMarkdown(latestMdRef.current, nextScene);
      latestMdRef.current = nextMd;
      scheduleAutosave(nextMd);
    },
    [scene, markdown, scheduleAutosave],
  );

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading whiteboard...
        </div>
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-sm text-destructive">Failed to parse whiteboard data.</div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      {saving && (
        <div className="absolute top-2 right-2 z-50 flex items-center gap-1.5 bg-card/90 border border-border rounded px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving...
        </div>
      )}
      <Suspense fallback={<div className="h-full grid place-items-center text-muted-foreground">Loading Excalidraw...</div>}>
        <ExcalidrawCanvas
          initialData={{
            elements: scene.elements ?? [],
            appState: { ...sanitizeAppState(scene.appState), collaborators: new Map() },
            files: scene.files ?? {},
          }}
          onChange={handleChange}
        />
      </Suspense>
    </div>
  );
}
