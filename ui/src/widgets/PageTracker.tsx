import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TreeEntry } from "@kw/lib/api";
import { titleize } from "@kw/lib/paths";
import { Badge } from "@kw/components/ui/badge";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Calendar as CalendarIcon, Bookmark } from "lucide-react";

type ProgressEntry = {
  done: boolean;
  doneAt?: string;
  bookmarked?: boolean;
};

type ProgressState = Record<string, ProgressEntry>;

type PageMeta = {
  title?: string;
  difficulty?: string;
  tags?: string[];
};

type PageItem = {
  path: string;
  name: string;
  title: string;
  subsection?: string;
  meta?: PageMeta;
};

type FolderGroup = {
  folder: string;
  label: string;
  pages: PageItem[];
};

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isProblemFile(entry: TreeEntry): boolean {
  return !entry.isDir && entry.name.endsWith(".md") && !entry.name.startsWith("_");
}

/** Recursively collect problem pages under a chapter folder (includes subfolders). */
function collectChapterPages(chapter: TreeEntry): PageItem[] {
  const chapterPrefix = chapter.path.replace(/\/$/, "");
  const pages: PageItem[] = [];

  function walk(node: TreeEntry) {
    for (const child of node.children ?? []) {
      if (child.isDir) {
        walk(child);
        continue;
      }
      if (!isProblemFile(child)) continue;

      const rel = child.path.startsWith(chapterPrefix + "/")
        ? child.path.slice(chapterPrefix.length + 1)
        : child.path;
      const segments = rel.split("/");
      const subsection = segments.length > 1 ? titleize(segments[segments.length - 2]) : undefined;

      pages.push({
        path: child.path,
        name: child.name,
        title: titleize(child.name.replace(/\.md$/, "")),
        subsection,
      });
    }
  }

  walk(chapter);
  pages.sort((a, b) => naturalCompare(a.path, b.path));
  return pages;
}

function deriveGroups(tree: TreeEntry | null): FolderGroup[] {
  if (!tree?.children) return [];
  const groups: FolderGroup[] = [];

  const sorted = [...tree.children]
    .filter((c) => c.isDir && /^\d+-/.test(c.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  for (const dir of sorted) {
    const pages = collectChapterPages(dir);
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

function parsePageMeta(fm: Record<string, unknown>): PageMeta {
  const meta: PageMeta = {};
  if (typeof fm.title === "string") meta.title = fm.title;
  if (typeof fm.difficulty === "string") meta.difficulty = fm.difficulty;
  const raw = fm.tags;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const tags = list.map((t) => String(t).trim()).filter(Boolean);
  if (tags.length > 0) meta.tags = tags;
  return meta;
}

/** Meta API caps each request at 200 rows — paginate to load every page. */
async function fetchAllMeta() {
  const pageSize = 200;
  const map: Record<string, PageMeta> = {};
  let offset = 0;
  while (true) {
    const res = await api.meta({ limit: pageSize, offset });
    for (const row of res.results) {
      map[row.path] = parsePageMeta(row.frontmatter);
    }
    if (res.results.length < pageSize) break;
    offset += pageSize;
  }
  return map;
}

function difficultyClass(d: string): string {
  const v = d.toLowerCase();
  if (v === "easy") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (v === "medium") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (v === "hard") return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
  return "";
}

/**
 * Free of the emerald/amber/red that difficulty already claims, which leaves
 * only the blue-to-pink arc — too narrow for every entry to be far from every
 * other. Ordered so consecutive slots are the ones furthest apart in hue, since
 * a workspace with a handful of tags only ever reaches the front of the list.
 */
const TAG_PALETTE = [
  "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  "border-pink-500/40 bg-pink-500/10 text-pink-700 dark:text-pink-400",
  "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
];

/**
 * Colour by position in the sorted tag list rather than by hashing the name:
 * a hash is stable across workspaces but collides, and two tags sharing a
 * colour defeats the only thing the colour is for. Adding a tag can reshuffle
 * the others, which is the cheaper trade.
 */
function assignColors(tags: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  let next = 0;
  for (const tag of [...tags].sort((a, b) => naturalCompare(a, b))) {
    const difficulty = difficultyClass(tag);
    colors[tag] = difficulty || TAG_PALETTE[next++ % TAG_PALETTE.length];
  }
  return colors;
}

/** Every label a page can be filtered by, difficulty included. */
function pageTags(meta?: PageMeta): string[] {
  const tags = new Set(meta?.tags ?? []);
  if (meta?.difficulty) tags.add(meta.difficulty.toLowerCase());
  return [...tags];
}

/** Tags that merely restate the difficulty would double every row's badges. */
function extraTags(meta?: PageMeta): string[] {
  if (!meta?.tags) return [];
  const difficulty = meta.difficulty?.toLowerCase();
  return meta.tags.filter((t) => t.toLowerCase() !== difficulty);
}

function PageTags({ meta, colors }: { meta?: PageMeta; colors: Record<string, string> }) {
  const extra = extraTags(meta);
  if (!meta?.difficulty && extra.length === 0) return null;

  return (
    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
      {meta?.difficulty && (
        <Badge variant="outline" className={"text-[10px] px-1.5 py-0 h-5 " + difficultyClass(meta.difficulty)}>
          {meta.difficulty}
        </Badge>
      )}
      {extra.map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className={"text-[10px] px-1.5 py-0 h-5 " + (colors[tag] ?? "text-muted-foreground")}
        >
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function persist(stateName: string, state: ProgressState) {
  api.putLocalState(stateName, state).catch((err: unknown) => {
    console.error(`Failed to save ${stateName}:`, err);
  });
}

/** Chips cycle off → require → exclude, so "blind75 but not premium" is one click each. */
type TagFilter = "in" | "out";
type StatusFilter = "all" | "todo" | "done";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  todo: "Todo",
  done: "Done",
};

type Props = {
  onNavigate?: (path: string) => void;
  stateName?: string;
};

export function PageTracker({ onNavigate, stateName = "progress" }: Props) {
  const [tree, setTree] = useState<TreeEntry | null>(null);
  const [progress, setProgress] = useState<ProgressState>({});
  const [metaByPath, setMetaByPath] = useState<Record<string, PageMeta>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Record<string, TagFilter>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.tree(),
      api.getLocalState<ProgressState>(stateName),
      fetchAllMeta(),
    ]).then(([t, p, map]) => {
      if (cancelled) return;
      setTree(t);
      setProgress(p ?? {});
      setMetaByPath(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [stateName]);

  const groups = useMemo(() => {
    const base = deriveGroups(tree);
    return base.map((g) => ({
      ...g,
      pages: g.pages.map((p) => ({
        ...p,
        title: metaByPath[p.path]?.title ?? p.title,
        meta: metaByPath[p.path],
      })),
    }));
  }, [tree, metaByPath]);

  const tagUniverse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups) {
      for (const page of group.pages) {
        for (const tag of pageTags(page.meta)) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [groups]);

  const tagColors = useMemo(
    () => assignColors(tagUniverse.map((t) => t.tag)),
    [tagUniverse],
  );

  const filteredGroups = useMemo(() => {
    const required = Object.keys(tagFilter).filter((t) => tagFilter[t] === "in");
    const excluded = Object.keys(tagFilter).filter((t) => tagFilter[t] === "out");
    if (required.length === 0 && excluded.length === 0 && statusFilter === "all") {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        pages: group.pages.filter((page) => {
          const done = progress[page.path]?.done ?? false;
          if (statusFilter === "todo" && done) return false;
          if (statusFilter === "done" && !done) return false;
          const tags = new Set(pageTags(page.meta));
          return required.every((t) => tags.has(t)) && !excluded.some((t) => tags.has(t));
        }),
      }))
      .filter((group) => group.pages.length > 0);
  }, [groups, tagFilter, statusFilter, progress]);

  const cycleTag = useCallback((tag: string) => {
    setTagFilter((prev) => {
      const next = { ...prev };
      if (!next[tag]) next[tag] = "in";
      else if (next[tag] === "in") next[tag] = "out";
      else delete next[tag];
      return next;
    });
  }, []);

  const toggleDone = useCallback((pagePath: string) => {
    setProgress((prev) => {
      const entry = prev[pagePath];
      const next = { ...prev };
      if (entry?.done) {
        delete next[pagePath];
      } else {
        next[pagePath] = { done: true, doneAt: new Date().toISOString().slice(0, 10) };
      }
      persist(stateName, next);
      return next;
    });
  }, [stateName]);

  const toggleBookmark = useCallback((pagePath: string) => {
    setProgress((prev) => {
      const entry = prev[pagePath];
      if (!entry?.done) return prev;
      const next = { ...prev };
      next[pagePath] = { ...entry, bookmarked: !entry.bookmarked };
      persist(stateName, next);
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

  const totalPages = useMemo(
    () => filteredGroups.reduce((s, g) => s + g.pages.length, 0),
    [filteredGroups],
  );
  const totalDone = useMemo(
    () => filteredGroups.reduce((s, g) => s + g.pages.filter((p) => progress[p.path]?.done).length, 0),
    [filteredGroups, progress],
  );
  const filtering = Object.keys(tagFilter).length > 0 || statusFilter !== "all";

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
      {tagUniverse.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={
                "text-[11px] px-2 py-0.5 rounded-full border transition-colors " +
                (statusFilter === status
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50")
              }
            >
              {STATUS_LABELS[status]}
            </button>
          ))}

          <span className="w-px h-4 bg-border mx-1" />

          {tagUniverse.map(({ tag, count }) => {
            const state = tagFilter[tag];
            return (
              <button
                key={tag}
                type="button"
                onClick={() => cycleTag(tag)}
                title={
                  state === "in" ? "Required — click to exclude"
                    : state === "out" ? "Excluded — click to clear"
                      : "Click to require"
                }
                className={
                  "text-[11px] px-2 py-0.5 rounded-full border transition-colors " +
                  (state === "in"
                    ? "border-primary bg-primary text-primary-foreground"
                    : state === "out"
                      ? "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 line-through"
                      : (tagColors[tag] ?? "border-border text-muted-foreground") + " hover:brightness-95")
                }
              >
                {tag}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            );
          })}

          {filtering && (
            <button
              type="button"
              onClick={() => { setTagFilter({}); setStatusFilter("all"); }}
              className="text-[11px] px-2 py-0.5 text-muted-foreground hover:text-foreground underline"
            >
              clear
            </button>
          )}
        </div>
      )}

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
        {filtering && filteredGroups.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            No pages match these filters.
          </div>
        )}
        {filteredGroups.map((group) => {
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
                  {group.pages.map((page, index) => {
                    const entry = progress[page.path];
                    const isDone = entry?.done ?? false;
                    const prev = index > 0 ? group.pages[index - 1] : null;
                    const showSubsection = page.subsection && page.subsection !== prev?.subsection;

                    return (
                      <div key={page.path}>
                        {showSubsection && (
                          <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border/50">
                            {page.subsection}
                          </div>
                        )}
                      <div
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
                            "flex-1 min-w-0 text-left truncate transition-colors hover:text-primary " +
                            (isDone ? "line-through text-muted-foreground" : "text-foreground")
                          }
                        >
                          {page.title}
                        </button>
                        <PageTags meta={page.meta} colors={tagColors} />
                        {entry?.doneAt && (
                          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                            <CalendarIcon className="h-2.5 w-2.5" />
                            {entry.doneAt}
                          </span>
                        )}
                        {isDone && (
                          <button
                            type="button"
                            onClick={() => toggleBookmark(page.path)}
                            className={
                              "shrink-0 transition-opacity " +
                              (entry?.bookmarked ? "opacity-100" : "opacity-0 group-hover:opacity-100")
                            }
                            aria-label={entry?.bookmarked ? "Remove bookmark" : "Bookmark for review"}
                            title={entry?.bookmarked ? "Remove bookmark" : "Bookmark for review"}
                          >
                            <Bookmark
                              className={
                                "h-3.5 w-3.5 transition-colors " +
                                (entry?.bookmarked
                                  ? "text-amber-500 fill-amber-500"
                                  : "text-muted-foreground/40 hover:text-amber-500")
                              }
                            />
                          </button>
                        )}
                      </div>
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
