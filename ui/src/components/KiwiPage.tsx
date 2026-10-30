import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import matter from "gray-matter";
import { AlertTriangle, BookOpen, Calendar, CheckSquare, ChevronDown, ChevronRight, Crosshair, Edit, Eye, File, FileAxis3D, FileQuestion, Folder, History as HistoryIcon, Link2, List, MessageSquareQuote, NotebookPen, Pin, Plus, Star, Tag, Type, User } from "lucide-react";
import { api, type TreeEntry } from "@kw/lib/api";
import { dirOf, titleize } from "@kw/lib/paths";
import { readingTime } from "@kw/lib/readingTime";
import { HostPageActions } from "./HostPageActions";
import { KiwiBreadcrumb } from "./KiwiBreadcrumb";
import { KiwiToC } from "./KiwiToC";
import { KiwiBacklinks } from "./KiwiBacklinks";
import { KiwiComments } from "./KiwiComments";
import { PageActions } from "./PageActions";
import { PublishButton } from "./PublishButton";
import { KiwiPageNav } from "./KiwiPageNav";
import { KiwiQuizProvider, KiwiQuizScore } from "./KiwiQuiz";
import { invalidatePagePreview } from "@kw/lib/pagePreview";
import { ExcalidrawMarkdownPreview, isExcalidrawMarkdown } from "./ExcalidrawMarkdownPreview";
import { ErrorBoundary } from "./ErrorBoundary";
import { useUIConfigStore } from "@kw/lib/uiConfigStore";
import { bannerChips, labeledCount, parseFlowList, parseLabeledCounts, propertyHiddenKeys, type FrontmatterChip } from "@kw/lib/frontmatterTags";
import { assignTagTones, hslTone, resolveTagTone, type TagTone } from "@kw/lib/tagStyle";

import { PageSkeleton } from "./PageSkeleton";
import { trackRecent } from "./KiwiFavorites";
import { Badge } from "@kw/components/ui/badge";
import { Button } from "@kw/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kw/components/ui/tooltip";
import { buildResolver } from "@kw/lib/wikiLinks";
import {
  applyPageMeta,
  applyTitles,
  bookManifestCandidates,
  fallbackBookOrder,
  navForPath,
  parseBookManifest,
  type BookNav,
  type BookOrder,
} from "@kw/lib/bookOrder";
import { stripObsidianComments } from "@kw/lib/remarkPlugins";
import { resetClocks } from "@kw/widgets/playbackClock";
import { kiwiRehypePlugins, kiwiRemarkPlugins, useKiwiMarkdownComponents } from "@kw/lib/markdownPipeline";
import { resetPageVars } from "@kw/lib/pageVars";
import { resetPageData } from "@kw/lib/pageData";

const pageRehypePlugins = kiwiRehypePlugins();
const notesRehypePlugins = kiwiRehypePlugins({ autolinkHeadings: false });

type Props = {
  /** Page path in the KiwiFS tree. Used for API fetching in connected mode. */
  path?: string;

  /**
   * Pass markdown content directly — no server needed.
   * When provided, the component skips API fetching entirely.
   */
  content?: string;

  tree?: TreeEntry | null;
  onNavigate?: (path: string) => void;
  onEdit?: () => void;
  onHistory?: () => void;
  onRevealInTree?: () => void;
  onToggleStar?: () => void;
  isStarred?: boolean;
  onTogglePin?: () => void;
  isPinned?: boolean;
  onDeleted?: () => void;
  onDuplicated?: (newPath: string) => void;
  onMoved?: (newPath: string) => void;
  onTagClick?: (tag: string) => void;
  refreshKey?: number;
  onPublishedChanged?: () => void;

  /** Called when a [[wiki link]] is clicked. Receives the resolved target path. */
  onWikiLinkClick?: (target: string) => void;

  /** Called when a heading scrolls into view. Receives the heading slug. */
  onHeadingVisible?: (slug: string) => void;

  /** Custom className for the outermost wrapper. */
  className?: string;
};

type FrontmatterProperty = {
  key: string;
  value: unknown;
  kind: "text" | "list" | "date" | "boolean" | "object";
};

async function decorateBookTitles(order: BookOrder): Promise<BookOrder> {
  try {
    const meta = await api.meta({ limit: 200 });
    const map: Record<string, { title?: string; description?: string }> = {};
    for (const row of meta.results) {
      const title = row.frontmatter?.title;
      const description = row.frontmatter?.description ?? row.frontmatter?.summary;
      map[row.path] = {
        title: typeof title === "string" && title.trim() ? title.trim() : undefined,
        description: typeof description === "string" && description.trim() ? description.trim() : undefined,
      };
    }
    return applyPageMeta(order, map);
  } catch {
    return order;
  }
}

function findEntry(node: TreeEntry | null | undefined, target: string): TreeEntry | null {
  if (!node) return null;
  const norm = target.replace(/\/+$/, "");
  if (node.path.replace(/\/+$/, "") === norm) return node;
  for (const child of node.children ?? []) {
    const found = findEntry(child, norm);
    if (found) return found;
  }
  return null;
}

function parseMarkdownPage(content: string): { body: string; meta: Record<string, unknown> } {
  const fallback = splitFrontmatterBlock(content);

  try {
    const m = matter(content);
    const parsedMeta = (m.data || {}) as Record<string, unknown>;
    const meta = Object.keys(parsedMeta).length > 0
      ? parsedMeta
      : fallback
        ? parseSimpleFrontmatter(fallback.raw)
        : {};
    const body = stripDuplicateTitle(fallback && m.content === content ? fallback.body : m.content, meta);
    return { body, meta };
  } catch {
    if (fallback) {
      const meta = parseSimpleFrontmatter(fallback.raw);
      return { body: stripDuplicateTitle(fallback.body, meta), meta };
    }
    return { body: content, meta: {} };
  }
}

function splitFrontmatterBlock(content: string): { raw: string; body: string } | null {
  const withoutBom = content.replace(/^\uFEFF/, "");
  if (!withoutBom.startsWith("---\n") && !withoutBom.startsWith("---\r\n")) return null;

  const rest = withoutBom.replace(/^---[ \t]*\r?\n/, "");
  const match = rest.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match || match.index == null) return null;

  const raw = rest.slice(0, match.index);
  const body = rest.slice(match.index + match[0].length);
  return { raw, body };
}

function parseSimpleFrontmatter(raw: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  let listKey: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listKey && listItem) {
      const current = meta[listKey];
      if (Array.isArray(current)) current.push(parseFrontmatterScalar(listItem[1]));
      continue;
    }

    const entry = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!entry) continue;

    const [, key, rawValue = ""] = entry;
    const value = rawValue.trim();
    if (value === "") {
      meta[key] = [];
      listKey = key;
      continue;
    }

    meta[key] = parseFrontmatterScalar(value);
    listKey = null;
  }

  return meta;
}

function parseFrontmatterScalar(value: string): unknown {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseFlowList(trimmed);
  }
  return trimmed;
}

function stripDuplicateTitle(body: string, meta: Record<string, unknown>): string {
  if (typeof meta.title !== "string") return body;
  const h1Match = body.match(/^\s*#\s+(.+)\n?/);
  if (h1Match && h1Match[1].trim() === meta.title.trim()) {
    return body.replace(/^\s*#\s+.+\n?/, "");
  }
  return body;
}

/**
 * Playback clocks, `{% range %}` variables and `kiwi-data` records belong to
 * the page they were declared on. Module-level so remounting the same page
 * (closing the editor) keeps them, while arriving at another page clears them.
 */
let scopedPagePath: string | null = null;

function enterPageScope(path: string) {
  if (path === scopedPagePath) return;
  scopedPagePath = path;
  resetClocks();
  resetPageVars();
  resetPageData();
}

export function KiwiPage({ path = "", content: contentProp, tree, onNavigate, onEdit, onHistory, onRevealInTree, onToggleStar, isStarred, onTogglePin, isPinned, onDeleted, onDuplicated, onMoved, onTagClick, refreshKey, onPublishedChanged, onWikiLinkClick, onHeadingVisible: _onHeadingVisible, className }: Props) {
  const isHeadless = contentProp != null;
  const nav = onNavigate ?? (() => {});
  const features = useUIConfigStore((s) => s.features);
  const tagConfig = useUIConfigStore((s) => s.tags);
  const typedFences = useUIConfigStore((s) => s.typedFences);
  const typedFenceTags = useUIConfigStore((s) => s.typedFenceTags);

  const treeEntry = useMemo(() => findEntry(tree ?? null, path), [tree, path]);
  const isDir = !isHeadless && (treeEntry?.isDir ?? false);

  const [content, setContent] = useState<string | null>(isHeadless ? contentProp! : null);
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [viewDelta, setViewDelta] = useState<number | null>(null);
  const [lastAuthor, setLastAuthor] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [commentError, setCommentError] = useState(false);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [bookOrder, setBookOrder] = useState<BookOrder | null>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  // A layout effect on the path, not on the content: the outgoing page's
  // content is still rendered in this commit and the next page's widgets
  // mount only once its file has loaded, so nothing of the new page can have
  // joined a clock yet. Headless hosts own their content's lifecycle.
  useLayoutEffect(() => {
    if (!isHeadless) enterPageScope(path);
  }, [path, isHeadless]);

  // In headless mode, sync content from prop
  useEffect(() => {
    if (isHeadless) setContent(contentProp!);
  }, [isHeadless, contentProp]);

  useEffect(() => {
    if (isHeadless || isDir) return;
    if (!path) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    setLastModified(null);
    trackRecent(path);
    api
      .readFile(path)
      .then((r) => {
        if (!cancelled) {
          setContent(r.content);
          setLastModified(r.lastModified);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, [path, refreshKey, isDir, isHeadless]);

  useEffect(() => {
    invalidatePagePreview();
  }, [refreshKey]);

  useEffect(() => {
    if (isHeadless || !path) return;
    let cancelled = false;
    setBookOrder(null);
    const candidates = bookManifestCandidates(path);
    (async () => {
      for (const candidate of candidates) {
        try {
          const file = await api.readFile(candidate);
          if (cancelled) return;
          const parsedBook = parseBookManifest(file.content, dirOf(candidate));
          if (parsedBook) {
            setBookOrder(await decorateBookTitles(parsedBook));
            return;
          }
        } catch {
          /* try the next candidate */
        }
      }
      if (!cancelled) {
        const fallback = fallbackBookOrder(tree ?? null, path);
        setBookOrder(fallback ? await decorateBookTitles(fallback) : null);
      }
    })();
    return () => { cancelled = true; };
  }, [path, tree, isHeadless]);

  useEffect(() => {
    if (isHeadless || isDir || !path) return;
    let cancelled = false;
    setLocalNote(null);
    api.readLocalNote(path).then((note) => {
      if (!cancelled) setLocalNote(note);
    });
    return () => { cancelled = true; };
  }, [path, refreshKey, isDir, isHeadless]);

  useEffect(() => {
    if (isHeadless || isDir || !path) return;
    let cancelled = false;
    setVersionError(false);
    api.versions(path).then((r) => {
      if (cancelled || !r.versions.length) return;
      setLastAuthor(r.versions[0].author);
    }).catch(() => { if (!cancelled) setVersionError(true); });
    return () => { cancelled = true; };
  }, [path, isDir, isHeadless]);

  useEffect(() => {
    if (isHeadless || isDir || !path) return;
    let cancelled = false;
    setCommentError(false);
    api.listComments(path).then((r) => {
      if (!cancelled) setCommentCount(r.comments.length);
    }).catch(() => { if (!cancelled) setCommentError(true); });
    return () => { cancelled = true; };
  }, [path, refreshKey, isDir, isHeadless]);

  useEffect(() => {
    if (isHeadless || isDir || !path) return;
    let cancelled = false;
    setViewCount(null);
    setViewDelta(null);

    const legacyP = api.pageViews({ path, top: 1 }).catch(() => null);
    const trendP = api.analyticsViews("7d", path).catch(() => null);

    Promise.all([legacyP, trendP]).then(([legacy, trend]) => {
      if (cancelled) return;
      if (legacy?.results?.[0]) {
        setViewCount(legacy.results[0].count);
      } else {
        setViewCount(0);
      }
      if (trend?.time_series && trend.time_series.length > 0) {
        const weekTotal = trend.time_series.reduce((s, p) => s + p.count, 0);
        if (weekTotal > 0 && viewCount !== weekTotal) {
          setViewCount(weekTotal);
        }
      }
      if (trend?.top_pages?.[0]?.count != null) {
        setViewCount(trend.top_pages[0].count);
      }
    });

    return () => { cancelled = true; };
  }, [path, refreshKey, isDir, isHeadless]);

  const resolver = useMemo(() => buildResolver(tree ?? null), [tree]);

  const parsed = useMemo(() => {
    if (content == null) return { body: "", meta: {} as Record<string, unknown> };
    return parseMarkdownPage(content);
  }, [content]);

  const properties = useMemo(
    () => frontmatterProperties(parsed.meta, propertyHiddenKeys(tagConfig.banner, tagConfig.hide)),
    [parsed.meta, tagConfig.banner, tagConfig.hide],
  );
  const badges = useMemo(() => frontmatterBadges(parsed.meta), [parsed.meta]);
  const headerChips = useMemo(
    () => bannerChips(parsed.meta, tagConfig.banner),
    [parsed.meta, tagConfig.banner],
  );
  const headerChipTones = useMemo(
    () => assignTagTones(headerChips.map((chip) => chip.colorKey), tagConfig.colors),
    [headerChips, tagConfig.colors],
  );
  const reading = useMemo(() => readingTime(parsed.body), [parsed.body]);
  const frontmatterTitle = typeof parsed.meta.title === "string" ? parsed.meta.title : null;
  const titledBook = useMemo<BookOrder | null>(() => {
    if (!bookOrder) return null;
    if (!frontmatterTitle || !path) return bookOrder;
    return applyTitles(bookOrder, { [path]: frontmatterTitle });
  }, [bookOrder, frontmatterTitle, path]);

  const remarkPlugins = useMemo(() => kiwiRemarkPlugins({ resolver, fromPath: path }), [resolver, path]);
  const markdownComponents = useKiwiMarkdownComponents({
    path,
    navigate: nav,
    onWikiLinkClick,
    isComputedView: parsed.meta?.["kiwi-view"] === true,
    typedFences,
    typedFenceTags,
  });
  const readingNav: BookNav | null = titledBook && path ? navForPath(titledBook, path) : null;
  const statusBadge = badges.find((b) => b.key === "status");

  if (isDir && treeEntry) {
    const children = treeEntry.children ?? [];
    return (
      <div className="flex flex-col h-full">
        <StickyBreadcrumb path={path} onNavigate={nav} />
        <div className="flex-1 overflow-auto px-4 md:px-10 py-8 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-6">
            <Folder className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">{titleize(path) || "Root"}</h1>
          </div>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">This folder is empty.</p>
          ) : (
            <ul className="space-y-1">
              {children.map((child) => (
                <li key={child.path}>
                  <button
                    type="button"
                    onClick={() => nav(child.path.replace(/\/+$/, ""))}
                    className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground text-sm"
                  >
                    {child.isDir ? (
                      <Folder className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate">{titleize(child.name)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    const is404 = error.startsWith("Error: 404") || error.includes("404");
    return (
      <div className="flex flex-col h-full">
        <StickyBreadcrumb path={path} onNavigate={nav} />
        {is404 ? (
          <div className="flex-1 grid place-items-center">
            <div className="text-center max-w-md px-8">
              <FileQuestion className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h2 className="text-lg font-semibold text-foreground mb-1">Page not found</h2>
              <p className="text-sm text-muted-foreground mb-1">
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{path}</code>
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                This page may have been moved, renamed, or deleted.
              </p>
              <div className="flex flex-col gap-2 items-center">
                <Button size="sm" onClick={() => nav("")} className="gap-2">
                  Go to index
                </Button>
                <Button variant="outline" size="sm" onClick={() => nav(path)} className="gap-2">
                  <Plus className="h-3.5 w-3.5" /> Create this page
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-sm text-destructive font-mono">{error}</div>
        )}
      </div>
    );
  }
  if (content === null) {
    return (
      <div className="flex flex-col h-full">
        <StickyBreadcrumb path={path} onNavigate={nav} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className={"flex flex-col h-full" + (className ? " " + className : "")}>
      {/* ── Sticky breadcrumb bar (hidden in headless mode without a path) ── */}
      {!isHeadless && <StickyBreadcrumb path={path} onNavigate={nav} />}

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-auto kiwi-scroll">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          {/* ── Page header zone (hidden in headless/static mode) ── */}
          {!isHeadless && <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-tight">
                  {frontmatterTitle || titleize(path)}
                </h1>
                {statusBadge && (
                  <Badge
                    variant="outline"
                    className={"mt-2 " + statusColor(statusBadge.value)}
                  >
                    {statusBadge.value}
                  </Badge>
                )}
              </div>
              <div className="kiwi-page-actions flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
                {onRevealInTree && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onRevealInTree} className="h-8 w-8" aria-label="Show in sidebar">
                        <Crosshair className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Show in sidebar</TooltipContent>
                  </Tooltip>
                )}
                {onTogglePin && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onTogglePin} className="h-8 w-8" aria-label={isPinned ? "Unpin page" : "Pin page"}>
                        <Pin className={"h-4 w-4" + (isPinned ? " fill-current text-primary" : "")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{isPinned ? "Unpin" : "Pin"}</TooltipContent>
                  </Tooltip>
                )}
                <HostPageActions path={path} />
                {onToggleStar && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={onToggleStar} className="h-8 w-8" aria-label={isStarred ? "Unstar page" : "Star page"}>
                        <Star className={"h-4 w-4" + (isStarred ? " fill-amber-500 text-amber-500" : "")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{isStarred ? "Unstar" : "Star"}</TooltipContent>
                  </Tooltip>
                )}
                {features.history && onHistory && (
                  <Button variant="outline" size="sm" onClick={onHistory}>
                    <HistoryIcon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">History</span>
                  </Button>
                )}
                {features.edit && onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                </Button>
                )}
                {features.publish && (
                  <PublishButton path={path} onPublishedChanged={onPublishedChanged} />
                )}
                {features.edit && (
                <PageActions
                  path={path}
                  onDeleted={onDeleted}
                  onDuplicated={onDuplicated}
                  onMoved={onMoved}
                />
                )}
              </div>
            </div>

            {/* ── Metadata bar ── */}
            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground flex-wrap">
              {lastAuthor && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {lastAuthor}
                </span>
              )}
              {lastModified && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Last modified {formatRelative(lastModified)}
                </span>
              )}
              {commentCount > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquareQuote className="h-3 w-3" />
                  {commentCount} comment{commentCount === 1 ? "" : "s"}
                </span>
              )}
              {reading.words > 0 && (
                <span className="flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  {reading.words.toLocaleString()} words · {reading.minutes} min read
                </span>
              )}
              {viewCount != null && viewCount > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {viewCount.toLocaleString()} view{viewCount === 1 ? "" : "s"}
                  {viewDelta != null && viewDelta !== 0 && (
                    <span className={viewDelta > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                      ({viewDelta > 0 ? "+" : ""}{viewDelta.toFixed(0)}%)
                    </span>
                  )}
                </span>
              )}
              {(versionError || commentError) && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400" title={
                  [versionError && "version history", commentError && "comments"].filter(Boolean).join(" and ") + " unavailable"
                }>
                  <AlertTriangle className="h-3 w-3" />
                  Some metadata unavailable
                </span>
              )}
            </div>

            {/* ── Banner tags ── */}
            {headerChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {headerChips.map((chip, index) => (
                  <MetaChip
                    key={`${chip.key}:${chip.colorKey}:${index}`}
                    chip={chip}
                    tone={headerChipTones[chip.colorKey]}
                    onClick={onTagClick}
                  />
                ))}
              </div>
            )}

            {/* ── Properties ── */}
            {properties.length > 0 && (
              <FrontmatterProperties
                properties={properties}
                colors={tagConfig.colors}
                onTagClick={onTagClick}
              />
            )}
          </div>}

          {/* ── Content zone + ToC ── */}
          <KiwiQuizProvider pagePath={path}>
          <div className="flex gap-6">
            <article className="min-w-0 flex-1">
              <KiwiQuizScore />
              {isExcalidrawMarkdown(content, parsed.meta) ? (
                <ErrorBoundary>
                  <ExcalidrawMarkdownPreview markdown={content} title={frontmatterTitle || titleize(path)} />
                </ErrorBoundary>
              ) : (
              <div
                ref={proseRef}
                className="kiwi-prose"
                onClick={(e) => {
                  // Delegate inline tag clicks
                  const target = (e.target as HTMLElement).closest<HTMLElement>(".kiwi-inline-tag");
                  if (target) {
                    e.preventDefault();
                    const tag = target.dataset.tag;
                    if (tag) onTagClick?.(tag);
                  }
                }}
              >
                <ErrorBoundary>
                <ReactMarkdown
                  remarkPlugins={remarkPlugins}
                  rehypePlugins={pageRehypePlugins}
                  components={markdownComponents}
                >
                  {stripObsidianComments(parsed.body)}
                </ReactMarkdown>
                </ErrorBoundary>
              </div>
              )}

              {readingNav && titledBook && (
                <KiwiPageNav nav={readingNav} order={titledBook} onNavigate={nav} />
              )}

              {/* ── Footer zone: fixed order, collapsible (hidden in headless mode) ── */}
              {!isHeadless && (
              <div className="mt-12 space-y-2">
                {localNote && (
                  <CollapsibleFooterSection
                    icon={<NotebookPen className="h-4 w-4" />}
                    title="My Notes"
                    storageKey="footer-local-notes"
                    defaultOpen
                    className="kiwi-local-notes-section"
                  >
                    <div className="kiwi-prose kiwi-local-notes">
                      <ErrorBoundary>
                        <ReactMarkdown
                          remarkPlugins={remarkPlugins}
                          rehypePlugins={notesRehypePlugins}
                          components={markdownComponents}
                        >
                          {stripObsidianComments(localNote.replace(/^---[\s\S]*?---\n*/, ""))}
                        </ReactMarkdown>
                      </ErrorBoundary>
                    </div>
                  </CollapsibleFooterSection>
                )}

                <KiwiComments
                  path={path}
                  containerRef={proseRef}
                  renderKey={content}
                  refreshKey={refreshKey}
                />

                <CollapsibleFooterSection
                  icon={<Link2 className="h-4 w-4" />}
                  title="Backlinks"
                  storageKey="footer-backlinks"
                  className="kiwi-backlinks-section"
                >
                  <KiwiBacklinks path={path} onNavigate={nav} refreshKey={refreshKey} />
                </CollapsibleFooterSection>
              </div>
              )}

              {/* ── File info (hidden in headless mode) ── */}
              {!isHeadless && (
              <div className="border-t border-border mt-8 pt-4 pb-2">
                <div className="text-xs text-muted-foreground flex items-center gap-3 min-w-0">
                  <FileAxis3D className="h-3.5 w-3.5 shrink-0" />
                  <code className="font-mono break-all min-w-0">{path}</code>
                </div>
              </div>
              )}
            </article>
            {!isExcalidrawMarkdown(content, parsed.meta) && <KiwiToC markdown={parsed.body} containerRef={proseRef} />}
          </div>
          </KiwiQuizProvider>
        </div>
      </div>
    </div>
  );
}

/* ── Frontmatter properties ── */

function MetaChip({
  chip,
  tone,
  onClick,
}: {
  chip: FrontmatterChip;
  tone?: TagTone;
  onClick?: (value: string) => void;
}) {
  return (
    <Badge
      variant="outline"
      className={
        "inline-flex items-center shrink-0 whitespace-nowrap cursor-pointer hover:bg-primary/20 transition-colors gap-1 " +
        (tone?.className ?? "text-muted-foreground")
      }
      style={tone?.style}
      onClick={() => onClick?.(chip.colorKey)}
    >
      {chip.key === "tags" && <Tag className="h-3 w-3" />}
      {chip.count != null && chip.count > 0 ? `${chip.label} ${chip.count}` : chip.label}
    </Badge>
  );
}

function FrontmatterProperties({
  properties,
  colors,
  onTagClick,
}: {
  properties: FrontmatterProperty[];
  colors: Record<string, string>;
  onTagClick?: (tag: string) => void;
}) {
  return (
    <section className="mt-6 border-t border-border/70 pt-4" aria-label="Properties">
      <div className="mb-2 text-sm font-semibold text-foreground">Properties</div>
      <div className="space-y-1.5 text-sm">
        {properties.map((property) => (
          <div
            key={property.key}
            className="grid grid-cols-1 sm:grid-cols-[minmax(8rem,12rem)_1fr] gap-1 sm:gap-4 rounded-md px-2 py-1.5 hover:bg-muted/40"
          >
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <PropertyIcon kind={property.kind} />
              <span className="truncate font-medium">{property.key}</span>
            </div>
            <div className="min-w-0 text-foreground/90">
              <PropertyValue property={property} colors={colors} onTagClick={onTagClick} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PropertyIcon({ kind }: { kind: FrontmatterProperty["kind"] }) {
  const className = "h-4 w-4 shrink-0";
  if (kind === "date") return <Calendar className={className} />;
  if (kind === "boolean") return <CheckSquare className={className} />;
  if (kind === "list" || kind === "object") return <List className={className} />;
  return <Type className={className} />;
}

function PropertyValue({
  property,
  colors,
  onTagClick,
}: {
  property: FrontmatterProperty;
  colors: Record<string, string>;
  onTagClick?: (tag: string) => void;
}) {
  const { key, value } = property;

  return (
    <SemanticFrontmatterValue
      propertyKey={key}
      value={value}
      colors={colors}
      onTagClick={onTagClick}
    />
  );
}

function SemanticFrontmatterValue({
  propertyKey,
  value,
  colors,
  onTagClick,
}: {
  propertyKey: string;
  value: unknown;
  colors: Record<string, string>;
  onTagClick?: (tag: string) => void;
}) {
  const pair = labeledCount(value);
  if (pair) {
    return (
      <MetaChip
        chip={{ key: propertyKey, colorKey: pair.label, label: pair.label, count: pair.count }}
        tone={resolveTagTone(pair.label, colors) ?? hslTone(pair.label)}
        onClick={onTagClick}
      />
    );
  }

  const tuples = parseLabeledCounts(value);
  if (tuples.length > 0 && (typeof value === "string" || Array.isArray(value))) {
    return (
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`${propertyKey} values`}>
        {tuples.map((item, index) => (
          <li key={`${propertyKey}-${item.label}-${index}`} className="shrink-0">
            <MetaChip
              chip={{ key: propertyKey, colorKey: item.label, label: item.label, count: item.count }}
              tone={resolveTagTone(item.label, colors) ?? hslTone(item.label)}
              onClick={onTagClick}
            />
          </li>
        ))}
      </ul>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[]</span>;

    return (
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`${propertyKey} values`}>
        {value.map((item, index) => (
          <li key={`${propertyKey}-${index}`} className="min-w-0">
            <SemanticFrontmatterValue propertyKey={propertyKey} value={item} colors={colors} onTagClick={onTagClick} />
          </li>
        ))}
      </ul>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, nestedValue]) => nestedValue != null);
    if (entries.length === 0) return <span className="text-muted-foreground">{`{}`}</span>;

    return (
      <dl className="m-0 space-y-1 rounded-md border border-border/60 p-2">
        {entries.map(([nestedKey, nestedValue]) => (
          <div key={nestedKey} className="grid grid-cols-1 sm:grid-cols-[minmax(6rem,10rem)_1fr] gap-1 sm:gap-2">
            <dt className="min-w-0 truncate text-muted-foreground">{nestedKey}</dt>
            <dd className="m-0 min-w-0">
              <SemanticFrontmatterValue propertyKey={nestedKey} value={nestedValue} colors={colors} onTagClick={onTagClick} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  if (typeof value === "boolean") {
    return (
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={value} readOnly aria-label={String(value)} className="h-4 w-4" />
        <span className="text-muted-foreground">{String(value)}</span>
      </label>
    );
  }

  const text = formatFrontmatterValue(value);
  const isLong = text.length > 80;
  const isTag = propertyKey === "tags" && typeof value === "string";

  if (isTag) {
    return (
      <button
        type="button"
        className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs hover:bg-primary/20"
        onClick={() => onTagClick?.(text)}
      >
        {text}
      </button>
    );
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return <time dateTime={value.toISOString()}>{text}</time>;
  }

  if (isDateLikeString(value)) {
    return <time dateTime={text}>{text}</time>;
  }

  if (typeof value === "string" && /^https?:\/\/.+/.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-primary hover:underline break-all"
      >
        {text}
      </a>
    );
  }

  return (
    <span className={isLong ? "block whitespace-pre-wrap break-words leading-relaxed" : "break-words"}>
      {text}
    </span>
  );
}

/* ── Sticky Breadcrumb ── */

function StickyBreadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  return (
    <div className="kiwi-breadcrumb-sticky sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border shrink-0">
      <div className="px-4 md:px-8 py-2 max-w-6xl mx-auto">
        <KiwiBreadcrumb path={path} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/* ── Collapsible footer section ── */

function CollapsibleFooterSection({
  icon,
  title,
  children,
  storageKey,
  defaultOpen,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(`kiwifs-${storageKey}`);
      if (stored !== null) return stored === "1";
    } catch {}
    return !defaultOpen;
  });

  return (
    <div className={"border border-border rounded-lg" + (className ? " " + className : "")}>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          try { localStorage.setItem(`kiwifs-${storageKey}`, next ? "1" : "0"); } catch {}
        }}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {collapsed
          ? <ChevronRight className="h-4 w-4" />
          : <ChevronDown className="h-4 w-4" />}
      </button>
      {!collapsed && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ── Helpers ── */

function formatRelative(httpDate: string): string {
  try {
    const d = new Date(httpDate);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return httpDate;
  }
}

function statusColor(value: string): string {
  const v = value.toLowerCase().replace(/[^a-z]/g, "");
  if (["done", "complete", "completed", "live", "published"].includes(v))
    return "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400";
  if (["inprogress", "wip", "active", "started"].includes(v))
    return "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400";
  if (["draft", "todo", "planned"].includes(v))
    return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (["blocked", "stuck", "cancelled", "deprecated"].includes(v))
    return "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400";
  return "";
}

function frontmatterProperties(
  meta: Record<string, unknown>,
  hidden: Set<string>,
): FrontmatterProperty[] {
  return Object.entries(meta)
    .filter(([key, value]) => value != null && !hidden.has(key))
    .map(([key, value]) => ({
      key,
      value,
      kind: frontmatterKind(value),
    }));
}

function frontmatterKind(value: unknown): FrontmatterProperty["kind"] {
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date || isDateLikeString(value)) return "date";
  if (Array.isArray(value)) return "list";
  if (isPlainObject(value)) return "object";
  return "text";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value) && !(value instanceof Date);
}

function isDateLikeString(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/.test(value);
}

function formatFrontmatterValue(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toLocaleDateString();
  }
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatFrontmatterValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function frontmatterBadges(
  meta: Record<string, unknown>
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(meta)) {
    if (key === "title") continue;
    if (raw == null) continue;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item == null) continue;
        out.push({ key, value: formatFrontmatterValue(item) });
      }
      continue;
    }
    if (typeof raw === "object" && !(raw instanceof Date)) {
      out.push({ key, value: JSON.stringify(raw) });
      continue;
    }
    out.push({ key, value: formatFrontmatterValue(raw) });
  }
  return out;
}
