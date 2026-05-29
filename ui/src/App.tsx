import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clock4,
  Columns3,
  Database,
  LayoutGrid,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  PenTool,
  Presentation,
  Search as SearchIcon,
  Sun,
} from "lucide-react";
import { undoFileOp } from "@kw/stores/fileOpsStore";
import type { KiwiTreeHandle } from "./components/KiwiTree";
import { AppSidebar } from "./components/AppSidebar";
import type { TreeSortMode } from "./lib/treeTransform";
import { usePublishedPagesStore } from "./stores/publishedPagesStore";
import { KiwiPage } from "./components/KiwiPage";
import { KiwiEditor } from "./components/KiwiEditor";
import { KiwiSearch } from "./components/KiwiSearch";
import { KiwiGraph } from "./components/KiwiGraph";
import { KiwiHistory } from "./components/KiwiHistory";
import { KiwiData } from "./components/KiwiData";
import { KiwiBases } from "./components/KiwiBases";
import { KiwiCanvasScreen } from "./components/KiwiCanvasScreen";
import { KiwiWhiteboardScreen } from "./components/KiwiWhiteboardScreen";
import { KiwiTimeline } from "./components/KiwiTimeline";
import { KiwiKanban } from "./components/KiwiKanban";
import { KanbanDragProvider } from "./components/kanban/KanbanDragProvider";
import { NewPageDialog } from "./components/NewPageDialog";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { useRecentPages } from "./hooks/useRecentPages";
import { useStarredPages } from "./hooks/useStarredPages";
import { usePinnedPages } from "./hooks/usePinnedPages";
import { Button } from "./components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { api, getCurrentSpace, setCurrentSpace, sseUrl, type TreeEntry } from "./lib/api";
import { useTheme } from "./hooks/useTheme";
import { isMarkdown, isCanvasFile, isExcalidrawFile } from "./lib/paths";
import { type TreeRevealRequest } from "./lib/treeReveal";
import { HostToolbarActions } from "./components/HostToolbarActions";

function getInitialActivePath(): string | null {
  if (typeof window === "undefined") return null;
  const pathname = window.location.pathname;
  const hash = window.location.hash.replace(/^#\/?/, "");
  const raw = pathname.startsWith("/page/")
    ? decodeURIComponent(pathname.slice("/page/".length))
    : hash;
  return raw || null;
}

export default function App() {
  const [tree, setTree] = useState<TreeEntry | null>(null);
  const [activePath, setActivePath] = useState<string | null>(getInitialActivePath);
  const [treeLoading, setTreeLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | undefined>();
  const [newOpen, setNewOpen] = useState(false);
  const [newFolder, setNewFolder] = useState<string | undefined>();
  const [graphOpen, setGraphOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [basesOpen, setBasesOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [initialCanvasPath, setInitialCanvasPath] = useState<string | null>(null);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [initialWhiteboardPath, setInitialWhiteboardPath] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [treeRevealRequest, setTreeRevealRequest] = useState<TreeRevealRequest | null>(null);
  const treeRef = useRef<KiwiTreeHandle>(null);
  const treeFilterRef = useRef<HTMLInputElement>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [treeSortMode, setTreeSortMode] = useState<TreeSortMode>(() => {
    try {
      const v = localStorage.getItem("kiwifs-tree-sort");
      return v === "type" ? "type" : "name";
    } catch {
      return "name";
    }
  });

  // Close all full-screen views. Called before opening a new one so only one
  // view is ever active — the ternary render chain in <main> checks them in
  // priority order and the first truthy one wins.
  const closeAllViews = useCallback(() => {
    setBasesOpen(false);
    setCanvasOpen(false);
    setWhiteboardOpen(false);
    setTimelineOpen(false);
    setKanbanOpen(false);
    setDataOpen(false);
    setGraphOpen(false);
    setHistoryOpen(false);
  }, []);

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) return false;
    try { return localStorage.getItem("kiwifs-sidebar") !== "collapsed"; } catch { return true; }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("kiwifs-sidebar-width");
      return saved ? Math.max(200, Math.min(480, parseInt(saved, 10))) : 272;
    } catch { return 272; }
  });
  const resizing = useRef(false);
  const { theme, toggleTheme } = useTheme();
  const currentSpace = getCurrentSpace() || "default";
  const { recent, recordVisit } = useRecentPages(currentSpace);
  const { starred, toggle: toggleStar, isStarred } = useStarredPages(currentSpace);
  const { pinned, toggle: togglePin, isPinned } = usePinnedPages(currentSpace);
  const editorRef = useRef<{ save: () => Promise<void>; toggleMode?: () => void } | null>(null);
  const [spaceKey, setSpaceKey] = useState(0);
  const refreshPublishedPages = usePublishedPagesStore((state) => state.refresh);
  const stateRef = useRef({ editing, activePath, graphOpen, historyOpen, dataOpen, basesOpen, canvasOpen, whiteboardOpen, timelineOpen, kanbanOpen });
  stateRef.current = { editing, activePath, graphOpen, historyOpen, dataOpen, basesOpen, canvasOpen, whiteboardOpen, timelineOpen, kanbanOpen };

  // Prevent browser from navigating to a file:// URL when OS files are
  // dropped anywhere on the page.  react-dnd's HTML5Backend (inside
  // react-arborist) may set dropEffect='none' for unrecognised drag types
  // which suppresses the drop event; re-asserting 'copy' here (after
  // react-dnd's bubble-phase handler) restores the expected behaviour.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    api
      .tree("/")
      .then((t) => setTree(t))
      .catch(() => setTree(null))
      .finally(() => setTreeLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    void refreshPublishedPages();
  }, [refreshKey, spaceKey, refreshPublishedPages]);

  useEffect(() => {
    if (!tree || activePath) return;
    const firstMd = firstMarkdown(tree);
    if (firstMd) setActivePath(firstMd);
  }, [tree, activePath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (mod && key === "n") {
        e.preventDefault();
        setNewFolder(undefined);
        setNewOpen(true);
      } else if (mod && key === "e") {
        const { activePath, graphOpen, historyOpen, dataOpen } = stateRef.current;
        if (!activePath || graphOpen || historyOpen || dataOpen) return;
        e.preventDefault();
        setEditing((v) => !v);
      } else if (mod && key === "s") {
        if (!stateRef.current.editing) return;
        e.preventDefault();
        editorRef.current?.save().catch(() => {});
      } else if (mod && e.shiftKey && key === "e") {
        if (!stateRef.current.editing) return;
        e.preventDefault();
        editorRef.current?.toggleMode?.();
      } else if (mod && e.shiftKey && key === "b") {
        e.preventDefault();
        setBasesOpen((v) => !v);
      } else if (mod && e.shiftKey && key === "t") {
        e.preventDefault();
        setTimelineOpen((v) => !v);
      } else if (mod && e.shiftKey && key === "w") {
        e.preventDefault();
        setKanbanOpen((v) => !v);
      } else if (mod && (key === "/" || key === "?")) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (mod && key === "z" && !e.shiftKey) {
        if (stateRef.current.editing) return;
        e.preventDefault();
        undoFileOp()
          .then((msg) => {
            if (msg) setRefreshKey((k) => k + 1);
          })
          .catch(() => {});
      } else if (mod && e.altKey && key === "f") {
        e.preventDefault();
        treeFilterRef.current?.focus();
        treeFilterRef.current?.select();
      } else if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

const handleSpaceSwitch = useCallback(() => {
    setActivePath(null);
    setEditing(false);
    setGraphOpen(false);
    setHistoryOpen(false);
    setDataOpen(false);
    setBasesOpen(false);
    setCanvasOpen(false);
    setTimelineOpen(false);
    setKanbanOpen(false);
    setSpaceKey((k) => k + 1);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const es = new EventSource(sseUrl());
    const bump = () => setRefreshKey((k) => k + 1);
    const events = ["write", "delete", "bulk", "comment.add", "comment.delete"];
    events.forEach((name) => es.addEventListener(name, bump));
    es.onerror = () => {};
    return () => {
      events.forEach((name) => es.removeEventListener(name, bump));
      es.close();
    };
  }, [spaceKey]);

  useEffect(() => {
    // Support both /page/{path} (new) and #/{path} (legacy) on initial load.
    const pathname = window.location.pathname;
    const hash = window.location.hash.replace(/^#\/?/, "");
    const raw = pathname.startsWith("/page/")
      ? decodeURIComponent(pathname.slice("/page/".length))
      : hash;
    if (!raw) return;
    const parts = raw.split("/");
    api.listSpaces().then((res) => {
      const names = new Set(res.spaces.map((s) => s.name));
      if (parts.length > 1 && names.has(parts[0])) {
        const space = parts[0];
        const path = parts.slice(1).join("/");
        setCurrentSpace(space === "default" ? null : space);
        if (path) setActivePath(path);
        setSpaceKey((k) => k + 1);
        setRefreshKey((k) => k + 1);
      } else {
        setActivePath(raw);
      }
    }).catch(() => {
      setActivePath(raw);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCloudMode = typeof window !== "undefined" && (window as any).__kiwi_cloud_mode__;
  const fromPopState = useRef(false);
  useEffect(() => {
    if (isCloudMode) return;
    if (!activePath) {
      if (window.location.pathname !== "/") {
        window.history.pushState(null, "", "/");
      }
      return;
    }
    const space = getCurrentSpace();
    const target = space && space !== "default"
      ? `/page/${space}/${activePath}`
      : `/page/${activePath}`;
    if (window.location.pathname !== target) {
      if (fromPopState.current) {
        fromPopState.current = false;
      } else {
        window.history.pushState(null, "", target);
      }
    }
  }, [activePath, spaceKey, isCloudMode]);

  useEffect(() => {
    if (isCloudMode) return;
    const onPopState = () => {
      const pathname = window.location.pathname;
      if (pathname.startsWith("/page/")) {
        fromPopState.current = true;
        const raw = decodeURIComponent(pathname.slice("/page/".length));
        const space = getCurrentSpace();
        const prefix = space && space !== "default" ? space + "/" : "";
        const stripped = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
        setActivePath(stripped || null);
        setEditing(false);
        setGraphOpen(false);
        setHistoryOpen(false);
        setDataOpen(false);
        setBasesOpen(false);
        setCanvasOpen(false);
        setTimelineOpen(false);
        setKanbanOpen(false);
      } else if (pathname === "/") {
        fromPopState.current = true;
        setActivePath(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isCloudMode]);

  function revealActivePageInTree() {
    if (!activePath) return;
    setSidebarOpen(true);
    setTreeRevealRequest((prev) => ({ path: activePath, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  function navigate(path: string) {
    if (!path) {
      const firstMd = tree ? firstMarkdown(tree) : null;
      if (firstMd) setActivePath(firstMd);
      if (isMobile) setSidebarOpen(false);
      return;
    }
    if (isCanvasFile(path)) {
      closeAllViews();
      setInitialCanvasPath(path);
      setCanvasOpen(true);
      if (isMobile) setSidebarOpen(false);
      return;
    }
    if (isExcalidrawFile(path)) {
      closeAllViews();
      setInitialWhiteboardPath(path);
      setWhiteboardOpen(true);
      if (isMobile) setSidebarOpen(false);
      return;
    }
    if (!isMarkdown(path)) {
      const folder = findFolder(tree, path);
      const target = folder ? firstMarkdown(folder) : `${path}/index.md`;
      if (target) {
        setActivePath(target);
        setEditing(false);
        recordVisit(target);
        if (isMobile) setSidebarOpen(false);
      }
      return;
    }
    setActivePath(path);
    setEditing(false);
    setGraphOpen(false);
    setHistoryOpen(false);
    setDataOpen(false);
    setBasesOpen(false);
    setCanvasOpen(false);
    setWhiteboardOpen(false);
    setTimelineOpen(false);
    setKanbanOpen(false);
    recordVisit(path);
    if (isMobile) setSidebarOpen(false);
  }

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const toggleSidebar = useCallback((open: boolean) => {
    setSidebarOpen(open);
    if (!isMobile) {
      try { localStorage.setItem("kiwifs-sidebar", open ? "open" : "collapsed"); } catch {}
    }
  }, [isMobile]);

  return (
    <TooltipProvider delayDuration={250}>
      <KanbanDragProvider>
        <div className="h-full flex flex-col bg-background text-foreground">
        {/* ── Header: full-width app bar ── */}
        <header className="h-12 shrink-0 border-b border-border bg-card flex items-center px-3 gap-2">
          {/* Left zone: sidebar toggle + logo + space */}
          <div className="flex items-center gap-2 min-w-0">
            <ToolbarButton
              onClick={() => toggleSidebar(!sidebarOpen)}
              label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen
                ? <PanelLeftClose className="h-4 w-4" />
                : <PanelLeftOpen className="h-4 w-4" />}
            </ToolbarButton>
            <div className="flex items-center gap-2">
              <img src="/kiwifs.png" alt="KiwiFS" className="h-7 w-7 shrink-0" />
              <span className="font-semibold text-sm hidden sm:inline">KiwiFS</span>
            </div>
          </div>

          {/* Center zone: search bar */}
          <div className="flex-1 flex justify-center px-2 sm:px-4">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent text-muted-foreground text-sm transition-colors w-full max-w-md"
            >
              <SearchIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left truncate hidden sm:inline">Search pages…</span>
              <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono hidden sm:inline">
                {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}K
              </kbd>
            </button>
          </div>

          {/* Right zone: actions */}
          <div className="flex items-center gap-0.5">
            <ToolbarButton onClick={() => { setNewFolder(undefined); setNewOpen(true); }} label="New page (⌘N)">
              <Plus className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !graphOpen; closeAllViews(); setGraphOpen(next); }} label="Knowledge graph">
              <Network className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !basesOpen; closeAllViews(); setBasesOpen(next); }} label="Bases">
              <LayoutGrid className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !canvasOpen; closeAllViews(); setCanvasOpen(next); }} label="Canvas">
              <Presentation className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !whiteboardOpen; closeAllViews(); setWhiteboardOpen(next); }} label="Whiteboard">
              <PenTool className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !timelineOpen; closeAllViews(); setTimelineOpen(next); }} label="Timeline">
              <Clock4 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !kanbanOpen; closeAllViews(); setKanbanOpen(next); }} label="Kanban">
              <Columns3 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => { const next = !dataOpen; closeAllViews(); setDataOpen(next); }} label="Data sources">
              <Database className="h-4 w-4" />
            </ToolbarButton>
            <HostToolbarActions />
            <ToolbarButton onClick={toggleTheme} label={theme === "dark" ? "Light mode" : "Dark mode"}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </ToolbarButton>
          </div>
        </header>

        {/* ── Body: sidebar + content ── */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile backdrop */}
          {isMobile && sidebarOpen && (
            <div
              className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <AppSidebar
            activePath={activePath}
            isMobile={isMobile}
            sidebarOpen={sidebarOpen}
            sidebarWidth={sidebarWidth}
            resizing={resizing}
            treeRef={treeRef}
            treeFilterRef={treeFilterRef}
            treeFilter={treeFilter}
            treeRevealRequest={treeRevealRequest}
            treeSortMode={treeSortMode}
            refreshKey={refreshKey}
            kanbanOpen={kanbanOpen}
            starred={starred}
            pinned={pinned}
            recent={recent}
            onSpaceSwitch={handleSpaceSwitch}
            onNavigate={navigate}
            onToggleStar={toggleStar}
            onTogglePin={togglePin}
            onCreatePage={(folder) => {
              setNewFolder(folder);
              setNewOpen(true);
            }}
            onTreeFilterChange={setTreeFilter}
            onTreeSortModeChange={setTreeSortMode}
            onActivePathChange={setActivePath}
            onTreeRefresh={() => setRefreshKey((key) => key + 1)}
          />

          {/* Sidebar resize handle (desktop only) */}
          {sidebarOpen && !isMobile && (
            <div
              className="kiwi-resize-handle w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 relative z-10"
              onMouseDown={(e) => {
                e.preventDefault();
                resizing.current = true;
                const startX = e.clientX;
                const startW = sidebarWidth;
                let latestW = startW;
                const onMove = (ev: MouseEvent) => {
                  latestW = Math.max(200, Math.min(480, startW + ev.clientX - startX));
                  setSidebarWidth(latestW);
                };
                const onUp = () => {
                  resizing.current = false;
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  try { localStorage.setItem("kiwifs-sidebar-width", String(latestW)); } catch {}
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
          )}

          {/* Main content area */}
          <main className={`flex-1 relative ${basesOpen || canvasOpen || whiteboardOpen || timelineOpen || kanbanOpen || dataOpen || graphOpen ? "overflow-hidden" : "overflow-auto kiwi-scroll"}`}>
            {basesOpen ? (
              <KiwiBases
                onClose={() => setBasesOpen(false)}
                onNavigate={(p) => { setBasesOpen(false); navigate(p); }}
              />
            ) : canvasOpen ? (
              <KiwiCanvasScreen
                initialCanvasPath={initialCanvasPath}
                onClose={() => { setCanvasOpen(false); setInitialCanvasPath(null); }}
                onNavigate={(p) => { setCanvasOpen(false); setInitialCanvasPath(null); navigate(p); }}
                onTreeRefresh={() => setRefreshKey((k) => k + 1)}
              />
            ) : whiteboardOpen ? (
              <KiwiWhiteboardScreen
                initialPath={initialWhiteboardPath}
                onClose={() => { setWhiteboardOpen(false); setInitialWhiteboardPath(null); }}
                onNavigate={(p) => { setWhiteboardOpen(false); setInitialWhiteboardPath(null); navigate(p); }}
                onTreeRefresh={() => setRefreshKey((k) => k + 1)}
              />
            ) : timelineOpen ? (
              <KiwiTimeline
                onClose={() => setTimelineOpen(false)}
                onNavigate={(p) => { setTimelineOpen(false); navigate(p); }}
              />
            ) : kanbanOpen ? (
              <KiwiKanban
                onClose={() => setKanbanOpen(false)}
                onNavigate={(p) => { setKanbanOpen(false); navigate(p); }}
              />
            ) : dataOpen ? (
              <KiwiData onClose={() => setDataOpen(false)} />
            ) : graphOpen ? (
              <KiwiGraph
                tree={tree}
                activePath={activePath}
                onNavigate={(p) => {
                  setGraphOpen(false);
                  navigate(p);
                }}
                onClose={() => setGraphOpen(false)}
              />
            ) : historyOpen && activePath ? (
              <KiwiHistory
                path={activePath}
                onClose={() => setHistoryOpen(false)}
                onRestored={() => setRefreshKey((k) => k + 1)}
              />
            ) : editing && activePath ? (
              <KiwiEditor
                path={activePath}
                tree={tree}
                saveRef={editorRef}
                onClose={() => setEditing(false)}
                onNavigate={navigate}
                onSaved={() => {
                  setEditing(false);
                  setRefreshKey((k) => k + 1);
                }}
              />
            ) : activePath ? (
              <KiwiPage
                path={activePath}
                tree={tree}
                onNavigate={navigate}
                onEdit={() => setEditing(true)}
                onHistory={() => setHistoryOpen(true)}
                onRevealInTree={revealActivePageInTree}
                onToggleStar={() => toggleStar(activePath)}
                isStarred={isStarred(activePath)}
                onTogglePin={() => togglePin(activePath)}
                isPinned={isPinned(activePath)}
                onDeleted={() => {
                  setActivePath(null);
                  setRefreshKey((k) => k + 1);
                }}
                onDuplicated={(p) => {
                  setRefreshKey((k) => k + 1);
                  navigate(p);
                }}
                onMoved={(p) => {
                  setRefreshKey((k) => k + 1);
                  navigate(p);
                }}
                onTagClick={(tag) => {
                  setSearchQuery(`tag:${tag}`);
                  setSearchOpen(true);
                }}
                refreshKey={refreshKey}
                onPublishedChanged={refreshPublishedPages}
              />
            ) : treeLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <WelcomeScreen
                onNewPage={() => { setNewFolder(undefined); setNewOpen(true); }}
                onSearch={() => setSearchOpen(true)}
                onGraph={() => setGraphOpen(true)}
                onData={() => setDataOpen(true)}
                onBases={() => setBasesOpen(true)}
                onTimeline={() => setTimelineOpen(true)}
              />
            )}
          </main>
        </div>
        </div>
      </KanbanDragProvider>

      {/* Modals */}
      <KiwiSearch
        open={searchOpen}
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) setSearchQuery(undefined);
        }}
        onSelect={(p) => navigate(p)}
        tree={tree}
        initialQuery={searchQuery}
      />
      <NewPageDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        defaultFolder={newFolder}
        onCreated={(p) => {
          setNewOpen(false);
          setRefreshKey((k) => k + 1);
          setActivePath(p);
          setEditing(true);
        }}
      />
      <KeyboardShortcuts
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </TooltipProvider>
  );
}

/* ── Welcome Screen ── */

function WelcomeScreen({
  onNewPage,
  onSearch,
  onData,
}: {
  onNewPage: () => void;
  onSearch: () => void;
  onGraph?: () => void;
  onData: () => void;
  onBases?: () => void;
  onTimeline?: () => void;
}) {
  return (
    <div className="grid place-items-center h-full text-muted-foreground">
      <div className="text-center max-w-md">
        <img src="/kiwi-mascot.png" alt="KiwiFS" className="h-24 mx-auto mb-4" />
        <div className="text-2xl font-semibold mb-2 text-foreground">
          Welcome to KiwiFS
        </div>
        <div className="text-sm mb-6">
          Your knowledge base is ready. Get started by creating a page or exploring existing content.
        </div>
        <div className="flex flex-col gap-2 items-center">
          <Button onClick={onNewPage} className="gap-2">
            <Plus className="h-4 w-4" />
            Create your first page
          </Button>
          <Button variant="outline" onClick={onSearch} className="gap-2">
            <SearchIcon className="h-4 w-4" />
            Search pages
            <kbd className="ml-1 text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
              {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}K
            </kbd>
          </Button>
          <Button variant="ghost" onClick={onData} className="gap-2 text-muted-foreground">
            <Database className="h-4 w-4" />
            Import from a source
          </Button>
        </div>
        <div className="mt-8 text-xs space-y-1">
          <div><kbd className="bg-muted px-1.5 py-0.5 rounded font-mono">⌘N</kbd> New page</div>
          <div><kbd className="bg-muted px-1.5 py-0.5 rounded font-mono">⌘E</kbd> Toggle editor</div>
          <div><kbd className="bg-muted px-1.5 py-0.5 rounded font-mono">⌘/</kbd> Keyboard shortcuts</div>
        </div>
      </div>
    </div>
  );
}

/* ── Toolbar Button ── */

function ToolbarButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/* ── Helpers ── */

function findFolder(t: TreeEntry | null, path: string): TreeEntry | null {
  if (!t) return null;
  const clean = path.replace(/\/+$/, "");
  for (const c of t.children || []) {
    const cp = c.path.replace(/\/+$/, "");
    if (c.isDir && cp === clean) return c;
    if (c.isDir && clean.startsWith(cp + "/")) {
      const inner = findFolder(c, path);
      if (inner) return inner;
    }
  }
  return null;
}

function firstMarkdown(t: TreeEntry): string | null {
  const children = t.children || [];
  const idx = children.find(
    (c) => !c.isDir && c.name.toLowerCase() === "index.md",
  );
  if (idx) return idx.path;
  for (const c of children) {
    if (!c.isDir && c.path.toLowerCase().endsWith(".md")) return c.path;
  }
  for (const c of children) {
    if (c.isDir) {
      const r = firstMarkdown(c);
      if (r) return r;
    }
  }
  return null;
}
