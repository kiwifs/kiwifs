import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { Tree, NodeApi, type NodeRendererProps } from "react-arborist";
import { useDraggable } from "@dnd-kit/core";
import { getCurrentSpace } from "../lib/api";
import { TreeSkeleton } from "./TreeSkeleton";
import { TreeRowShell, TREE_INDENT } from "./tree/TreeRow";
import {
  buildFlatTree,
  openFolderRecursive,
  type FlatNode,
  type TreeSortMode,
  DEFAULT_TREE_EXCLUDE_PATTERNS,
} from "@kw/lib/treeTransform";
import {
  clearTreeClipboard,
  getTreeClipboard,
  setTreeClipboard,
} from "@kw/lib/treeClipboard";
import {
  ChevronRight,
  Copy,
  File,
  FileAxis3D,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileArchive,
  Folder,
  FolderOpen,
  Move,
  PenTool,
  Plus,
  Trash2,
  Upload,
  ExternalLink,
  Rss,
} from "lucide-react";
import { cn } from "@kw/lib/cn";
import { api, type TreeEntry } from "@kw/lib/api";
import { isMarkdown, isCanvasFile, isExcalidrawFile, stem, stripTrailingSlash, dirOf } from "@kw/lib/paths";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@kw/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kw/components/ui/dialog";
import { Button } from "@kw/components/ui/button";
import { Input } from "@kw/components/ui/input";
import { Label } from "@kw/components/ui/label";
import { type TreeRevealRequest } from "@kw/lib/treeReveal";
import { createTreePageDragData } from "@kw/lib/kanbanDnd";
import { useFileOpsStore } from "@kw/stores/fileOpsStore";

type Props = {
  activePath: string | null;
  revealRequest?: TreeRevealRequest | null;
  onSelect: (path: string) => void;
  refreshKey?: number;
  onCreateChild?: (folder: string) => void;
  onDeleted?: () => void;
  onDuplicated?: (newPath: string) => void;
  onMoved?: (newPath: string) => void;
  enableKanbanDrag?: boolean;
  filterQuery?: string;
  compactFolders?: boolean;
  sortMode?: TreeSortMode;
  enableFileNesting?: boolean;
  excludePatterns?: string[];
  autoReveal?: boolean;
  publishedPaths?: Set<string>;
  onPublishedChanged?: () => void;
};

export type KiwiTreeHandle = {
  collapseAll: () => void;
};

function nodeLabel(data: FlatNode): string {
  if (data.displayName) return data.displayName;
  if (isCanvasFile(data.id)) return data.name.replace(/\.canvas\.json$/i, "");
  if (isExcalidrawFile(data.id)) return data.name.replace(/\.excalidraw\.md$/i, "");
  if (isMarkdown(data.id)) return stem(data.name);
  return data.name;
}

function isKiwiConfig(name: string): boolean {
  return name === ".kiwi";
}

const FOLDER_EXPAND_DELAY_MS = 600;

type OsDragTarget = {
  /** Path of the row to visually highlight (always a folder, or "" for root). */
  rowPath: string;
  /** Directory path that files will actually be uploaded to. */
  dropDir: string;
};

function isOsFileDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

function isProtectedDropPath(path: string): boolean {
  const clean = stripTrailingSlash(path);
  return clean === ".kiwi" || clean.startsWith(".kiwi/");
}

/** Resolve upload folder for a tree row; null = drop not allowed (e.g. `.kiwi`). */
function osDropDirForNode(path: string, isDir: boolean): string | null {
  if (isDir) {
    return isProtectedDropPath(path) ? null : path;
  }
  const parent = dirOf(path);
  return isProtectedDropPath(parent) ? null : parent;
}

function osDropRowClass(
  willReceiveInternal: boolean,
  fileDragActive: boolean,
): string {
  // OS file drop highlight is handled via CSS injection (dynamic <style>)
  // to bypass react-arborist's row memoization. This function only handles
  // react-arborist's internal tree DnD highlight (willReceiveDrop).
  if (willReceiveInternal && !fileDragActive) return "bg-accent/70";
  return "";
}

function treeSearchMatch(node: NodeApi<FlatNode>, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    node.id.toLowerCase().includes(q) ||
    node.data.name.toLowerCase().includes(q) ||
    (node.data.displayName?.toLowerCase().includes(q) ?? false)
  );
}

function treeErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("502") || lower.includes("bad gateway"))
    return "Cannot reach the workspace server";
  if (lower.includes("404") || lower.includes("not found"))
    return "This workspace could not be found. It may have been removed or the URL is incorrect.";
  if (lower.includes("401") || lower.includes("unauthorized"))
    return "Your session has expired. Please refresh the page to sign in again.";
  if (lower.includes("403") || lower.includes("forbidden"))
    return "You don't have access to this workspace.";
  if (lower.includes("503") || lower.includes("unavailable"))
    return "The workspace server is temporarily unavailable. Please try again shortly.";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econnrefused") || lower.includes("failed to fetch"))
    return "Unable to connect. Please check your internet connection.";
  if (lower.includes("timeout"))
    return "The request timed out. The server may be under heavy load.";
  return "Something went wrong loading the file tree. Please try again.";
}

function collectFiles(entry: TreeEntry): string[] {
  const out: string[] = [];
  for (const c of entry.children || []) {
    if (c.isDir) out.push(...collectFiles(c));
    else out.push(c.path);
  }
  return out;
}

function findEntry(root: TreeEntry, path: string): TreeEntry | null {
  const clean = stripTrailingSlash(root.path);
  if (clean === path) return root;
  for (const c of root.children || []) {
    const found = findEntry(c, path);
    if (found) return found;
  }
  return null;
}

type PromptDialog = {
  title: string;
  description: string;
  value: string;
  onConfirm: (value: string) => void;
};

type ConfirmDialog = {
  title: string;
  description: string;
  destructive?: boolean;
  onConfirm: () => void;
};

export const KiwiTree = forwardRef<KiwiTreeHandle, Props>(function KiwiTree(
  {
    activePath,
    revealRequest,
    onSelect,
    refreshKey,
    onCreateChild,
    onDeleted,
    onDuplicated,
    onMoved,
    enableKanbanDrag = false,
    filterQuery = "",
    compactFolders = true,
    sortMode = "name",
    enableFileNesting = true,
    excludePatterns = DEFAULT_TREE_EXCLUDE_PATTERNS,
    autoReveal = true,
    publishedPaths,
    onPublishedChanged,
  },
  ref,
) {
  const [root, setRoot] = useState<TreeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const treeRef = useRef<any>(null);

  const [dupOpen, setDupOpen] = useState(false);
  const [dupSource, setDupSource] = useState("");
  const [dupTarget, setDupTarget] = useState("");
  const [dupBusy, setDupBusy] = useState(false);

  const [promptDialog, setPromptDialog] = useState<PromptDialog | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);

  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [dragTarget, setDragTarget] = useState<OsDragTarget | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepthRef = useRef(0);
  const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const pushOp = useFileOpsStore((s) => s.push);

  useImperativeHandle(ref, () => ({
    collapseAll: () => treeRef.current?.closeAll(),
  }));

  // Callback ref: attach ResizeObserver whenever the container div mounts.
  // This solves the race where the first render shows TreeSkeleton (root=null)
  // and the container div doesn't exist yet for a useLayoutEffect([]) to observe.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) setContainerHeight(h);
      }
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  function openPromptDialog(d: PromptDialog) {
    setPromptValue(d.value);
    setPromptDialog(d);
  }

  function openDupDialog(srcPath: string) {
    setDupSource(srcPath);
    setDupTarget(srcPath.replace(/\.md$/i, "-copy.md"));
    setDupOpen(true);
  }

  function handleDuplicate() {
    let target = dupTarget.trim();
    if (!target) return;
    if (!target.endsWith(".md")) target += ".md";
    setDupBusy(true);
    api
      .readFile(dupSource)
      .then(({ content }) =>
        api.writeFile(target, content).then(() => {
          setDupOpen(false);
          onDuplicated?.(target);
        }),
      )
      .catch(() => {})
      .finally(() => setDupBusy(false));
  }

  useEffect(() => {
    api
      .tree("/")
      .then((t) => {
        setRoot(t);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [refreshKey, retryCount]);

  // Reveal support: open parents when reveal request comes in
  useEffect(() => {
    if (!revealRequest?.path || !treeRef.current) return;
    treeRef.current.openParents(revealRequest.path);
    setTimeout(() => {
      const node = treeRef.current?.get(revealRequest.path);
      node?.focus();
      node?.scrollTo();
    }, 50);
  }, [revealRequest]);

  // Auto-reveal active file in tree (VS Code explorer.autoReveal)
  useEffect(() => {
    if (!autoReveal || !activePath || !treeRef.current) return;
    treeRef.current.openParents(activePath);
    const t = setTimeout(() => {
      treeRef.current?.scrollTo(activePath);
    }, 30);
    return () => clearTimeout(t);
  }, [activePath, autoReveal, refreshKey]);

  const data = useMemo(() => {
    if (!root) return [];
    const built = buildFlatTree(root, {
      compactFolders,
      sortMode,
      enableFileNesting,
      excludePatterns,
    });
    return built;
  }, [root, compactFolders, sortMode, enableFileNesting, excludePatterns]);

  const initialOpenState = useMemo(() => {
    const map: Record<string, boolean> = { "": true };
    return map;
  }, []);

  const handleMove = useCallback(
    async (args: {
      dragIds: string[];
      parentId: string | null;
      index: number;
    }) => {
      const src = args.dragIds[0];
      if (!src) return;
      const fileName = src.split("/").pop()!;
      const destDir = args.parentId || "";
      const dest = destDir ? `${destDir}/${fileName}` : fileName;
      if (src === dest) return;

      try {
        const { content } = await api.readFile(src);
        await api.writeFile(dest, content);
        await api.deleteFile(src);
        pushOp({ type: "move", from: src, to: dest, content });
        onMoved?.(dest);
      } catch (e) {
        console.error("Move failed:", e);
      }
    },
    [onMoved, pushOp],
  );

  const handleRename = useCallback(
    async (args: { id: string; name: string; node: NodeApi<FlatNode> }) => {
      const oldPath = args.id;
      const dir = dirOf(oldPath);
      let newName = args.name;

      if (args.node.data.isDir) {
        const newPath = dir ? `${dir}/${newName}` : newName;
        if (newPath === oldPath) return;
        const entry = root ? findEntry(root, oldPath) : null;
        if (!entry) return;
        const files = collectFiles(entry);
        await api.renameDir(oldPath, newPath, files);
        onMoved?.(newPath);
      } else {
        if (isMarkdown(oldPath) && !newName.endsWith(".md")) newName += ".md";
        const newPath = dir ? `${dir}/${newName}` : newName;
        if (newPath === oldPath) return;
        const { content } = await api.readFile(oldPath);
        await api.writeFile(newPath, content);
        await api.deleteFile(oldPath);
        pushOp({ type: "move", from: oldPath, to: newPath, content });
        onMoved?.(newPath);
      }
    },
    [root, onMoved, pushOp],
  );

  const handleDelete = useCallback(
    async (args: { ids: string[]; nodes: NodeApi<FlatNode>[] }) => {
      const snapshots: { path: string; content: string }[] = [];
      const filesToDelete: string[] = [];

      for (const node of args.nodes) {
        if (node.data.isDir) {
          const entry = root ? findEntry(root, node.id) : null;
          if (entry) {
            const files = collectFiles(entry);
            for (const f of files) {
              try {
                const { content } = await api.readFile(f);
                snapshots.push({ path: f, content });
                filesToDelete.push(f);
              } catch {}
            }
          }
        } else {
          try {
            const { content } = await api.readFile(node.id);
            snapshots.push({ path: node.id, content });
            filesToDelete.push(node.id);
          } catch {}
        }
      }

      for (const f of filesToDelete) {
        await api.deleteFile(f).catch(() => {});
      }

      if (snapshots.length > 0) {
        pushOp({ type: "delete", snapshots });
      }
      onDeleted?.();
    },
    [root, onDeleted, pushOp],
  );

  const clearDragExpandTimer = useCallback(() => {
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
  }, []);

  const resetFileDrag = useCallback(() => {
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    setDragTarget(null);
    clearDragExpandTimer();
  }, [clearDragExpandTimer]);

  useEffect(() => {
    const onDragEnd = () => resetFileDrag();
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragend", onDragEnd);
      clearDragExpandTimer();
    };
  }, [resetFileDrag, clearDragExpandTimer]);

  const importCanvasFile = useCallback(
    async (file: File, targetDir: string) => {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      const canvasPath = targetDir
        ? `${targetDir}/${file.name}`
        : file.name;
      await api.saveCanvas(canvasPath, data);
      pushOp({ type: "upload", path: canvasPath });
      try {
        localStorage.setItem("kiwifs-last-canvas", canvasPath);
      } catch {}
      onMoved?.("");
      onSelect(canvasPath);
    },
    [pushOp, onMoved, onSelect],
  );

  const uploadFiles = useCallback(
    async (files: File[], targetDir: string) => {
      if (files.length === 0) return;

      const canvasFiles = files.filter((f) =>
        f.name.toLowerCase().endsWith(".canvas.json"),
      );
      const regularFiles = files.filter(
        (f) => !f.name.toLowerCase().endsWith(".canvas.json"),
      );

      for (const cf of canvasFiles) {
        try {
          await importCanvasFile(cf, targetDir);
          setUploadStatus(`Imported canvas "${cf.name.replace(/\.canvas\.json$/i, "")}"`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setUploadStatus(`Canvas import failed: ${msg}`);
        }
      }

      if (regularFiles.length > 0) {
        setUploadStatus(`Uploading ${regularFiles.length} file(s)...`);
        try {
          const paths = await api.uploadAssets(regularFiles, targetDir);
          for (const p of paths) {
            pushOp({ type: "upload", path: p.replace(/^\/raw\//, "") });
          }
          setUploadStatus(`Uploaded ${regularFiles.length} file(s)`);
          onMoved?.("");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setUploadStatus(`Upload failed: ${msg}`);
        }
      }

      setTimeout(() => setUploadStatus(null), 3000);
    },
    [pushOp, onMoved, importCanvasFile],
  );

  const handleContainerDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isOsFileDrag(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const targetDir = dragTarget?.dropDir ?? "";
      resetFileDrag();
      await uploadFiles(files, targetDir);
    },
    [dragTarget, uploadFiles, resetFileDrag],
  );

  const handleFileDragEnter = useCallback((e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  }, []);

  const handleFileDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!isOsFileDrag(e)) return;
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) resetFileDrag();
    },
    [resetFileDrag],
  );

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    // Only fall back to root when the cursor is genuinely over empty space.
    // When over a tree row, handleNodeDragOver already set the correct target;
    // avoid overriding it here.
    const el = e.target;
    if (el instanceof Element && el.closest("[data-row-path]")) return;
    setDragTarget({ rowPath: "", dropDir: "" });
  }, []);

  const scheduleFolderExpand = useCallback(
    (folderPath: string, isOpen: boolean) => {
      if (isOpen) return;
      clearDragExpandTimer();
      dragExpandTimerRef.current = setTimeout(() => {
        treeRef.current?.open(folderPath);
      }, FOLDER_EXPAND_DELAY_MS);
    },
    [clearDragExpandTimer],
  );

  const handleNodeDragOver = useCallback(
    (
      e: React.DragEvent,
      nodePath: string,
      isDir: boolean,
      isOpen: boolean,
    ) => {
      if (!isOsFileDrag(e)) return;
      const dropDir = osDropDirForNode(nodePath, isDir);
      if (dropDir === null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      // VS Code pattern: highlight the *folder* that will receive the drop,
      // not individual files. For files, that's their parent folder row.
      // For root-level files (dropDir=""), rowPath="" triggers the container highlight.
      const highlightRow = isDir ? nodePath : dropDir;
      setDragTarget((prev) => {
        if (prev?.rowPath !== highlightRow) {
          if (isDir) scheduleFolderExpand(nodePath, isOpen);
          else clearDragExpandTimer();
        }
        return { rowPath: highlightRow, dropDir };
      });
    },
    [scheduleFolderExpand, clearDragExpandTimer],
  );

  const handleNodeDrop = useCallback(
    async (e: React.DragEvent, nodePath: string, isDir: boolean) => {
      if (!isOsFileDrag(e)) return;
      const dropDir = osDropDirForNode(nodePath, isDir);
      if (dropDir === null) return;
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      resetFileDrag();
      await uploadFiles(files, dropDir);
    },
    [uploadFiles, resetFileDrag],
  );

  // Copy / cut / paste (VS Code-style) when tree has focus
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      const tree = treeRef.current;
      if (!tree?.hasFocus) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "c") {
        const paths = tree.selectedNodes
          .filter((n: NodeApi<FlatNode>) => !n.data.isDir && !isProtectedDropPath(n.id))
          .map((n: NodeApi<FlatNode>) => n.id);
        if (paths.length === 0) return;
        e.preventDefault();
        const entries = await Promise.all(
          paths.map(async (path: string) => {
            const { content } = await api.readFile(path);
            return { path, content };
          }),
        );
        setTreeClipboard({ mode: "copy", entries });
      } else if (mod && key === "x") {
        const paths = tree.selectedNodes
          .filter((n: NodeApi<FlatNode>) => !n.data.isDir && !isProtectedDropPath(n.id))
          .map((n: NodeApi<FlatNode>) => n.id);
        if (paths.length === 0) return;
        e.preventDefault();
        const entries = await Promise.all(
          paths.map(async (path: string) => {
            const { content } = await api.readFile(path);
            return { path, content };
          }),
        );
        setTreeClipboard({ mode: "cut", entries });
      } else if (mod && key === "v") {
        const clip = getTreeClipboard();
        if (!clip || clip.entries.length === 0) return;
        e.preventDefault();
        const focus = tree.focusedNode;
        let targetDir = "";
        if (focus) {
          targetDir = focus.data.isDir && !focus.data.virtualDir
            ? focus.id
            : dirOf(focus.id);
        }
        if (isProtectedDropPath(targetDir)) return;
        for (const entry of clip.entries) {
          const base = entry.path.split("/").pop() || entry.path;
          let dest = targetDir ? `${targetDir}/${base}` : base;
          if (entry.content != null) {
            try {
              await api.readFile(dest);
              const dot = base.lastIndexOf(".");
              const stamped =
                dot > 0
                  ? `${base.slice(0, dot)}-copy${base.slice(dot)}`
                  : `${base}-copy`;
              dest = targetDir ? `${targetDir}/${stamped}` : stamped;
            } catch {
              /* destination free */
            }
            await api.writeFile(dest, entry.content);
            if (clip.mode === "cut") {
              await api.deleteFile(entry.path).catch(() => {});
            }
          }
        }
        if (clip.mode === "cut") clearTreeClipboard();
        onMoved?.("");
      } else if (mod && key === "a") {
        e.preventDefault();
        tree.selectAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onMoved, root]);

  if (error) {
    const friendlyMsg = treeErrorMessage(error);
    return (
      <div className="p-4 text-center space-y-2">
        <p className="text-sm text-muted-foreground">{friendlyMsg}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRetryCount((c) => c + 1);
          }}
          className="text-xs text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!root) {
    return <TreeSkeleton />;
  }

  const ROW_HEIGHT = 30;
  // VS Code pattern: highlight the folder that will receive the drop.
  // We use a CSS-injected approach because react-arborist memoizes rows,
  // so React state changes won't cause the *parent folder* row to re-render.
  // Instead, we inject a <style> targeting `[data-row-path="..."]` which
  // the browser applies immediately without needing React re-renders.
  const dropTargetPath = fileDragActive ? dragTarget?.rowPath ?? null : null;
  const isRootDropTarget = dropTargetPath === "";

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative text-sm flex-1 min-h-0 kiwi-tree-panel transition-colors",
        isRootDropTarget && "bg-accent/40",
      )}
      onDragEnter={handleFileDragEnter}
      onDragLeave={handleFileDragLeave}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
    >
      {dropTargetPath != null && dropTargetPath !== "" && (
        <style>{`.kiwi-tree-panel [data-row-path="${CSS.escape(dropTargetPath)}"] > [aria-hidden] { background-color: var(--accent) !important; }`}</style>
      )}
      {uploadStatus && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md mb-2">
          {uploadStatus}
        </div>
      )}

      <Tree<FlatNode>
        ref={treeRef}
        data={data}
        idAccessor="id"
        childrenAccessor="children"
        openByDefault={false}
        initialOpenState={initialOpenState}
        width="100%"
        height={containerHeight || 400}
        rowHeight={ROW_HEIGHT}
        rowClassName="kiwi-tree-item"
        indent={TREE_INDENT}
        paddingTop={2}
        paddingBottom={8}
        selection={activePath || undefined}
        selectionFollowsFocus
        searchTerm={filterQuery.trim()}
        searchMatch={treeSearchMatch}
        disableDrag={enableKanbanDrag}
        disableEdit={(d) => isKiwiConfig(d.name) || !!d.virtualDir}
        renderCursor={DropCursor}
        onMove={handleMove}
        onRename={handleRename}
        onDelete={handleDelete}
        onActivate={(node) => {
          if (node.data.virtualDir || isMarkdown(node.id)) onSelect(node.id);
          else if (!node.data.isDir) onSelect(node.id);
        }}
      >
        {(props) => (
          <TreeNode
            {...props}
            activePath={activePath}
            revealRequest={revealRequest}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            openDupDialog={openDupDialog}
            onMoved={onMoved}
            onDeleted={onDeleted}
            openPromptDialog={openPromptDialog}
            openConfirmDialog={setConfirmDialog}
            enableKanbanDrag={enableKanbanDrag}
            pushOp={pushOp}
            root={root}
            fileDragActive={fileDragActive}
            onNodeDragOver={handleNodeDragOver}
            onNodeDrop={handleNodeDrop}
            onFolderAltClick={(data) => openFolderRecursive(treeRef.current, data)}
            publishedPaths={publishedPaths}
            onPublishedChanged={onPublishedChanged}
          />
        )}
      </Tree>

      {/* Dialogs */}
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate page</DialogTitle>
            <DialogDescription>
              Enter the path for the new copy.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tree-dup-path">New path</Label>
            <Input
              id="tree-dup-path"
              autoFocus
              value={dupTarget}
              onChange={(e) => setDupTarget(e.target.value)}
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDuplicate();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDuplicate}
              disabled={dupBusy || !dupTarget.trim()}
            >
              {dupBusy ? "Duplicating..." : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!promptDialog}
        onOpenChange={(open) => {
          if (!open) setPromptDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{promptDialog?.title}</DialogTitle>
            <DialogDescription>{promptDialog?.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter" && promptValue.trim() && promptDialog) {
                  promptDialog.onConfirm(promptValue.trim());
                  setPromptDialog(null);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromptDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (promptValue.trim() && promptDialog) {
                  promptDialog.onConfirm(promptValue.trim());
                  setPromptDialog(null);
                }
              }}
              disabled={!promptValue.trim()}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!alertMessage}
        onOpenChange={(open) => {
          if (!open) setAlertMessage(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conflict</DialogTitle>
            <DialogDescription>{alertMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAlertMessage(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>{confirmDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog(null)}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog?.destructive ? "destructive" : "default"}
              onClick={() => {
                confirmDialog?.onConfirm();
                setConfirmDialog(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

type TreeNodeProps = NodeRendererProps<FlatNode> & {
  activePath: string | null;
  revealRequest?: TreeRevealRequest | null;
  onSelect: (path: string) => void;
  onCreateChild?: (folder: string) => void;
  openDupDialog: (srcPath: string) => void;
  onMoved?: (newPath: string) => void;
  onDeleted?: () => void;
  openPromptDialog: (d: PromptDialog) => void;
  openConfirmDialog: (d: ConfirmDialog) => void;
  enableKanbanDrag: boolean;
  pushOp: (op: import("@kw/stores/fileOpsStore").FileOp) => void;
  root: TreeEntry;
  fileDragActive: boolean;
  onNodeDragOver: (
    e: React.DragEvent,
    nodePath: string,
    isDir: boolean,
    isOpen: boolean,
  ) => void;
  onNodeDrop: (e: React.DragEvent, nodePath: string, isDir: boolean) => void;
  onFolderAltClick: (data: FlatNode) => void;
  publishedPaths?: Set<string>;
  onPublishedChanged?: () => void;
};

function TreeNode({
  node,
  dragHandle,
  activePath,
  revealRequest,
  onSelect,
  onCreateChild,
  openDupDialog,
  onMoved,
  onDeleted,
  openPromptDialog,
  openConfirmDialog,
  enableKanbanDrag,
  pushOp,
  root,
  fileDragActive,
  onNodeDragOver,
  onNodeDrop,
  onFolderAltClick,
  publishedPaths,
  onPublishedChanged,
}: TreeNodeProps) {
  const path = node.id;
  const isActive = activePath === path;
  const isKiwi = isKiwiConfig(node.data.name);
  const osDropHighlight = osDropRowClass(
    node.willReceiveDrop,
    fileDragActive,
  );
  const osDropHandlers = {
    onDragOver: (e: React.DragEvent) =>
      onNodeDragOver(e, path, node.data.isDir, node.isOpen),
    onDrop: (e: React.DragEvent) => onNodeDrop(e, path, node.data.isDir),
  };
  const label = nodeLabel(node.data);
  const showChevron = node.data.isDir && (node.data.children?.length ?? 0) > 0;
  const isPublished = !node.data.isDir && isMarkdown(path) && (publishedPaths?.has(path) ?? false);
  const folderMarkdownFiles = node.data.isDir ? collectFlatMarkdownFiles(node.data) : [];
  const folderPublishedCount = node.data.isDir ? folderMarkdownFiles.filter((p) => publishedPaths?.has(p)).length : 0;

  // kanban draggable (separate from tree DnD)
  const kanbanDraggable = useDraggable({
    id: `tree-page:${path}`,
    data: createTreePageDragData(path, stem(node.data.name)),
    disabled: !enableKanbanDrag || node.data.isDir || !isMarkdown(path),
  });

  const handleUploadToFolder = useCallback(
    (folder: string) => {
      if (isProtectedDropPath(folder)) return;
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;
        try {
          const paths = await api.uploadAssets(files, folder);
          for (const p of paths) {
            pushOp({ type: "upload", path: p.replace(/^\/raw\//, "") });
          }
          onMoved?.("");
        } catch (e) {
          console.error("Upload failed:", e);
        }
      };
      input.click();
    },
    [pushOp, onMoved],
  );

  if (node.data.isDir) {
    const isVirtual = !!node.data.virtualDir;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={dragHandle} className="h-full w-full">
            <TreeRowShell
              node={node}
              revealRequest={revealRequest}
              isActive={isActive}
              osDropHighlight={osDropHighlight}
              {...osDropHandlers}
              onClick={(e) => {
                e.stopPropagation();
                if (isVirtual) {
                  onSelect(path);
                  return;
                }
                if (e.altKey) {
                  onFolderAltClick(node.data);
                  return;
                }
                node.toggle();
              }}
            >
              {showChevron ? (
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
                    node.isOpen && "rotate-90",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    node.toggle();
                  }}
                />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {isVirtual ? (
                <File className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : node.isOpen ? (
                <FolderOpen
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isKiwi ? "text-emerald-500" : "text-primary",
                  )}
                />
              ) : (
                <Folder
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isKiwi ? "text-emerald-500/70" : "text-muted-foreground",
                  )}
                />
              )}
              {node.isEditing ? (
                <RenameInput node={node} />
              ) : (
                <span
                  className={cn(
                    "truncate text-sm",
                    isKiwi && "text-emerald-600 dark:text-emerald-400 font-medium",
                  )}
                >
                  {label}
                </span>
              )}
              {onCreateChild && !node.isEditing && !isVirtual && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateChild(path);
                  }}
                  className="opacity-0 group-hover:opacity-100 h-5 w-5 shrink-0 grid place-items-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all ml-auto"
                  title={`New page in ${node.data.name}`}
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </TreeRowShell>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCreateChild?.(path)}>
            <Plus className="h-3.5 w-3.5" />
            New page in {node.data.name}
          </ContextMenuItem>
          {!isKiwi && (
            <ContextMenuItem onClick={() => handleUploadToFolder(path)}>
              <Upload className="h-3.5 w-3.5" />
              Upload files to {node.data.name}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => onSelect(path)}>
            <File className="h-3.5 w-3.5" />
            Open folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={folderMarkdownFiles.length === 0 || folderPublishedCount === folderMarkdownFiles.length}
            onClick={() => {
              publishMany(folderMarkdownFiles, true)
                .then(() => onPublishedChanged?.())
                .catch((e) => console.error("Failed to publish folder:", e));
            }}
          >
            <Rss className="h-3.5 w-3.5" />
            Publish folder ({folderMarkdownFiles.length})
          </ContextMenuItem>
          <ContextMenuItem
            disabled={folderPublishedCount === 0}
            onClick={() => {
              publishMany(folderMarkdownFiles.filter((p) => publishedPaths?.has(p)), false)
                .then(() => onPublishedChanged?.())
                .catch((e) => console.error("Failed to unpublish folder:", e));
            }}
          >
            <Rss className="h-3.5 w-3.5" />
            Unpublish folder ({folderPublishedCount})
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => node.edit()}>
            <Move className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              openPromptDialog({
                title: "Move folder",
                description: "Enter the new path for this folder:",
                value: path,
                onConfirm: async (newPath) => {
                  if (newPath === path) return;
                  const entry = findEntry(root, path);
                  if (!entry) return;
                  const files = collectFiles(entry);
                  const cleanPath = newPath.replace(/\/+$/, "");
                  await api.renameDir(path, cleanPath, files);
                  onMoved?.(cleanPath);
                },
              });
            }}
          >
            <Move className="h-3.5 w-3.5" />
            Move
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              const entry = findEntry(root, path);
              if (!entry) return;
              const files = collectFiles(entry);
              if (files.length === 0) {
                openConfirmDialog({
                  title: "Delete folder",
                  description: `Folder "${node.data.name}" is empty or contains only sub-folders. Nothing to delete.`,
                  destructive: false,
                  onConfirm: () => {},
                });
                return;
              }
              openConfirmDialog({
                title: "Delete folder",
                description: `Delete folder "${node.data.name}" and its ${files.length} file(s)?`,
                destructive: true,
                onConfirm: async () => {
                  const snapshots: { path: string; content: string }[] = [];
                  for (const f of files) {
                    try {
                      const { content } = await api.readFile(f);
                      snapshots.push({ path: f, content });
                      await api.deleteFile(f);
                    } catch {}
                  }
                  if (snapshots.length > 0) {
                    pushOp({ type: "delete", snapshots });
                  }
                  onDeleted?.();
                },
              });
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Canvas files open in the canvas view
  if (isCanvasFile(path)) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={dragHandle} className="h-full w-full">
            <TreeRowShell
              node={node}
              revealRequest={revealRequest}
              isActive={isActive}
              osDropHighlight={osDropHighlight}
              onClick={() => onSelect(path)}
              {...osDropHandlers}
            >
              <span className="w-3.5 shrink-0" />
              <FileAxis3D className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {node.isEditing ? <RenameInput node={node} /> : <span className="truncate">{label}</span>}
            </TreeRowShell>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onSelect(path)}>
            <FileAxis3D className="h-3.5 w-3.5" /> Open
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => node.edit()}>
            <Move className="h-3.5 w-3.5" /> Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            openPromptDialog({
              title: "Move canvas",
              description: "Enter the new path:",
              value: path,
              onConfirm: async (newPath) => {
                if (newPath === path) return;
                try {
                  const { content } = await api.readFile(path);
                  await api.writeFile(newPath, content);
                  await api.deleteFile(path);
                  pushOp({ type: "move", from: path, to: newPath, content });
                  onMoved?.(newPath);
                } catch {}
              },
            });
          }}>
            <Move className="h-3.5 w-3.5" /> Move
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => {
            openConfirmDialog({
              title: "Delete canvas",
              description: `Delete "${label}"?`,
              destructive: true,
              onConfirm: async () => {
                try {
                  const { content } = await api.readFile(path);
                  await api.deleteFile(path);
                  pushOp({ type: "delete", snapshots: [{ path, content }] });
                  onDeleted?.();
                } catch (e) { console.error("Failed to delete canvas:", e); }
              },
            });
          }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Excalidraw whiteboard files open in the whiteboard view
  if (isExcalidrawFile(path)) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={dragHandle} className="h-full w-full">
            <TreeRowShell
              node={node}
              revealRequest={revealRequest}
              isActive={isActive}
              osDropHighlight={osDropHighlight}
              onClick={() => onSelect(path)}
              {...osDropHandlers}
            >
              <span className="w-3.5 shrink-0" />
              <PenTool className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {node.isEditing ? <RenameInput node={node} /> : <span className="truncate">{label}</span>}
            </TreeRowShell>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onSelect(path)}>
            <PenTool className="h-3.5 w-3.5" /> Open
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => node.edit()}>
            <Move className="h-3.5 w-3.5" /> Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            openPromptDialog({
              title: "Move whiteboard",
              description: "Enter the new path:",
              value: path,
              onConfirm: async (newPath) => {
                if (newPath === path) return;
                try {
                  const { content } = await api.readFile(path);
                  await api.writeFile(newPath, content);
                  await api.deleteFile(path);
                  pushOp({ type: "move", from: path, to: newPath, content });
                  onMoved?.(newPath);
                } catch {}
              },
            });
          }}>
            <Move className="h-3.5 w-3.5" /> Move
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => {
            openConfirmDialog({
              title: "Delete whiteboard",
              description: `Delete "${label}"?`,
              destructive: true,
              onConfirm: async () => {
                try {
                  const { content } = await api.readFile(path);
                  await api.deleteFile(path);
                  pushOp({ type: "delete", snapshots: [{ path, content }] });
                  onDeleted?.();
                } catch (e) { console.error("Failed to delete whiteboard:", e); }
              },
            });
          }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Non-markdown asset
  if (!isMarkdown(path)) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={dragHandle} className="h-full w-full">
            <TreeRowShell
              node={node}
              revealRequest={revealRequest}
              isActive={false}
              osDropHighlight={osDropHighlight}
              {...osDropHandlers}
            >
              <span className="w-3.5 shrink-0" />
              <a
                href={`/api/kiwi${getCurrentSpace() && getCurrentSpace() !== "default" ? "/" + getCurrentSpace() : ""}/file?path=${encodeURIComponent(path)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 min-w-0 flex-1"
                onClick={(e) => e.stopPropagation()}
              >
                <AssetIcon name={node.data.name} />
                <span className="truncate">{label}</span>
              </a>
            </TreeRowShell>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => node.edit()}>
            <Move className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              openPromptDialog({
                title: "Move file",
                description: "Enter the new path:",
                value: path,
                onConfirm: async (newPath) => {
                  if (newPath === path) return;
                  try {
                    const { content } = await api.readFile(path);
                    await api.writeFile(newPath, content);
                    await api.deleteFile(path);
                    pushOp({ type: "move", from: path, to: newPath, content });
                    onMoved?.(newPath);
                  } catch {}
                },
              });
            }}
          >
            <Move className="h-3.5 w-3.5" />
            Move
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={async () => {
              openConfirmDialog({
                title: "Delete file",
                description: `Delete "${node.data.name}"?`,
                destructive: true,
                onConfirm: async () => {
                  try {
                    const { content } = await api.readFile(path);
                    await api.deleteFile(path);
                    pushOp({ type: "delete", snapshots: [{ path, content }] });
                    onDeleted?.();
                  } catch (e) {
                    console.error("Failed to delete file:", e);
                  }
                },
              });
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Markdown page
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={(el) => {
            if (dragHandle) dragHandle(el);
            if (enableKanbanDrag) kanbanDraggable.setNodeRef(el);
          }}
          className="h-full w-full"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/kiwi-path", path);
            e.dataTransfer.effectAllowed = "copyLink";
          }}
          {...(enableKanbanDrag ? { ...kanbanDraggable.attributes, ...kanbanDraggable.listeners } : {})}
        >
          <TreeRowShell
            node={node}
            revealRequest={revealRequest}
            isActive={isActive}
            osDropHighlight={osDropHighlight}
            isPublished={isPublished}
            onClick={() => onSelect(path)}
            {...osDropHandlers}
          >
            <span className="w-3.5 shrink-0" />
            {isPublished ? (
              <Rss className="h-3.5 w-3.5 text-primary shrink-0" />
            ) : (
              <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            {node.isEditing ? (
              <RenameInput node={node} />
            ) : (
              <span className="truncate flex-1">{label}</span>
            )}
            {isPublished && !node.isEditing && (
              <span className="ml-auto relative flex h-1.5 w-1.5 shrink-0" title="Published">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
            )}
          </TreeRowShell>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onSelect(path)}>
          <File className="h-3.5 w-3.5" />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isPublished ? (
          <>
            <ContextMenuItem
              onClick={() => {
                navigator.clipboard
                  .writeText(window.location.origin + "/p/" + path)
                  .catch((e) => console.error("Failed to copy public link:", e));
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy public link
            </ContextMenuItem>
            <ContextMenuItem onClick={() => window.open("/p/" + path, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5" />
              View published page
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                api.unpublish(path)
                  .then(() => onPublishedChanged?.())
                  .catch((e) => console.error("Failed to unpublish page:", e));
              }}
            >
              <Rss className="h-3.5 w-3.5" />
              Unpublish
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem
            onClick={() => {
              api.publish(path)
                .then(() => onPublishedChanged?.())
                .catch((e) => console.error("Failed to publish page:", e));
            }}
          >
            <Rss className="h-3.5 w-3.5" />
            Publish
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => openDupDialog(path)}>
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onClick={() => node.edit()}>
          <Move className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            openPromptDialog({
              title: "Move / Rename",
              description: "Enter the new path:",
              value: path,
              onConfirm: async (newPath) => {
                if (newPath === path) return;
                const finalPath = newPath.endsWith(".md") ? newPath : newPath + ".md";
                try {
                  const { content } = await api.readFile(path);
                  await api.writeFile(finalPath, content);
                  await api.deleteFile(path);
                  pushOp({ type: "move", from: path, to: finalPath, content });
                  onMoved?.(finalPath);
                } catch {}
              },
            });
          }}
        >
          <Move className="h-3.5 w-3.5" />
          Move
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            openConfirmDialog({
              title: "Delete page",
              description: `Delete "${stem(node.data.name)}"?`,
              destructive: true,
              onConfirm: async () => {
                try {
                  const { content } = await api.readFile(path);
                  await api.deleteFile(path);
                  pushOp({ type: "delete", snapshots: [{ path, content }] });
                  onDeleted?.();
                } catch (e) {
                  console.error("Failed to delete file:", e);
                }
              },
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function collectFlatMarkdownFiles(entry: FlatNode): string[] {
  const out: string[] = [];
  const walk = (node: FlatNode) => {
    for (const child of node.children || []) {
      if (child.isDir) walk(child);
      else if (isMarkdown(child.id)) out.push(child.id);
    }
  };
  walk(entry);
  return out;
}

async function publishMany(paths: string[], publish: boolean): Promise<void> {
  if (paths.length === 0) return;
  const result = publish ? await api.publishBulk(paths) : await api.unpublishBulk(paths);
  if (result.errors?.length) {
    const preview = result.errors.slice(0, 5).map((e) => `- ${e.path}: ${e.error}`).join("\n");
    const more = result.errors.length > 5 ? `\n...and ${result.errors.length - 5} more` : "";
    window.alert(
      `${publish ? "Publish" : "Unpublish"} completed with ${result.errors.length} skipped file(s).\n` +
        `Changed: ${result.changed}, skipped: ${result.skipped}.\n\n${preview}${more}`,
    );
  }
}

// ─── Drop cursor (drag indicator line) ──────────────────────────────────────

function DropCursor({ top, left, indent }: { top: number; left: number; indent: number }) {
  return (
    <div
      style={{
        position: "absolute",
        pointerEvents: "none",
        top: top - 2,
        left,
        right: indent,
        display: "flex",
        alignItems: "center",
        zIndex: 1,
      }}
    >
      <div
        className="bg-primary"
        style={{ width: 6, height: 6, borderRadius: "50%" }}
      />
      <div
        className="bg-primary flex-1"
        style={{ height: 2, borderRadius: 1 }}
      />
    </div>
  );
}

// ─── Inline rename input ────────────────────────────────────────────────────

function RenameInput({ node }: { node: NodeApi<FlatNode> }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dotIdx = el.value.lastIndexOf(".");
    el.setSelectionRange(0, dotIdx > 0 ? dotIdx : el.value.length);
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={node.data.name}
      className="flex-1 min-w-0 bg-background border border-input rounded px-1 py-0 text-sm outline-none focus:ring-1 focus:ring-ring"
      onBlur={() => node.reset()}
      onKeyDown={(e) => {
        if (e.key === "Escape") node.reset();
        if (e.key === "Enter") node.submit(e.currentTarget.value);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ─── Asset icon helper ──────────────────────────────────────────────────────

function AssetIcon({ name }: { name: string }) {
  const ext = name.toLowerCase().split(".").pop() || "";
  const cls = "h-3.5 w-3.5 text-muted-foreground shrink-0";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext))
    return <FileImage className={cls} />;
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext))
    return <FileVideo className={cls} />;
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext))
    return <FileAudio className={cls} />;
  if (["zip", "tar", "gz", "tgz", "7z", "rar"].includes(ext))
    return <FileArchive className={cls} />;
  if (
    ["js", "ts", "tsx", "jsx", "py", "go", "rs", "json", "yaml", "yml", "toml"].includes(ext)
  )
    return <FileCode className={cls} />;
  return <FileAxis3D className={cls} />;
}
