// ── Core components ─────────────────────────────────────────────────────────

export { KiwiTree } from "./components/KiwiTree";
export type { KiwiTreeHandle, KiwiTreeDataNode } from "./components/KiwiTree";
export { KiwiPage } from "./components/KiwiPage";

// ── Provider & context ──────────────────────────────────────────────────────

export {
  KiwiProvider,
  useKiwi,
  useKiwiOptional,
} from "./lib/KiwiProvider";
export type {
  KiwiProviderProps,
  KiwiContextValue,
  KiwiFetcher,
  KiwiThemeProp,
} from "./lib/KiwiProvider";

// ── Markdown plugin chain ───────────────────────────────────────────────────

export {
  kiwiRemarkPlugins,
  kiwiRehypePlugins,
  kiwiSanitizeSchema,
  stripObsidianComments,
} from "./lib/kiwiMarkdown";

// ── Theming ─────────────────────────────────────────────────────────────────

export {
  applyKiwiTheme,
  removeKiwiTheme,
  setKiwiThemeScope,
  applyKiwiCustomCSS,
  removeKiwiCustomCSS,
} from "./lib/kiwiTheme";
export type {
  KiwiTokens,
  KiwiThemeOverrides,
} from "./lib/kiwiTheme";

// ── Wiki-link resolution ────────────────────────────────────────────────────

export { buildResolver, remarkWikiLinks, extractWikiTargets } from "./lib/wikiLinks";
export type { LinkResolver } from "./lib/wikiLinks";

// ── Remark plugins (individual) ─────────────────────────────────────────────

export { remarkMark, remarkInlineTags, rehypeCodeMeta } from "./lib/remarkPlugins";
export { remarkKiwiDirectives } from "./lib/remarkDirectives";

// ── Widget system ───────────────────────────────────────────────────────────

export {
  registerWidget,
  unregisterWidget,
  getWidget,
  getRegisteredWidgets,
  clearWidgets,
} from "./widgets";
export type { WidgetComponent, WidgetProps } from "./widgets";

// ── Additional components ───────────────────────────────────────────────────

export { KiwiEditor } from "./components/KiwiEditor";
export { KiwiSearch } from "./components/KiwiSearch";
export { KiwiGraph } from "./components/KiwiGraph";
export { KiwiHistory } from "./components/KiwiHistory";
export { KiwiComments } from "./components/KiwiComments";
export { KiwiBacklinks } from "./components/KiwiBacklinks";
export { KiwiQuery } from "./components/KiwiQuery";
export { NewPageDialog } from "./components/NewPageDialog";
export { KeyboardShortcuts } from "./components/KeyboardShortcuts";

// ── API client & types ──────────────────────────────────────────────────────

export {
  api,
  setBaseOverride,
  setExtraHeaders,
  setCurrentSpace,
  getCurrentSpace,
  sseUrl,
} from "./lib/api";
export type {
  TreeEntry,
  SearchResult,
  SearchResponse,
  Version,
  BacklinkEntry,
  GraphNode,
  GraphEdge,
  GraphResponse,
  Comment,
  CommentAnchor,
  CommentsResponse,
  QueryResponse,
  SpaceMeta,
} from "./lib/api";
