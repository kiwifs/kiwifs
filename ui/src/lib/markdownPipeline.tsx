/**
 * The one markdown pipeline: remark and rehype chains plus the element map
 * that turns fences, directives, admonitions, wiki links and media into
 * KiwiFS components.
 *
 * The page body, the local-notes footer and Storybook all render through
 * this, so a block cannot work in one and degrade to a code block in another.
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkEmoji from "remark-emoji";
import remarkSupersub from "remark-supersub";
import remarkDefinitionList from "remark-definition-list";
import remarkDirective from "remark-directive";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import { Bug, CheckCircle2, CircleAlert, ClipboardList, FileQuestion, Flame, HelpCircle, Info, Lightbulb, ListChecks, Quote, ScrollText, ShieldAlert, TriangleAlert, XCircle, Zap } from "lucide-react";
import { FenceBlock } from "@kw/components/FenceBlock";
import { KiwiFigure } from "@kw/components/KiwiFigure";
import { KiwiEmbed } from "@kw/components/KiwiEmbed";
import { KiwiTabs } from "@kw/components/KiwiTabs";
import { KiwiColumns } from "@kw/components/KiwiColumns";
import { KiwiClaim } from "@kw/components/KiwiClaim";
import { KiwiQuiz } from "@kw/components/KiwiQuiz";
import { KiwiControl } from "@kw/components/KiwiControl";
import { WikiLinkPreview } from "@kw/components/WikiLinkPreview";
import { ErrorBoundary } from "@kw/components/ErrorBoundary";
import { decodeHref, dirOf, isCanvasFile, isExcalidrawFile, normalizePath } from "./paths";
import { useRawUrl } from "./rawUrl";
import type { FigureWidth } from "./figureLayout";
import { kiwiSanitizeSchema } from "./kiwiSanitizeSchema";
import { remarkMark, remarkInlineTags, remarkPageControls, rehypeCodeMeta, rehypeTaskListLabels } from "./remarkPlugins";
import { remarkKiwiDirectives } from "./remarkDirectives";
import { remarkKiwiQuiz } from "./remarkQuiz";
import { remarkWikiLinks, type LinkResolver } from "./wikiLinks";

export interface RemarkOptions {
  /** Resolves `[[wiki links]]`; without one they stay plain text. */
  resolver?: LinkResolver;
  /** The page being rendered, for relative wiki links. */
  fromPath?: string;
}

export function kiwiRemarkPlugins({ resolver, fromPath }: RemarkOptions = {}): PluggableList {
  const plugins: PluggableList = [
    remarkKiwiQuiz,
    remarkGfm,
    remarkMath,
    remarkMark,
    remarkInlineTags,
    remarkPageControls,
    remarkEmoji,
    remarkSupersub,
    remarkDefinitionList,
    remarkDirective,
    remarkKiwiDirectives,
  ];
  if (resolver) plugins.push([remarkWikiLinks, { resolver, fromPath }]);
  return plugins;
}

export interface RehypeOptions {
  /** Wrap headings in self-links. The page body does; the notes footer does not. */
  autolinkHeadings?: boolean;
}

export function kiwiRehypePlugins({ autolinkHeadings = true }: RehypeOptions = {}): PluggableList {
  const plugins: PluggableList = [
    rehypeCodeMeta,
    rehypeRaw,
    [rehypeSanitize, kiwiSanitizeSchema],
    rehypeTaskListLabels,
    rehypeKatex,
    rehypeSlug,
  ];
  if (autolinkHeadings) plugins.push([rehypeAutolinkHeadings, { behavior: "wrap" }]);
  return plugins;
}

export interface ComponentOptions {
  /** The page being rendered; relative links, images and `src=` resolve against it. */
  path: string;
  navigate: (path: string) => void;
  /** Takes over `[[wiki link]]` clicks from `navigate` when set. */
  onWikiLinkClick?: (target: string) => void;
  /** `kiwi-view: true` in frontmatter — `kiwi-query` renders differently. */
  isComputedView?: boolean;
  typedFences?: boolean;
  typedFenceTags?: string[] | null;
}

/**
 * The element map. Each call returns new component types, and react-markdown
 * remounts every element whose type changed, so a renderer should hold on to
 * one map per page — `useKiwiMarkdownComponents` does.
 */
export function kiwiMarkdownComponents({
  path,
  navigate: nav,
  onWikiLinkClick,
  isComputedView = false,
  typedFences = true,
  typedFenceTags,
}: ComponentOptions): Components {
  return {
    a: ({ href, children, node: _node, ...rest }) => {
      const h = href ?? "";
      if (h.startsWith("#kiwi:")) {
        const raw = decodeHref(h.slice("#kiwi:".length));
        const hashIdx = raw.indexOf("#");
        const pagePath = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
        const anchor = hashIdx >= 0 ? raw.slice(hashIdx) : "";
        return (
          <WikiLinkPreview path={pagePath}>
            <a
              href={`/page/${pagePath}${anchor}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                if (onWikiLinkClick) onWikiLinkClick(pagePath);
                else nav(pagePath);
                if (anchor) {
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      const el = document.getElementById(anchor.slice(1));
                      el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 100);
                  });
                }
              }}
              {...(rest as any)}
              // The hover card stands in for the native title tooltip.
              title={undefined}
              className="wiki-link"
            >
              {children}
            </a>
          </WikiLinkPreview>
        );
      }
      if (h.startsWith("#kiwi-missing:")) {
        const target = decodeHref(h.slice("#kiwi-missing:".length));
        return (
          <WikiLinkPreview path={`${target}.md`} missing>
            <a
              href={`/page/${target}.md`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                if (onWikiLinkClick) onWikiLinkClick(target);
                else nav(`${target}.md`);
              }}
              {...(rest as any)}
              title={undefined}
              className="wiki-link-missing"
            >
              {children}
              <span className="sr-only"> (missing page, click to create)</span>
            </a>
          </WikiLinkPreview>
        );
      }
      if (h.startsWith("#")) {
        return (
          <a
            href={h}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(h.slice(1));
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                history.replaceState(null, "", h);
              }
            }}
            {...(rest as any)}
          >
            {children}
          </a>
        );
      }

      const mdMatch = /^([^#]*\.md)(?:#(.+))?$/.exec(h);
      if (mdMatch && !h.startsWith("http")) {
        const relPage = decodeHref(mdMatch[1]);
        const anchor = mdMatch[2] ?? "";
        const dir = dirOf(path);
        const joined = dir ? `${dir}/${relPage}` : relPage;
        const resolved = normalizePath(joined);
        return (
          <a
            href={`/page/${resolved}${anchor ? `#${anchor}` : ""}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              nav(resolved);
              if (anchor) {
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    const el = document.getElementById(anchor);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 150);
                });
              }
            }}
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
    code: (props: any) => (
      <FenceBlock
        {...props}
        onNavigate={nav}
        pagePath={path}
        isComputedView={isComputedView}
        typedFences={typedFences}
        typedFenceTags={typedFenceTags}
      />
    ),
    pre: ({ children }) => <>{children}</>,
    span: ({ children, node: _node, ...rest }: any) => {
      const props = rest as Record<string, unknown>;
      if (props["data-kiwi-directive"] === "claim") {
        return (
          <KiwiClaim
            inline
            evidence={props["data-evidence"] as string | undefined}
            confidence={props["data-confidence"] as string | undefined}
            source={props["data-source"] as string | undefined}
          >
            {children}
          </KiwiClaim>
        );
      }
      if (props["data-kiwi-directive"] === "control") {
        return (
          <KiwiControl
            kind={String(props["data-control"] ?? "value")}
            attrs={parseControlAttrs(props["data-control-attrs"])}
          />
        );
      }
      return <span {...(rest as any)}>{children}</span>;
    },
    div: ({ children, node: _node, ...rest }: any) => {
      const props = rest as Record<string, unknown>;
      const directive = props["data-kiwi-directive"];
      if (directive === "quiz") {
        return (
          <ErrorBoundary>
            <KiwiQuiz specAttr={String(props["data-quiz"] ?? props["dataQuiz"] ?? "")} />
          </ErrorBoundary>
        );
      }
      if (directive === "tabs") {
        return <KiwiTabs>{children}</KiwiTabs>;
      }
      if (directive === "claim") {
        return (
          <KiwiClaim
            evidence={props["data-evidence"] as string | undefined}
            confidence={props["data-confidence"] as string | undefined}
            source={props["data-source"] as string | undefined}
          >
            {children}
          </KiwiClaim>
        );
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
      if (directive === "figure") {
        return (
          <KiwiFigure
            width={(props["data-width"] as FigureWidth | undefined) || "inline"}
            pin={props["data-pin"] === "true"}
            caption={props["data-caption"] as string | undefined}
          >
            {children}
          </KiwiFigure>
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
      const embedKind = ((rest as any)["data-kiwi-embed"] || (rest as any)["dataKiwiEmbed"]) as string | undefined;
      const embedTarget = ((rest as any)["data-kiwi-target"] || (rest as any)["dataKiwiTarget"]) as string | undefined;
      const rawPath = (resolvedSrc || "").replace(/^\/raw\//, "");
      const drawingPath = embedTarget
        || ((isExcalidrawFile(rawPath) || isCanvasFile(rawPath)) ? rawPath : "");
      if (embedKind || (drawingPath && (isExcalidrawFile(drawingPath) || isCanvasFile(drawingPath)))) {
        return (
          <KiwiEmbed
            path={drawingPath}
            display={{
              width: (((rest as any)["data-kiwi-width"] || (rest as any)["dataKiwiWidth"]) as FigureWidth | undefined) || "inline",
              pin: ((rest as any)["data-kiwi-pin"] || (rest as any)["dataKiwiPin"]) === "true",
              pixelWidth: width ? Number(width) : undefined,
              pixelHeight: height ? Number(height) : undefined,
              caption: typeof alt === "string" ? alt : undefined,
            }}
            onNavigate={nav}
          />
        );
      }
      return <KiwiMedia src={resolvedSrc} alt={typeof alt === "string" ? alt : undefined} width={width} height={height} rest={rest as Record<string, unknown>} />;
    },
    table: ScrollableTable,
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
      // `[^\S\n]*`, not `\s*`: the custom title must not run onto the next line.
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
  };
}

/**
 * One element map per page and setting. The callbacks are read through a ref,
 * so a parent passing a fresh `onNavigate` arrow on every render does not
 * remount every fence — and reload every kiwi-app — on the page.
 */
export function useKiwiMarkdownComponents(opts: ComponentOptions): Components {
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });
  const navigate = useCallback((p: string) => latest.current.navigate(p), []);
  const wikiLink = useCallback((t: string) => latest.current.onWikiLinkClick?.(t), []);
  const hasWikiHandler = opts.onWikiLinkClick != null;
  const { path, isComputedView, typedFences, typedFenceTags } = opts;
  return useMemo(
    () =>
      kiwiMarkdownComponents({
        path,
        navigate,
        onWikiLinkClick: hasWikiHandler ? wikiLink : undefined,
        isComputedView,
        typedFences,
        typedFenceTags,
      }),
    [path, navigate, wikiLink, hasWikiHandler, isComputedView, typedFences, typedFenceTags],
  );
}

function ScrollableTable({ children, node: _node, ...rest }: any) {
  return (
    <div className="kiwi-table-wrapper">
      <table {...rest}>{children}</table>
    </div>
  );
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
    const tagMatch = first.match(ADMONITION_TAG_RE);
    if (!tagMatch) return child;
    stripped = true;
    const afterTag = first.slice(tagMatch[0].length);
    const cleaned = afterTag.replace(/^[+-]?[^\S\n]*[^\n]*/, "");
    const trimmed = cleaned.replace(/^\n/, "");
    const newChildren = trimmed ? [trimmed, ...arr.slice(1)] : arr.slice(1);
    return { ...(child as any), props: { ...(child as any).props, children: newChildren } };
  });
}

const ADMONITION_TYPES: Record<string, { icon: typeof Info; cls: string; label: string }> = {
  NOTE:      { icon: Info,          cls: "kiwi-admonition-note",      label: "Note" },
  INFO:      { icon: Info,          cls: "kiwi-admonition-note",      label: "Info" },
  TODO:      { icon: ClipboardList, cls: "kiwi-admonition-note",      label: "Todo" },
  TIP:       { icon: Lightbulb,     cls: "kiwi-admonition-tip",       label: "Tip" },
  HINT:      { icon: Lightbulb,     cls: "kiwi-admonition-tip",       label: "Hint" },
  SUCCESS:   { icon: CheckCircle2,  cls: "kiwi-admonition-tip",       label: "Success" },
  CHECK:     { icon: CheckCircle2,  cls: "kiwi-admonition-tip",       label: "Check" },
  DONE:      { icon: ListChecks,    cls: "kiwi-admonition-tip",       label: "Done" },
  IMPORTANT: { icon: CircleAlert,   cls: "kiwi-admonition-important", label: "Important" },
  ABSTRACT:  { icon: ScrollText,    cls: "kiwi-admonition-important", label: "Abstract" },
  SUMMARY:   { icon: ScrollText,    cls: "kiwi-admonition-important", label: "Summary" },
  TLDR:      { icon: ScrollText,    cls: "kiwi-admonition-important", label: "TL;DR" },
  EXAMPLE:   { icon: Zap,           cls: "kiwi-admonition-important", label: "Example" },
  WARNING:   { icon: TriangleAlert, cls: "kiwi-admonition-warning",   label: "Warning" },
  CAUTION:   { icon: Flame,         cls: "kiwi-admonition-caution",   label: "Caution" },
  ATTENTION: { icon: TriangleAlert, cls: "kiwi-admonition-warning",   label: "Attention" },
  QUESTION:  { icon: HelpCircle,    cls: "kiwi-admonition-warning",   label: "Question" },
  HELP:      { icon: HelpCircle,    cls: "kiwi-admonition-warning",   label: "Help" },
  FAQ:       { icon: HelpCircle,    cls: "kiwi-admonition-warning",   label: "FAQ" },
  DANGER:    { icon: ShieldAlert,   cls: "kiwi-admonition-caution",   label: "Danger" },
  FAILURE:   { icon: XCircle,       cls: "kiwi-admonition-caution",   label: "Failure" },
  FAIL:      { icon: XCircle,       cls: "kiwi-admonition-caution",   label: "Fail" },
  ERROR:     { icon: XCircle,       cls: "kiwi-admonition-caution",   label: "Error" },
  BUG:       { icon: Bug,           cls: "kiwi-admonition-caution",   label: "Bug" },
  MISSING:   { icon: FileQuestion,  cls: "kiwi-admonition-caution",   label: "Missing" },
  QUOTE:     { icon: Quote,         cls: "kiwi-admonition-quote",     label: "Quote" },
  CITE:      { icon: Quote,         cls: "kiwi-admonition-quote",     label: "Cite" },
};

const ADMONITION_TYPE_KEYS = Object.keys(ADMONITION_TYPES).join("|");
const ADMONITION_TAG_RE = new RegExp(`^\\[!(${ADMONITION_TYPE_KEYS})\\]`);

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

function KiwiMedia({ src, alt, width, height, rest }: {
  src: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
  rest: Record<string, unknown>;
}) {
  const url = useRawUrl(src);
  switch (classifyMedia(src)) {
    case "video":
      return (
        <figure className="kiwi-media">
          <video key={url} controls preload="metadata" className="max-w-full rounded-md">
            {url && <source src={url} />}
          </video>
          {alt && <figcaption className="text-sm text-muted-foreground mt-1">{alt}</figcaption>}
        </figure>
      );
    case "audio":
      return (
        <figure className="kiwi-media">
          <audio key={url} controls preload="metadata" className="w-full">
            {url && <source src={url} />}
          </audio>
          {alt && <figcaption className="text-sm text-muted-foreground mt-1">{alt}</figcaption>}
        </figure>
      );
    case "pdf":
      return (
        <figure className="kiwi-media">
          <iframe
            src={url}
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
            src={url}
            alt={alt}
            {...(width ? { width: Number(width) } : {})}
            {...(height ? { height: Number(height) } : {})}
            {...(rest as any)}
          />
        </Zoom>
      );
      if (alt?.trim()) {
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
}

/** The attrs a `{% … /%}` tag carried, round-tripped through its data attribute. */
function parseControlAttrs(raw: unknown): Record<string, string | number | boolean> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
