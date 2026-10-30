/**
 * One dispatcher for every fenced code block.
 *
 * Both markdown renderers on a page (the page body and the local-notes footer)
 * mount this, so a fence cannot render in one place and degrade to a grey code
 * block in the other.
 *
 * Order matters in two places and is load-bearing:
 *   - `kiwi-data` is dispatched *before* the single-line guard, because a
 *     one-record block is still data, not inline code.
 *   - `kiwi-app` / `kiwi-diff` come *after* it, because they need the meta
 *     string that is only read past that point.
 */

import { Suspense, lazy, type ReactNode } from "react";
import { ShikiCode } from "./ShikiCode";
import { parseMermaidMeta } from "@kw/lib/mermaidTheme";
import { KiwiCalc } from "./KiwiCalc";
import { KiwiDiff } from "./KiwiDiff";
import { KiwiKanbanBlock } from "./KiwiKanbanBlock";
import { KiwiDataBlock } from "./KiwiDataBlock";
import { KiwiColor } from "./KiwiColor";
import { KiwiProgress } from "./KiwiProgress";
import { KiwiQuery } from "./KiwiQuery";
import { getFence, isStrictTag, sniffFence, TypedFence, type FenceSpec } from "@kw/fences";

/**
 * The blocks that drag a large library in — react-live, pyodide, mermaid,
 * recharts — load only on a page that uses one.
 *
 * This is the half of the lazy-loading story that the specs alone could not
 * deliver: `KiwiWidget`'s `liveScope` names every view component, so as long
 * as it was statically imported, every page paid for GraphView and dagre
 * whether or not it drew anything.
 */
const KiwiWidget = lazy(() => import("./KiwiWidget").then((m) => ({ default: m.KiwiWidget })));
const CodeRunner = lazy(() => import("@kw/widgets/CodeRunner").then((m) => ({ default: m.CodeRunner })));
const PageTracker = lazy(() => import("@kw/widgets/PageTracker").then((m) => ({ default: m.PageTracker })));
const MermaidDiagram = lazy(() => import("./MermaidDiagram").then((m) => ({ default: m.MermaidDiagram })));
const D2Diagram = lazy(() => import("./D2Diagram").then((m) => ({ default: m.D2Diagram })));
const KiwiSteps = lazy(() => import("./KiwiSteps").then((m) => ({ default: m.KiwiSteps })));
const KiwiChart = lazy(() => import("./KiwiChart").then((m) => ({ default: m.KiwiChart })));
const KiwiApp = lazy(() => import("./KiwiApp").then((m) => ({ default: m.KiwiApp })));
const KiwiPlayground = lazy(() => import("./KiwiPlayground").then((m) => ({ default: m.KiwiPlayground })));

/** A block-shaped placeholder, so the page does not jump as a chunk arrives. */
function Loading() {
  return <div className="my-4 h-24 animate-pulse rounded-lg bg-muted" />;
}

function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export interface FenceBlockProps {
  /** `language-xxx` class react-markdown puts on the <code> element. */
  className?: string;
  children?: ReactNode;
  /** The hast node, carrying `data.meta` / `properties.metastring`. */
  node?: any;
  onNavigate?: (path: string) => void;
  /** The page being rendered; `kiwi-app src=` resolves against its folder. */
  pagePath?: string;
  /** `kiwi-view: true` in frontmatter — `kiwi-query` renders differently. */
  isComputedView?: boolean;
  /** Bare typed fences (```array, ```tree, …) are off when false. */
  typedFences?: boolean;
  /** When set, only these bare tags render as widgets. */
  typedFenceTags?: string[] | null;
}

/** Parse "{1,3-5,8}" into a Set of line numbers (1-indexed). */
export function parseLineRanges(spec: string): Set<number> {
  const lines = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1]!, 10);
      const end = parseInt(range[2]!, 10);
      for (let i = start; i <= end; i++) lines.add(i);
    } else {
      const n = parseInt(trimmed, 10);
      if (!Number.isNaN(n)) lines.add(n);
    }
  }
  return lines;
}

export function fenceLang(className?: string): string | undefined {
  const match = /language-([A-Za-z0-9_:.-]+)/.exec(className || "");
  return match ? match[1] : undefined;
}

export function fenceMeta(node?: any): string {
  return node?.data?.meta || node?.properties?.metastring || "";
}

type BlockKind =
  | "code-runner"
  | "tracker"
  | "widget"
  | "query"
  | "mermaid"
  | "d2"
  | "calc"
  | "chart"
  | "color"
  | "progress"
  | "playground"
  | "kanban"
  | "data"
  | "steps"
  | "inline"
  | "app"
  | "diff"
  | "code";

export type FenceRoute = { kind: "typed"; spec: FenceSpec } | { kind: BlockKind };

export interface ResolveFenceOptions {
  typedFences?: boolean;
  typedFenceTags?: string[] | null;
  /** The fence meta; a `kiwi-app src=` has no body to pass the guard with. */
  meta?: string;
}

const EXACT: Record<string, BlockKind> = {
  "widget:code": "code-runner",
  "widget:tracker": "tracker",
  "kiwi-query": "query",
  mermaid: "mermaid",
  d2: "d2",
  "kiwi-calc": "calc",
  "kiwi-chart": "chart",
  "kiwi-color": "color",
  "kiwi-progress": "progress",
  "kiwi-playground": "playground",
  "kiwi-kanban": "kanban",
  // Before the single-line guard: a one-record block is still data.
  "kiwi-data": "data",
};

/** Read past the single-line guard, so never offered to the fence registry. */
const AFTER_GUARD: Record<string, BlockKind> = { "kiwi-app": "app", "kiwi-diff": "diff" };

/** Which renderer a fenced (or inline) code element gets. Pure, for tests. */
export function resolveFence(
  lang: string | undefined,
  raw: string,
  { typedFences = true, typedFenceTags, meta }: ResolveFenceOptions = {},
): FenceRoute {
  if (lang && Object.hasOwn(EXACT, lang)) return { kind: EXACT[lang]! };
  if (lang?.startsWith("widget:")) return { kind: "widget" };

  // Typed fences own their own "is this really mine?" test, so a ```tree
  // directory listing or a ```table of pipes still reaches Shiki below.
  // The workspace switches apply to every tag but the strict `kiwi-` /
  // `widget:` spellings: an author who wrote `kiwi-array` asked for a widget
  // and gets one either way.
  if (lang && !Object.hasOwn(AFTER_GUARD, lang)) {
    const spec = getFence(lang);
    if (spec) {
      const tag = lang.toLowerCase();
      const allowed =
        isStrictTag(lang) ||
        (typedFences &&
          (!typedFenceTags ||
            typedFenceTags.some((t) => {
              const want = t.toLowerCase();
              return want === tag || want === spec.lang;
            })));
      if (allowed && sniffFence(spec, lang, raw)) return { kind: "typed", spec };
    }
  }

  if (lang === "kiwi-steps") return { kind: "steps" };
  if (lang === "kiwi-app" && meta && /(?:^|\s)src=/.test(meta)) return { kind: "app" };
  if (!lang || !raw.includes("\n")) return { kind: "inline" };
  return { kind: AFTER_GUARD[lang] ?? "code" };
}

export function FenceBlock({
  className,
  children,
  node,
  onNavigate,
  pagePath,
  isComputedView,
  typedFences = true,
  typedFenceTags,
  ...rest
}: FenceBlockProps) {
  const lang = fenceLang(className);
  const raw = String(children ?? "").replace(/\n$/, "");
  const meta = fenceMeta(node);
  const route = resolveFence(lang, raw, { typedFences, typedFenceTags, meta });

  switch (route.kind) {
    case "typed":
      return <TypedFence spec={route.spec} source={raw} meta={meta} onNavigate={onNavigate} />;
    case "code-runner": {
      const codeLangMatch = meta.match(/lang=(\w+)/);
      return <Deferred><CodeRunner source={raw} lang={codeLangMatch ? codeLangMatch[1]! : "python"} /></Deferred>;
    }
    case "tracker":
      return <Deferred><PageTracker onNavigate={onNavigate} source={raw} /></Deferred>;
    case "widget":
      return (
        <Deferred>
          <KiwiWidget name={lang!.slice("widget:".length)} source={raw} meta={meta} onNavigate={onNavigate} />
        </Deferred>
      );
    case "query":
      return <KiwiQuery source={raw} onNavigate={onNavigate} isComputedView={isComputedView} />;
    case "mermaid": {
      const { focus, dim } = parseMermaidMeta(meta);
      return <Deferred><MermaidDiagram chart={raw} onNavigate={onNavigate} focus={focus} dim={dim} /></Deferred>;
    }
    case "d2":
      return <Deferred><D2Diagram source={raw} /></Deferred>;
    case "calc":
      return <KiwiCalc source={raw} />;
    case "chart":
      return <Deferred><KiwiChart source={raw} /></Deferred>;
    case "color":
      return <KiwiColor source={raw} />;
    case "progress":
      return <KiwiProgress source={raw} />;
    case "playground":
      return <Deferred><KiwiPlayground source={raw} /></Deferred>;
    case "kanban":
      return <KiwiKanbanBlock source={raw} />;
    case "data":
      return <KiwiDataBlock source={raw} meta={meta} />;
    case "steps":
      return <Deferred><KiwiSteps source={raw} onNavigate={onNavigate} /></Deferred>;
    case "inline":
      return (
        <code className={className} {...(rest as any)}>
          {children}
        </code>
      );
    case "app":
      return (
        <Deferred>
          <KiwiApp source={raw} meta={meta} pagePath={pagePath} onNavigate={onNavigate} />
        </Deferred>
      );
    case "diff":
      return <KiwiDiff source={raw} meta={meta} />;
    case "code": {
      const titleMatch = meta.match(/title="([^"]+)"/);
      const title = titleMatch ? titleMatch[1] : undefined;
      const hlMatch = meta.match(/\{([\d,\s-]+)\}/);
      const highlightLines = hlMatch ? parseLineRanges(hlMatch[1]!) : undefined;
      return <ShikiCode code={raw} lang={lang!} title={title} highlightLines={highlightLines} />;
    }
  }
}
