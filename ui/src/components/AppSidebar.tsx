import { useMemo, useState, useEffect, type Dispatch, type MutableRefObject, type ReactNode, type RefObject, type SetStateAction } from "react";
import {
  ArrowDownAZ,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Clock,
  File,
  FileAxis3D,
  FolderTree,
  Pin,
  Plus,
  Rss,
  Star,
} from "lucide-react";
import { KiwiTree, type KiwiTreeHandle } from "./KiwiTree";
import { SpaceSelector } from "./SpaceSelector";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { titleize } from "../lib/paths";
import { cn } from "../lib/cn";
import type { TreeSortMode } from "../lib/treeTransform";
import type { TreeRevealRequest } from "../lib/treeReveal";
import { usePublishedPagesStore } from "../stores/publishedPagesStore";
import {
  collectSectionPrefixes,
  filterPathsByQuery,
  isStructuredSidebar,
  mergeSidebarExcludePatterns,
  type SidebarConfig,
} from "../lib/sidebarStructure";
import { api, type TreeEntry } from "../lib/api";

type RecentPage = { path: string };

type AppSidebarProps = {
  activePath: string | null;
  isMobile: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  resizing: MutableRefObject<boolean>;
  treeRef: RefObject<KiwiTreeHandle | null>;
  treeFilterRef: RefObject<HTMLInputElement | null>;
  treeFilter: string;
  treeRevealRequest: TreeRevealRequest | null;
  treeSortMode: TreeSortMode;
  refreshKey: number;
  kanbanOpen: boolean;
  sidebarConfig: SidebarConfig;
  starred: string[];
  pinned: string[];
  recent: RecentPage[];
  onSpaceSwitch: () => void;
  onNavigate: (path: string) => void;
  onToggleStar: (path: string) => void;
  onTogglePin: (path: string) => void;
  onCreatePage: (folder?: string) => void;
  onTreeFilterChange: (value: string) => void;
  onTreeSortModeChange: Dispatch<SetStateAction<TreeSortMode>>;
  onActivePathChange: (path: string | null) => void;
  onTreeRefresh: (options?: { background?: boolean; reconcile?: boolean }) => void;
};

export function AppSidebar({
  activePath,
  isMobile,
  sidebarOpen,
  sidebarWidth,
  resizing,
  treeRef,
  treeFilterRef,
  treeFilter,
  treeRevealRequest,
  treeSortMode,
  refreshKey,
  kanbanOpen,
  sidebarConfig,
  starred,
  pinned,
  recent,
  onSpaceSwitch,
  onNavigate,
  onToggleStar,
  onTogglePin,
  onCreatePage,
  onTreeFilterChange,
  onTreeSortModeChange,
  onActivePathChange,
  onTreeRefresh,
}: AppSidebarProps) {
  const publishedPages = usePublishedPagesStore((state) => state.pages);
  const showPublishedList = usePublishedPagesStore((state) => state.showList);
  const toggleShowPublishedList = usePublishedPagesStore((state) => state.toggleShowList);
  const refreshPublishedPages = usePublishedPagesStore((state) => state.refresh);
  const publishedPathSet = useMemo(() => new Set(publishedPages.map((page) => page.path)), [publishedPages]);
  const configPinned = useMemo(
    () => filterPathsByQuery(sidebarConfig.pinned, treeFilter),
    [sidebarConfig.pinned, treeFilter],
  );
  const sectionPrefixes = useMemo(
    () => collectSectionPrefixes(sidebarConfig.sections),
    [sidebarConfig.sections],
  );
  const treeExcludePatterns = useMemo(
    () => mergeSidebarExcludePatterns(sidebarConfig.hidden),
    [sidebarConfig.hidden],
  );
  const usesStructuredSidebar = isStructuredSidebar(sidebarConfig);
  const [sharedTreeRoot, setSharedTreeRoot] = useState<TreeEntry | null>(null);

  useEffect(() => {
    if (!usesStructuredSidebar) {
      setSharedTreeRoot(null);
      return;
    }
    let cancelled = false;
    api.tree("/").then((tree) => {
      if (!cancelled) setSharedTreeRoot(tree);
    }).catch(() => {
      if (!cancelled) setSharedTreeRoot(null);
    });
    return () => { cancelled = true; };
  }, [refreshKey, usesStructuredSidebar]);

  const hasShortcutSections = configPinned.length > 0
    || starred.length > 0
    || pinned.length > 0
    || recent.length > 0
    || (showPublishedList && publishedPages.length > 0)
    || sidebarConfig.sections.length > 0;

  return (
    <aside
      className={
        isMobile
          ? "kiwi-tree-sidebar absolute inset-y-0 left-0 z-30 border-r border-border bg-card flex flex-col overflow-hidden transition-transform duration-200 " + (sidebarOpen ? "translate-x-0" : "-translate-x-full")
          : "kiwi-tree-sidebar shrink-0 border-r border-border bg-card flex flex-col overflow-hidden" + (resizing.current ? "" : " transition-[width] duration-200")
      }
      style={isMobile ? { width: Math.min(sidebarWidth, 300) } : { width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <div className="flex flex-col h-full min-h-0" style={{ minWidth: isMobile ? Math.min(sidebarWidth, 300) : sidebarWidth }}>
        <SpaceSelector onSwitch={onSpaceSwitch} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {hasShortcutSections && (
            <div className="shrink-0 overflow-auto kiwi-scroll max-h-[40vh]">
              {configPinned.length > 0 && (
                <SidebarSection icon={<Pin className="h-3.5 w-3.5" />} title="Pinned" storageKey="config-pinned">
                  {configPinned.map((path) => (
                    <SidebarPageItem
                      key={path}
                      path={path}
                      active={activePath === path}
                      published={publishedPathSet.has(path)}
                      onSelect={onNavigate}
                      leading={<Pin className="h-3.5 w-3.5 text-primary shrink-0 fill-current" />}
                    />
                  ))}
                </SidebarSection>
              )}

              {starred.length > 0 && (
                <SidebarSection icon={<Star className="h-3.5 w-3.5" />} title="Starred" storageKey="starred">
                  {starred.map((path) => (
                    <SidebarPageItem
                      key={path}
                      path={path}
                      active={activePath === path}
                      published={publishedPathSet.has(path)}
                      onSelect={onNavigate}
                      trailing={
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onToggleStar(path); }}
                          className="opacity-0 group-hover:opacity-100 text-amber-500"
                        >
                          <Star className="h-3 w-3 fill-current" />
                        </button>
                      }
                    />
                  ))}
                </SidebarSection>
              )}

              {pinned.length > 0 && (
                <SidebarSection icon={<Pin className="h-3.5 w-3.5" />} title="My pins" storageKey="pinned">
                  {pinned.map((path) => (
                    <SidebarPageItem
                      key={path}
                      path={path}
                      active={activePath === path}
                      published={publishedPathSet.has(path)}
                      onSelect={onNavigate}
                      trailing={
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onTogglePin(path); }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                        >
                          <Pin className="h-3 w-3 fill-current" />
                        </button>
                      }
                    />
                  ))}
                </SidebarSection>
              )}

              {showPublishedList && publishedPages.length > 0 && (
                <SidebarSection icon={<Rss className="h-3.5 w-3.5" />} title={`Published (${publishedPages.length})`} storageKey="published">
                  {publishedPages.map((page) => (
                    <SidebarPageItem
                      key={page.path}
                      path={page.path}
                      active={activePath === page.path}
                      published
                      onSelect={onNavigate}
                    />
                  ))}
                </SidebarSection>
              )}

              {recent.length > 0 && (
                <SidebarSection icon={<Clock className="h-3.5 w-3.5" />} title="Recent" storageKey="recent">
                  {recent.slice(0, 5).map((page) => (
                    <SidebarPageItem
                      key={page.path}
                      path={page.path}
                      active={activePath === page.path}
                      published={publishedPathSet.has(page.path)}
                      onSelect={onNavigate}
                    />
                  ))}
                </SidebarSection>
              )}

              {sidebarConfig.sections.map((section) => (
                <SidebarSection
                  key={section.label}
                  icon={<FolderTree className="h-3.5 w-3.5" />}
                  title={section.label}
                  storageKey={`section-${section.label}`}
                  defaultOpen
                >
                  <KiwiTree
                    activePath={activePath}
                    revealRequest={treeRevealRequest}
                    onSelect={onNavigate}
                    refreshKey={refreshKey}
                    filterQuery={treeFilter}
                    sortMode={treeSortMode}
                    publishedPaths={publishedPathSet}
                    onPublishedChanged={refreshPublishedPages}
                    compactFolders
                    enableFileNesting
                    excludePatterns={treeExcludePatterns}
                    includePrefixes={section.paths}
                    treeRoot={usesStructuredSidebar ? sharedTreeRoot : undefined}
                    autoReveal={false}
                    onCreateChild={onCreatePage}
                    onDeleted={() => {
                      onActivePathChange(null);
                      onTreeRefresh();
                    }}
                    onDuplicated={(path) => {
                      onTreeRefresh();
                      onNavigate(path);
                    }}
                    onMoved={(path, options) => {
                      onTreeRefresh({ background: true, reconcile: options?.refresh === false ? false : undefined });
                      if (path) onNavigate(path);
                    }}
                  />
                </SidebarSection>
              ))}
            </div>
          )}

          <SidebarSection
            icon={<FileAxis3D className="h-3.5 w-3.5" />}
            title="Pages"
            storageKey="pages"
            defaultOpen
            fill
            expandSignal={treeRevealRequest?.nonce}
            headerActions={
              <>
                <SidebarIconButton label="New page" onClick={() => onCreatePage()}>
                  <Plus className="h-3.5 w-3.5" />
                </SidebarIconButton>
                <SidebarIconButton
                  label={showPublishedList ? "Hide published list" : "Show published list"}
                  active={showPublishedList}
                  onClick={toggleShowPublishedList}
                >
                  <Rss className="h-3.5 w-3.5" />
                </SidebarIconButton>
                <SidebarIconButton label="Collapse all folders" onClick={() => treeRef.current?.collapseAll()}>
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                </SidebarIconButton>
                <SidebarIconButton
                  label={`Sort: ${treeSortMode === "type" ? "type" : "name"}`}
                  onClick={() => {
                    onTreeSortModeChange((mode) => {
                      const next = mode === "name" ? "type" : "name";
                      try {
                        localStorage.setItem("kiwifs-tree-sort", next);
                      } catch {}
                      return next;
                    });
                  }}
                >
                  <ArrowDownAZ className="h-3.5 w-3.5" />
                </SidebarIconButton>
              </>
            }
          >
            <div className="shrink-0 px-2 pb-1.5">
              <Input
                ref={treeFilterRef}
                value={treeFilter}
                onChange={(event) => onTreeFilterChange(event.target.value)}
                placeholder="Filter pages…"
                className="h-7 text-xs font-normal normal-case tracking-normal"
                aria-label="Filter file tree"
              />
            </div>
            <KiwiTree
              ref={treeRef}
              activePath={activePath}
              revealRequest={treeRevealRequest}
              onSelect={onNavigate}
              refreshKey={refreshKey}
              filterQuery={treeFilter}
              sortMode={treeSortMode}
              publishedPaths={publishedPathSet}
              onPublishedChanged={refreshPublishedPages}
              compactFolders
              enableFileNesting
              excludePatterns={treeExcludePatterns}
              excludePrefixes={sectionPrefixes}
              excludePaths={sidebarConfig.pinned}
              treeRoot={usesStructuredSidebar ? sharedTreeRoot : undefined}
              onCreateChild={onCreatePage}
              onDeleted={() => {
                onActivePathChange(null);
                onTreeRefresh();
              }}
              onDuplicated={(path) => {
                onTreeRefresh();
                onNavigate(path);
              }}
              onMoved={(path, options) => {
                onTreeRefresh({ background: true, reconcile: options?.refresh === false ? false : undefined });
                if (path) onNavigate(path);
              }}
              enableKanbanDrag={kanbanOpen}
            />
          </SidebarSection>
        </div>
      </div>
    </aside>
  );
}

type SidebarSectionProps = {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  storageKey?: string;
  defaultOpen?: boolean;
  expandSignal?: number;
  headerActions?: ReactNode;
  fill?: boolean;
};

function SidebarSection({
  icon,
  title,
  children,
  storageKey,
  defaultOpen,
  expandSignal,
  headerActions,
  fill,
}: SidebarSectionProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (!storageKey) return false;
    try {
      const stored = localStorage.getItem(`kiwifs-section-${storageKey}`);
      if (stored !== null) return stored === "1";
    } catch {}
    return !defaultOpen;
  });

  useEffect(() => {
    if (expandSignal == null) return;
    setCollapsed(false);
  }, [expandSignal]);

  return (
    <div className={`border-b border-border/50 last:border-b-0${fill ? " flex-1 min-h-0 flex flex-col" : ""}`}>
      <div className="flex items-center gap-0.5 px-1 py-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            if (storageKey) {
              try { localStorage.setItem(`kiwifs-section-${storageKey}`, next ? "1" : "0"); } catch {}
            }
          }}
          className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs text-muted-foreground uppercase tracking-wider text-left hover:text-foreground hover:bg-accent/50 transition-colors rounded-sm"
        >
          {icon}
          <span className="flex-1 truncate">{title}</span>
          {collapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
        </button>
        {headerActions && !collapsed && (
          <div className="flex items-center shrink-0">{headerActions}</div>
        )}
      </div>
      {!collapsed && (
        <div className={fill ? "flex-1 min-h-0 flex flex-col overflow-hidden" : "pb-2"}>
          {children}
        </div>
      )}
    </div>
  );
}

type SidebarIconButtonProps = {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
};

function SidebarIconButton({ children, label, onClick, active }: SidebarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className={cn("h-6 w-6 grid place-items-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors", active && "border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20")}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

type SidebarPageItemProps = {
  path: string;
  active: boolean;
  onSelect: (path: string) => void;
  trailing?: ReactNode;
  leading?: ReactNode;
  published?: boolean;
};

function SidebarPageItem({ path, active, onSelect, trailing, leading, published }: SidebarPageItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      className={cn(
        "group w-full flex items-center gap-1.5 px-3 py-1 text-left text-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        published && "border-l-2 border-primary/60 bg-primary/10 text-primary-foreground hover:bg-primary/20 dark:text-primary",
        active && (published ? "ring-1 ring-primary/40 font-medium" : "bg-accent text-accent-foreground font-medium"),
      )}
    >
      {leading ?? (
        published ? (
          <Rss className="h-3.5 w-3.5 text-primary shrink-0" />
        ) : (
          <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )
      )}
      <span className="truncate flex-1">{titleize(path)}</span>
      {published && (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-label="Published">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      )}
      {trailing}
    </button>
  );
}
