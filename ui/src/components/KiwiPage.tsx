import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import matter from "gray-matter";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import { AlertTriangle, BookOpen, Bug, Calendar, CheckCircle2, CheckSquare, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Crosshair, Edit, Eye, File, FileAxis3D, FileQuestion, Flame, Folder, HelpCircle, History as HistoryIcon, Info, Lightbulb, Link2, List, ListChecks, MessageSquareQuote, NotebookPen, Pin, Plus, Quote, ScrollText, ShieldAlert, Star, Tag, TriangleAlert, Type, User, XCircle, Zap } from "lucide-react";
import { api, type TreeEntry } from "@kw/lib/api";
import { dirOf, titleize } from "@kw/lib/paths";
import { readingTime } from "@kw/lib/readingTime";
import { HostPageActions } from "./HostPageActions";
import { KiwiBreadcrumb } from "./KiwiBreadcrumb";
import { KiwiToC } from "./KiwiToC";
import { KiwiBacklinks } from "./KiwiBacklinks";
import { KiwiComments } from "./KiwiComments";
import { KiwiBookmarks } from "./KiwiBookmarks";
import { KiwiQuery } from "./KiwiQuery";
import { PageActions } from "./PageActions";
import { PublishButton } from "./PublishButton";
import { ShikiCode } from "./ShikiCode";
import { MermaidDiagram } from "./MermaidDiagram";
import { KiwiChart } from "./KiwiChart";
import { KiwiApp } from "./KiwiApp";
import { KiwiDiff } from "./KiwiDiff";
import { KiwiKanbanBlock } from "./KiwiKanbanBlock";
import { KiwiColor } from "./KiwiColor";
import { KiwiProgress } from "./KiwiProgress";
import { KiwiPlayground } from "./KiwiPlayground";
import { KiwiTabs } from "./KiwiTabs";
import { KiwiColumns } from "./KiwiColumns";
import { ExcalidrawMarkdownPreview, isExcalidrawMarkdown } from "./ExcalidrawMarkdownPreview";
import { ErrorBoundary } from "./ErrorBoundary";
import { KiwiWidget } from "./KiwiWidget";
import { CodeRunner } from "@kw/widgets/CodeRunner";
import { PageTracker } from "@kw/widgets/PageTracker";

import { PageSkeleton } from "./PageSkeleton";
import { trackRecent } from "./KiwiFavorites";
import { Badge } from "@kw/components/ui/badge";
import { Button } from "@kw/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kw/components/ui/tooltip";
import remarkEmoji from "remark-emoji";
import remarkSupersub from "remark-supersub";
import remarkDefinitionList from "remark-definition-list";
import { buildResolver, remarkWikiLinks } from "@kw/lib/wikiLinks";
import { remarkMark, stripObsidianComments, remarkInlineTags, rehypeCodeMeta } from "@kw/lib/remarkPlugins";
import remarkDirective from "remark-directive";
import { remarkKiwiDirectives } from "@kw/lib/remarkDirectives";

type Props = {
  path: string;
  tree: TreeEntry | null;
  onNavigate: (path: string) => void;
  onEdit: () => void;
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
};

type FrontmatterProperty = {
  key: string;
  value: unknown;
  kind: "text" | "list" | "date" | "boolean" | "object";
};

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "details", "summary", "kbd", "mark", "span", "div", "figure", "figcaption",
    "video", "audio", "source", "iframe", "section", "sup", "sub", "dl", "dt", "dd", "abbr",
    // SVG elements
    "svg", "path", "circle", "rect", "ellipse", "line", "polyline", "polygon",
    "g", "defs", "use", "text", "tspan", "clipPath", "mask", "pattern",
    "linearGradient", "radialGradient", "stop", "filter",
    "animate", "animateTransform", "animateMotion", "set",
    "foreignObject", "marker", "symbol", "title", "desc", "metadata",
    "feGaussianBlur", "feOffset", "feMerge", "feMergeNode", "feBlend",
    "feColorMatrix", "feComposite", "feFlood", "feMorphology",
    // Style element (for scoped @keyframes in SVG)
    "style",
  ],
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "irc", "ircs", "mailto", "xmpp", "kiwi", "kiwi-missing"],
  },
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className", "style", "role", "id",
      "data-footnotes", "data-footnote-ref", "data-footnote-backref",
      "data-tag", "metastring",
      "data-kiwi-directive", "data-label", "data-ratio", "data-cols",
      "aria-describedby", "aria-label"],
    a: [...(defaultSchema.attributes?.a || []), "className", "data-kiwi-target", "data-kiwi-missing"],
    iframe: ["src", "title", "className", "style"],
    video: ["controls", "preload", "className"],
    audio: ["controls", "preload", "className"],
    source: ["src", "type"],
    img: [...(defaultSchema.attributes?.img || []), "width", "height"],
    abbr: ["title"],
    // SVG attributes
    svg: ["viewBox", "xmlns", "xmlnsXlink", "width", "height", "fill", "stroke",
      "className", "preserveAspectRatio", "overflow"],
    path: ["d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin",
      "opacity", "transform", "fillRule", "clipRule", "strokeDasharray", "strokeDashoffset"],
    circle: ["cx", "cy", "r", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    line: ["x1", "y1", "x2", "y2", "stroke", "strokeWidth", "strokeLinecap", "opacity", "transform"],
    polyline: ["points", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "opacity", "transform"],
    polygon: ["points", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    g: ["fill", "stroke", "strokeWidth", "opacity", "transform", "clipPath", "mask", "filter"],
    defs: [],
    use: ["href", "xlinkHref", "x", "y", "width", "height", "transform"],
    text: ["x", "y", "dx", "dy", "textAnchor", "dominantBaseline", "fontSize",
      "fontFamily", "fontWeight", "fill", "opacity", "transform"],
    tspan: ["x", "y", "dx", "dy", "textAnchor", "dominantBaseline", "fontSize",
      "fontFamily", "fontWeight", "fill"],
    clipPath: ["id"],
    mask: ["id", "x", "y", "width", "height", "maskUnits"],
    pattern: ["id", "x", "y", "width", "height", "patternUnits", "patternTransform"],
    linearGradient: ["id", "x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform"],
    radialGradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits", "gradientTransform"],
    stop: ["offset", "stopColor", "stopOpacity"],
    filter: ["id", "x", "y", "width", "height", "filterUnits"],
    animate: ["attributeName", "from", "to", "values", "dur", "repeatCount",
      "begin", "end", "fill", "keyTimes", "keySplines", "calcMode"],
    animateTransform: ["attributeName", "type", "from", "to", "values", "dur",
      "repeatCount", "begin", "end", "fill", "additive", "accumulate"],
    animateMotion: ["path", "dur", "repeatCount", "begin", "end", "fill", "rotate", "keyPoints", "keyTimes"],
    set: ["attributeName", "to", "begin", "dur", "end", "fill"],
    foreignObject: ["x", "y", "width", "height"],
    marker: ["id", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits"],
    symbol: ["id", "viewBox", "preserveAspectRatio"],
    feGaussianBlur: ["in", "stdDeviation", "result"],
    feOffset: ["in", "dx", "dy", "result"],
    feMerge: [],
    feMergeNode: ["in"],
    feBlend: ["in", "in2", "mode", "result"],
    feColorMatrix: ["in", "type", "values", "result"],
    feComposite: ["in", "in2", "operator", "k1", "k2", "k3", "k4", "result"],
    feFlood: ["floodColor", "floodOpacity", "result"],
    feMorphology: ["in", "operator", "radius", "result"],
  },
};

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

const CALLOUT_PREFIXES: Array<{ emoji: string; cls: string }> = [
  { emoji: "ℹ️", cls: "kiwi-callout-info" },
  { emoji: "⚠️", cls: "kiwi-callout-warn" },
  { emoji: "🛑", cls: "kiwi-callout-error" },
];

function splitCallout(text: string): { emoji: string; cls: string; rest: string } | null {
  const trimmed = text.trimStart();
  for (const p of CALLOUT_PREFIXES) {
    if (trimmed.startsWith(p.emoji)) {
      return { emoji: p.emoji, cls: p.cls, rest: trimmed.slice(p.emoji.length).trimStart() };
    }
  }
  return null;
}

function flattenBlockquoteText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (!children) return "";
  if (Array.isArray(children)) return children.map(flattenBlockquoteText).join("");
  if (typeof children === "object" && "props" in (children as any)) {
    return flattenBlockquoteText((children as any).props?.children);
  }
  return String(children);
}

function stripAdmonitionTag(children: React.ReactNode): React.ReactNode {
  if (!Array.isArray(children)) return children;
  let stripped = false;
  return children.map((child) => {
    if (stripped) return child;
    // Skip whitespace-only text nodes that react-markdown inserts between elements
    if (typeof child === "string" && !child.trim()) return child;
    if (!child || typeof child !== "object" || !("props" in child)) return child;
    const inner = (child as any).props?.children;
    if (!inner) return child;
    const arr = Array.isArray(inner) ? inner : [inner];
    const first = arr[0];
    if (typeof first !== "string") return child;
    // Strip the [!TYPE] tag (+ optional fold marker + optional custom title) from the first line
    const tagMatch = first.match(ADMONITION_TAG_RE);
    if (!tagMatch) return child;
    stripped = true;
    // Remove everything up to and including the tag on the first line
    const afterTag = first.slice(tagMatch[0].length);
    // Also strip optional fold marker and custom title on the same line
    const cleaned = afterTag.replace(/^[+-]?[^\S\n]*[^\n]*/, "");
    // Remove leading newline left after stripping the first line
    const trimmed = cleaned.replace(/^\n/, "");
    const newChildren = trimmed ? [trimmed, ...arr.slice(1)] : arr.slice(1);
    return { ...(child as any), props: { ...(child as any).props, children: newChildren } };
  });
}

const ADMONITION_TYPES: Record<string, { icon: typeof Info; cls: string; label: string }> = {
  // Blue family
  NOTE:      { icon: Info,          cls: "kiwi-admonition-note",      label: "Note" },
  INFO:      { icon: Info,          cls: "kiwi-admonition-note",      label: "Info" },
  TODO:      { icon: ClipboardList, cls: "kiwi-admonition-note",      label: "Todo" },
  // Green family
  TIP:       { icon: Lightbulb,     cls: "kiwi-admonition-tip",       label: "Tip" },
  HINT:      { icon: Lightbulb,     cls: "kiwi-admonition-tip",       label: "Hint" },
  SUCCESS:   { icon: CheckCircle2,  cls: "kiwi-admonition-tip",       label: "Success" },
  CHECK:     { icon: CheckCircle2,  cls: "kiwi-admonition-tip",       label: "Check" },
  DONE:      { icon: ListChecks,    cls: "kiwi-admonition-tip",       label: "Done" },
  // Purple family
  IMPORTANT: { icon: CircleAlert,   cls: "kiwi-admonition-important", label: "Important" },
  ABSTRACT:  { icon: ScrollText,    cls: "kiwi-admonition-important", label: "Abstract" },
  SUMMARY:   { icon: ScrollText,    cls: "kiwi-admonition-important", label: "Summary" },
  TLDR:      { icon: ScrollText,    cls: "kiwi-admonition-important", label: "TL;DR" },
  EXAMPLE:   { icon: Zap,           cls: "kiwi-admonition-important", label: "Example" },
  // Yellow family
  WARNING:   { icon: TriangleAlert, cls: "kiwi-admonition-warning",   label: "Warning" },
  CAUTION:   { icon: Flame,         cls: "kiwi-admonition-caution",   label: "Caution" },
  ATTENTION: { icon: TriangleAlert, cls: "kiwi-admonition-warning",   label: "Attention" },
  QUESTION:  { icon: HelpCircle,    cls: "kiwi-admonition-warning",   label: "Question" },
  HELP:      { icon: HelpCircle,    cls: "kiwi-admonition-warning",   label: "Help" },
  FAQ:       { icon: HelpCircle,    cls: "kiwi-admonition-warning",   label: "FAQ" },
  // Red family
  DANGER:    { icon: ShieldAlert,   cls: "kiwi-admonition-caution",   label: "Danger" },
  FAILURE:   { icon: XCircle,       cls: "kiwi-admonition-caution",   label: "Failure" },
  FAIL:      { icon: XCircle,       cls: "kiwi-admonition-caution",   label: "Fail" },
  ERROR:     { icon: XCircle,       cls: "kiwi-admonition-caution",   label: "Error" },
  BUG:       { icon: Bug,           cls: "kiwi-admonition-caution",   label: "Bug" },
  MISSING:   { icon: FileQuestion,  cls: "kiwi-admonition-caution",   label: "Missing" },
  // Gray family
  QUOTE:     { icon: Quote,         cls: "kiwi-admonition-quote",     label: "Quote" },
  CITE:      { icon: Quote,         cls: "kiwi-admonition-quote",     label: "Cite" },
};

// Build the admonition type regex dynamically from ADMONITION_TYPES keys
const ADMONITION_TYPE_KEYS = Object.keys(ADMONITION_TYPES).join("|");
const ADMONITION_TAG_RE = new RegExp(`^\\[!(${ADMONITION_TYPE_KEYS})\\]`);

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
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => parseFrontmatterScalar(s));
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

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".heic", ".heif", ".ico"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogv", ".mov"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".opus", ".aac", ".weba"]);

function classifyMedia(src: string): "image" | "video" | "audio" | "pdf" | "unknown" {
  if (!src) return "unknown";
  const url = src.split("?")[0].split("#")[0];
  const dot = url.lastIndexOf(".");
  if (dot === -1) return "unknown";
  const ext = url.substring(dot).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  return "unknown";
}

export function KiwiPage({ path, tree, onNavigate, onEdit, onHistory, onRevealInTree, onToggleStar, isStarred, onTogglePin, isPinned, onDeleted, onDuplicated, onMoved, onTagClick, refreshKey, onPublishedChanged }: Props) {
  const treeEntry = useMemo(() => findEntry(tree, path), [tree, path]);
  const isDir = treeEntry?.isDir ?? false;

  const [content, setContent] = useState<string | null>(null);
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [viewDelta, setViewDelta] = useState<number | null>(null);
  const [lastAuthor, setLastAuthor] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [commentError, setCommentError] = useState(false);
  const [myNote, setMyNote] = useState<string | null>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDir) return;
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
  }, [path, refreshKey, isDir]);

  useEffect(() => {
    if (isDir) return;
    let cancelled = false;
    setMyNote(null);
    api.readMyNote(path).then((note) => {
      if (!cancelled) setMyNote(note);
    });
    return () => { cancelled = true; };
  }, [path, refreshKey, isDir]);

  useEffect(() => {
    if (isDir) return;
    let cancelled = false;
    setVersionError(false);
    api.versions(path).then((r) => {
      if (cancelled || !r.versions.length) return;
      setLastAuthor(r.versions[0].author);
    }).catch(() => { if (!cancelled) setVersionError(true); });
    return () => { cancelled = true; };
  }, [path, isDir]);

  useEffect(() => {
    if (isDir) return;
    let cancelled = false;
    setCommentError(false);
    api.listComments(path).then((r) => {
      if (!cancelled) setCommentCount(r.comments.length);
    }).catch(() => { if (!cancelled) setCommentError(true); });
    return () => { cancelled = true; };
  }, [path, refreshKey, isDir]);

  useEffect(() => {
    if (isDir) return;
    let cancelled = false;
    setViewCount(null);
    setViewDelta(null);

    // Fetch view count from legacy endpoint, plus v2 trend data.
    const legacyP = api.pageViews({ path, top: 1 }).catch(() => null);
    const trendP = api.analyticsViews("7d", path).catch(() => null);

    Promise.all([legacyP, trendP]).then(([legacy, trend]) => {
      if (cancelled) return;
      if (legacy?.results?.[0]) {
        setViewCount(legacy.results[0].count);
      } else {
        setViewCount(0);
      }
      // Compute weekly delta if time series available.
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
  }, [path, refreshKey, isDir]);

  const resolver = useMemo(() => buildResolver(tree), [tree]);

  const parsed = useMemo(() => {
    if (content == null) return { body: "", meta: {} as Record<string, unknown> };
    return parseMarkdownPage(content);
  }, [content]);

  const properties = useMemo(() => frontmatterProperties(parsed.meta), [parsed.meta]);
  const badges = useMemo(() => frontmatterBadges(parsed.meta), [parsed.meta]);
  const reading = useMemo(() => readingTime(parsed.body), [parsed.body]);
  const frontmatterTitle = typeof parsed.meta.title === "string" ? parsed.meta.title : null;
  const statusBadge = badges.find((b) => b.key === "status");
  const tagBadges = badges.filter((b) => b.key === "tags");

  if (isDir && treeEntry) {
    const children = treeEntry.children ?? [];
    return (
      <div className="flex flex-col h-full">
        <StickyBreadcrumb path={path} onNavigate={onNavigate} />
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
                    onClick={() => onNavigate(child.path.replace(/\/+$/, ""))}
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
        <StickyBreadcrumb path={path} onNavigate={onNavigate} />
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
                <Button size="sm" onClick={() => onNavigate("")} className="gap-2">
                  Go to index
                </Button>
                <Button variant="outline" size="sm" onClick={() => onNavigate(path)} className="gap-2">
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
        <StickyBreadcrumb path={path} onNavigate={onNavigate} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky breadcrumb bar ── */}
      <StickyBreadcrumb path={path} onNavigate={onNavigate} />

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-auto kiwi-scroll">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          {/* ── Page header zone ── */}
          <div className="mb-6">
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
                {onHistory && (
                  <Button variant="outline" size="sm" onClick={onHistory}>
                    <HistoryIcon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">History</span>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                </Button>
                <PublishButton path={path} onPublishedChanged={onPublishedChanged} />
                <PageActions
                  path={path}
                  onDeleted={onDeleted}
                  onDuplicated={onDuplicated}
                  onMoved={onMoved}
                />
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

            {/* ── Tags ── */}
            {tagBadges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {tagBadges.map((b) => (
                  <Badge
                    key={b.value}
                    variant="secondary"
                    className="cursor-pointer hover:bg-primary/20 transition-colors gap-1"
                    onClick={() => onTagClick?.(b.value)}
                  >
                    <Tag className="h-3 w-3" />
                    {b.value}
                  </Badge>
                ))}
              </div>
            )}

            {/* ── Properties ── */}
            {properties.length > 0 && (
              <FrontmatterProperties
                properties={properties}
                onTagClick={onTagClick}
              />
            )}
          </div>

          {/* ── Content zone + ToC ── */}
          <div className="flex gap-6">
            <article className="min-w-0 flex-1">
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
                  remarkPlugins={[
                    remarkGfm,
                    remarkMath,
                    remarkMark,
                    remarkInlineTags,
                    remarkEmoji,
                    remarkSupersub,
                    remarkDefinitionList,
                    remarkDirective,
                    remarkKiwiDirectives,
                    [remarkWikiLinks, { resolver }],
                  ]}
                  rehypePlugins={[
                    rehypeCodeMeta,
                    rehypeRaw,
                    [rehypeSanitize, sanitizeSchema],
                    rehypeKatex,
                    rehypeSlug,
                    [rehypeAutolinkHeadings, { behavior: "wrap" }],
                  ]}
                  components={{
                    a: ({ href, children, node: _node, ...rest }) => {
                      const h = href ?? "";
                      if (h.startsWith("#kiwi:")) {
                        const raw = h.slice("#kiwi:".length);
                        const hashIdx = raw.indexOf("#");
                        const pagePath = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
                        const anchor = hashIdx >= 0 ? raw.slice(hashIdx) : "";
                        return (
                          <a
                            href={`#${raw}`}
                            onClick={(e) => {
                              e.preventDefault();
                              onNavigate(pagePath);
                              if (anchor) {
                                requestAnimationFrame(() => {
                                  setTimeout(() => {
                                    const el = document.getElementById(anchor.slice(1));
                                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 100);
                                });
                              }
                            }}
                            className="wiki-link"
                            {...(rest as any)}
                          >
                            {children}
                          </a>
                        );
                      }
                      if (h.startsWith("#kiwi-missing:")) {
                        const target = h.slice("#kiwi-missing:".length);
                        return (
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              onNavigate(`${target}.md`);
                            }}
                            title={`Missing: ${target} — click to create`}
                            className="wiki-link-missing"
                            {...(rest as any)}
                          >
                            {children}
                          </a>
                        );
                      }
                      return (
                        <a
                          href={h}
                          target={h.startsWith("http") ? "_blank" : undefined}
                          rel={h.startsWith("http") ? "noreferrer" : undefined}
                          {...(rest as any)}
                        >
                          {children}
                        </a>
                      );
                    },
                    code: ({ className, children, node, ...rest }: any) => {
                      const match = /language-([A-Za-z0-9_:.-]+)/.exec(className || "");
                      const lang = match ? match[1] : undefined;
                      const raw = String(children).replace(/\n$/, "");
                      if (lang === "widget:code") {
                        const codeMeta: string = node?.data?.meta || node?.properties?.metastring || "";
                        const codeLangMatch = codeMeta.match(/lang=(\w+)/);
                        const codeLang = codeLangMatch ? codeLangMatch[1] : "python";
                        return <CodeRunner source={raw} lang={codeLang} />;
                      }
                      if (lang === "widget:tracker") {
                        return <PageTracker onNavigate={onNavigate} stateName={raw.trim() || "progress"} />;
                      }
                      if (lang?.startsWith("widget:")) {
                        return <KiwiWidget name={lang.slice("widget:".length)} source={raw} />;
                      }
                      if (lang === "kiwi-query") {
                        return <KiwiQuery source={raw} onNavigate={onNavigate} isComputedView={parsed.meta?.["kiwi-view"] === true} />;
                      }
                      if (lang === "mermaid") {
                        return <MermaidDiagram chart={raw} />;
                      }
                      if (lang === "kiwi-chart") {
                        return <KiwiChart source={raw} />;
                      }
                      if (lang === "kiwi-color") {
                        return <KiwiColor source={raw} />;
                      }
                      if (lang === "kiwi-progress") {
                        return <KiwiProgress source={raw} />;
                      }
                      if (lang === "kiwi-playground") {
                        return <KiwiPlayground source={raw} />;
                      }
                      if (lang === "kiwi-kanban") {
                        return <KiwiKanbanBlock source={raw} />;
                      }
                      if (!lang || !raw.includes("\n")) {
                        return <code className={className} {...rest}>{children}</code>;
                      }
                      // Extract meta string from the code fence (node.data.meta)
                      const meta: string = node?.data?.meta || node?.properties?.metastring || "";
                      if (lang === "kiwi-app") {
                        return <KiwiApp source={raw} meta={meta} />;
                      }
                      if (lang === "kiwi-diff") {
                        return <KiwiDiff source={raw} meta={meta} />;
                      }
                      const titleMatch = meta.match(/title="([^"]+)"/);
                      const title = titleMatch ? titleMatch[1] : undefined;
                      const hlMatch = meta.match(/\{([\d,\s-]+)\}/);
                      const highlightLines = hlMatch ? parseLineRanges(hlMatch[1]) : undefined;
                      return <ShikiCode code={raw} lang={lang} title={title} highlightLines={highlightLines} />;
                    },
                    pre: ({ children }) => <>{children}</>,
                    div: ({ children, node: _node, ...rest }: any) => {
                      const props = rest as Record<string, unknown>;
                      const directive = props["data-kiwi-directive"];
                      if (directive === "tabs") {
                        return <KiwiTabs>{children}</KiwiTabs>;
                      }
                      if (directive === "columns") {
                        return (
                          <KiwiColumns
                            ratio={props["data-ratio"] as string | undefined}
                            cols={props["data-cols"] as string | undefined}
                          >
                            {children}
                          </KiwiColumns>
                        );
                      }
                      return <div {...(rest as any)}>{children}</div>;
                    },
                    img: ({ src, alt, node: _node, width, height, ...rest }) => {
                      let resolvedSrc = src as string;
                      if (resolvedSrc && !resolvedSrc.startsWith("http") && !resolvedSrc.startsWith("/raw/") && !resolvedSrc.startsWith("/api/")) {
                        if (resolvedSrc.startsWith("./") || (!resolvedSrc.startsWith("/") && !resolvedSrc.startsWith("data:"))) {
                          const pageDir = dirOf(path);
                          const rel = resolvedSrc.startsWith("./") ? resolvedSrc.slice(2) : resolvedSrc;
                          resolvedSrc = pageDir ? `/raw/${pageDir}/${rel}` : `/raw/${rel}`;
                        } else {
                          resolvedSrc = resolvedSrc.startsWith("/") ? `/raw${resolvedSrc}` : `/raw/${resolvedSrc}`;
                        }
                      }
                      const kind = classifyMedia(resolvedSrc);
                      switch (kind) {
                        case "video":
                          return (
                            <figure className="kiwi-media">
                              <video controls preload="metadata" className="max-w-full rounded-md">
                                <source src={resolvedSrc} />
                              </video>
                              {alt && <figcaption className="text-sm text-muted-foreground mt-1">{alt}</figcaption>}
                            </figure>
                          );
                        case "audio":
                          return (
                            <figure className="kiwi-media">
                              <audio controls preload="metadata" className="w-full">
                                <source src={resolvedSrc} />
                              </audio>
                              {alt && <figcaption className="text-sm text-muted-foreground mt-1">{alt}</figcaption>}
                            </figure>
                          );
                        case "pdf":
                          return (
                            <figure className="kiwi-media">
                              <iframe
                                src={resolvedSrc}
                                title={alt || "PDF"}
                                className="w-full rounded-md border border-border"
                                style={{ height: "600px" }}
                              />
                              {alt && <figcaption className="text-sm text-muted-foreground mt-1">{alt}</figcaption>}
                            </figure>
                          );
                        default: {
                          const imgEl = (
                            <Zoom wrapElement="span" classDialog="kiwi-zoom-dialog" zoomMargin={32}>
                              <img
                                src={resolvedSrc}
                                alt={alt as string}
                                {...(width ? { width: Number(width) } : {})}
                                {...(height ? { height: Number(height) } : {})}
                                {...(rest as any)}
                              />
                            </Zoom>
                          );
                          // Show caption from alt text for standalone images
                          if (alt && typeof alt === "string" && alt.trim()) {
                            return (
                              <figure className="kiwi-figure">
                                {imgEl}
                                <figcaption className="kiwi-figcaption">{alt}</figcaption>
                              </figure>
                            );
                          }
                          return imgEl;
                        }
                      }
                    },
                    table: ({ children, node: _node, ...rest }) => (
                      <div className="kiwi-table-wrapper">
                        <table {...(rest as any)}>{children}</table>
                      </div>
                    ),
                    p: ({ children, node: _node, ...rest }) => {
                      const arr = Array.isArray(children) ? children : [children];
                      const first = arr[0];
                      if (typeof first === "string") {
                        const hit = splitCallout(first);
                        if (hit) {
                          const rest2 = [hit.rest, ...arr.slice(1)];
                          return (
                            <div className={`kiwi-callout ${hit.cls}`} role="note">
                              <span className="mr-1.5">{hit.emoji}</span>
                              {rest2}
                            </div>
                          );
                        }
                      }
                      return <p {...(rest as any)}>{children}</p>;
                    },
                    blockquote: ({ children, node: _node, ...rest }: any) => {
                      const flat = flattenBlockquoteText(children);
                      // Match admonition tag on its own (first line only).
                      // [^\S\n]* = horizontal whitespace only (no newline consumption).
                      const admonitionRe = new RegExp(
                        `^\\[!(${ADMONITION_TYPE_KEYS})\\]([+-])?[^\\S\\n]*(.*?)$`,
                        "m"
                      );
                      const match = flat.match(admonitionRe);
                      if (match) {
                        const kind = match[1].toUpperCase() as keyof typeof ADMONITION_TYPES;
                        const foldMarker = match[2] as "+" | "-" | undefined;
                        const customTitle = match[3]?.trim() || "";
                        const cfg = ADMONITION_TYPES[kind];
                        if (cfg) {
                          const Icon = cfg.icon;
                          const displayTitle = customTitle || cfg.label;
                          const stripped = stripAdmonitionTag(children);

                          // Foldable callout: `-` means collapsed, `+` means expanded
                          if (foldMarker) {
                            return (
                              <details
                                className={`kiwi-admonition kiwi-admonition-foldable ${cfg.cls}`}
                                open={foldMarker === "+"}
                              >
                                <summary className="kiwi-admonition-title">
                                  <Icon className="h-4 w-4" />
                                  <span>{displayTitle}</span>
                                </summary>
                                <div className="kiwi-admonition-body">
                                  {stripped}
                                </div>
                              </details>
                            );
                          }

                          return (
                            <aside className={`kiwi-admonition ${cfg.cls}`} role="note">
                              <div className="kiwi-admonition-title">
                                <Icon className="h-4 w-4" />
                                <span>{displayTitle}</span>
                              </div>
                              <div className="kiwi-admonition-body">
                                {stripped}
                              </div>
                            </aside>
                          );
                        }
                      }
                      return <blockquote {...(rest as any)}>{children}</blockquote>;
                    },
                    section: ({ children, node: _node, ...rest }: any) => {
                      const props = rest as Record<string, unknown>;
                      if (props["data-footnotes"] !== undefined || props.className === "footnotes") {
                        return (
                          <section className="kiwi-footnotes" role="doc-endnotes" {...(rest as any)}>
                            <hr className="my-6" />
                            <h2 className="text-sm font-semibold text-muted-foreground mb-2">Footnotes</h2>
                            {children}
                          </section>
                        );
                      }
                      return <section {...(rest as any)}>{children}</section>;
                    },
                  }}
                >
                  {stripObsidianComments(parsed.body)}
                </ReactMarkdown>
                </ErrorBoundary>
              </div>
              )}

              {/* ── Footer zone: fixed order, collapsible ── */}
              <div className="mt-12 space-y-2">
                {myNote && (
                  <CollapsibleFooterSection
                    icon={<NotebookPen className="h-4 w-4" />}
                    title="My Notes"
                    storageKey="footer-my-notes"
                    defaultOpen
                    className="kiwi-my-notes-section"
                  >
                    <div className="kiwi-prose kiwi-my-notes">
                      <ErrorBoundary>
                        <ReactMarkdown
                          remarkPlugins={[
                            remarkGfm,
                            remarkMath,
                            remarkMark,
                            remarkInlineTags,
                            remarkEmoji,
                            remarkSupersub,
                            remarkDefinitionList,
                            remarkDirective,
                            remarkKiwiDirectives,
                            [remarkWikiLinks, { resolver }],
                          ]}
                          rehypePlugins={[
                            rehypeCodeMeta,
                            rehypeRaw,
                            [rehypeSanitize, sanitizeSchema],
                            rehypeKatex,
                            rehypeSlug,
                          ]}
                          components={{
                            code: ({ className, children, node, ...rest }: any) => {
                              const match = /language-([A-Za-z0-9_:.-]+)/.exec(className || "");
                              const lang = match ? match[1] : undefined;
                              const raw = String(children).replace(/\n$/, "");
                              if (lang === "widget:code") {
                                const codeMeta: string = node?.data?.meta || node?.properties?.metastring || "";
                                const codeLangMatch = codeMeta.match(/lang=(\w+)/);
                                const codeLang = codeLangMatch ? codeLangMatch[1] : "python";
                                return <CodeRunner source={raw} lang={codeLang} />;
                              }
                              if (!lang || !raw.includes("\n")) {
                                return <code className={className} {...rest}>{children}</code>;
                              }
                              const meta: string = node?.data?.meta || node?.properties?.metastring || "";
                              const titleMatch = meta.match(/title="([^"]+)"/);
                              const title = titleMatch ? titleMatch[1] : undefined;
                              return <ShikiCode code={raw} lang={lang} title={title} />;
                            },
                            pre: ({ children }) => <>{children}</>,
                          }}
                        >
                          {stripObsidianComments(myNote.replace(/^---[\s\S]*?---\n*/, ""))}
                        </ReactMarkdown>
                      </ErrorBoundary>
                    </div>
                  </CollapsibleFooterSection>
                )}

                <CollapsibleFooterSection
                  icon={<MessageSquareQuote className="h-4 w-4" />}
                  title="Comments"
                  storageKey="footer-comments"
                  defaultOpen={commentCount > 0}
                  className="kiwi-comments-section"
                >
                  <KiwiComments
                    path={path}
                    containerRef={proseRef}
                    renderKey={content}
                    refreshKey={refreshKey}
                  />
                </CollapsibleFooterSection>

                <KiwiBookmarks
                  path={path}
                  containerRef={proseRef}
                  renderKey={content}
                />

                <CollapsibleFooterSection
                  icon={<Link2 className="h-4 w-4" />}
                  title="Backlinks"
                  storageKey="footer-backlinks"
                  className="kiwi-backlinks-section"
                >
                  <KiwiBacklinks path={path} onNavigate={onNavigate} refreshKey={refreshKey} />
                </CollapsibleFooterSection>
              </div>

              {/* ── File info ── */}
              <div className="border-t border-border mt-8 pt-4 pb-2">
                <div className="text-xs text-muted-foreground flex items-center gap-3 min-w-0">
                  <FileAxis3D className="h-3.5 w-3.5 shrink-0" />
                  <code className="font-mono break-all min-w-0">{path}</code>
                </div>
              </div>
            </article>
            {!isExcalidrawMarkdown(content, parsed.meta) && <KiwiToC markdown={parsed.body} containerRef={proseRef} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Frontmatter properties ── */

function FrontmatterProperties({
  properties,
  onTagClick,
}: {
  properties: FrontmatterProperty[];
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
              <PropertyValue property={property} onTagClick={onTagClick} />
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
  onTagClick,
}: {
  property: FrontmatterProperty;
  onTagClick?: (tag: string) => void;
}) {
  const { key, value } = property;

  return <SemanticFrontmatterValue propertyKey={key} value={value} onTagClick={onTagClick} />;
}

function SemanticFrontmatterValue({
  propertyKey,
  value,
  onTagClick,
}: {
  propertyKey: string;
  value: unknown;
  onTagClick?: (tag: string) => void;
}) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[]</span>;

    return (
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`${propertyKey} values`}>
        {value.map((item, index) => (
          <li key={`${propertyKey}-${index}`} className="min-w-0">
            <SemanticFrontmatterValue propertyKey={propertyKey} value={item} onTagClick={onTagClick} />
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
              <SemanticFrontmatterValue propertyKey={nestedKey} value={nestedValue} onTagClick={onTagClick} />
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

const HEADER_RENDERED_KEYS = new Set(["title", "status", "tags"]);

function frontmatterProperties(meta: Record<string, unknown>): FrontmatterProperty[] {
  return Object.entries(meta)
    .filter(([key, value]) => value != null && !HEADER_RENDERED_KEYS.has(key))
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

/** Parse "{1,3-5,8}" into a Set of line numbers (1-indexed). */
function parseLineRanges(spec: string): Set<number> {
  const lines = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      for (let i = start; i <= end; i++) lines.add(i);
    } else {
      const n = parseInt(trimmed, 10);
      if (!Number.isNaN(n)) lines.add(n);
    }
  }
  return lines;
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
