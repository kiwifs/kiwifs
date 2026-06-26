import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TreeEntry } from "@kw/lib/api";
import { titleize } from "@kw/lib/paths";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

type ProgressEntry = {
  done: boolean;
  doneAt?: string;
};

type ProgressState = Record<string, ProgressEntry>;

type PageItem = {
  path: string;
  name: string;
  title: string;
};

type FolderGroup = {
  folder: string;
  label: string;
  pages: PageItem[];
};

function deriveGroups(tree: TreeEntry | null): FolderGroup[] {
  if (!tree?.children) return [];
  const groups: FolderGroup[] = [];

  const sorted = [...tree.children]
    .filter((c) => c.isDir && /^\d+-/.test(c.name))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const dir of sorted) {
    const pages: PageItem[] = (dir.children ?? [])
      .filter((f) => !f.isDir && f.name.endsWith(".md") && !f.name.startsWith("_"))
      .map((f) => ({
        path: f.path,
        name: f.name,
        title: titleize(f.name.replace(/\.md$/, "")),
      }));

    if (pages.length > 0) {
      groups.push({
        folder: dir.path,
        label: titleize(dir.name),
        pages,
      });
    }
  }

  return groups;
}

type Props = {
  onNavigate?: (path: string) => void;
  stateName?: string;
};

export function PageTracker({ onNavigate, stateName = "progress" }: Props) {
  const [tree, setTree] = useState<TreeEntry | null>(null);
  const [progress, setProgress] = useState<ProgressState>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.tree(),
      api.getMyState<ProgressState>(stateName),
    ]).then(([t, p]) => {
      if (cancelled) return;
      setTree(t);
      setProgress(p ?? {});
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [stateName]);

  const groups = useMemo(() => deriveGroups(tree), [tree]);

  const toggleDone = useCallback((pagePath: string) => {
    setProgress((prev) => {
      const entry = prev[pagePath];
      const next = { ...prev };
      if (entry?.done) {
        delete next[pagePath];
      } else {
        next[pagePath] = { done: true, doneAt: new Date().toISOString().slice(0, 10) };
      }
      api.putMyState(stateName, next);
      return next;
    });
  }, [stateName]);

  const toggleGroup = useCallback((folder: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, []);

  const totalPages = useMemo(() => groups.reduce((s, g) => s + g.pages.length, 0), [groups]);
  const totalDone = useMemo(
    () => groups.reduce((s, g) => s + g.pages.filter((p) => progress[p.path]?.done).length, 0),
    [groups, progress],
  );

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground animate-pulse">
        Loading progress…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No trackable folders found.
      </div>
    );
  }

  const pct = totalPages > 0 ? Math.round((totalDone / totalPages) * 100) : 0;

  return (
    <div className="kiwi-page-tracker space-y-4">
      {/* Overall progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
          {totalDone}/{totalPages} ({pct}%)
        </span>
      </div>

      {/* Folder groups */}
      <div className="space-y-1">
        {groups.map((group) => {
          const groupDone = group.pages.filter((p) => progress[p.path]?.done).length;
          const isCollapsed = collapsedGroups.has(group.folder);
          const groupPct = group.pages.length > 0
            ? Math.round((groupDone / group.pages.length) * 100)
            : 0;

          return (
            <div key={group.folder} className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => toggleGroup(group.folder)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="font-medium flex-1 text-left">{group.label}</span>
                <span className="text-xs text-muted-foreground">
                  {groupDone}/{group.pages.length}
                </span>
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${groupPct}%` }}
                  />
                </div>
              </button>

              {!isCollapsed && (
                <div className="border-t border-border">
                  {group.pages.map((page) => {
                    const entry = progress[page.path];
                    const isDone = entry?.done ?? false;

                    return (
                      <div
                        key={page.path}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/30 transition-colors group"
                      >
                        <button
                          type="button"
                          onClick={() => toggleDone(page.path)}
                          className="shrink-0"
                          aria-label={isDone ? "Mark incomplete" : "Mark complete"}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigate?.(page.path)}
                          className={
                            "flex-1 text-left truncate transition-colors hover:text-primary " +
                            (isDone ? "line-through text-muted-foreground" : "text-foreground")
                          }
                        >
                          {page.title}
                        </button>
                        {entry?.doneAt && (
                          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                            <CalendarIcon className="h-2.5 w-2.5" />
                            {entry.doneAt}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
