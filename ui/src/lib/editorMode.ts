import yaml from "js-yaml";
import type { TreeEntry } from "@kw/lib/api";
import type { WikiPage } from "@kw/components/editor/wikiLinkCompletion";
import { frontmatterToText, joinFrontmatter, splitFrontmatter, textToFrontmatter } from "@kw/lib/frontmatter";
import { titleize } from "@kw/lib/paths";
import { detectLineEndings } from "@kw/lib/markdownMerge";

/**
 * - visual: the BlockNote block editor
 * - source: CodeMirror on the raw markdown
 * - live: the same CodeMirror with live preview decorations
 */
export type EditorMode = "visual" | "source" | "live";

export const EDITOR_MODE_STORAGE_KEY = "kiwifs-editor-mode";
export const EDITOR_VIM_STORAGE_KEY = "kiwifs-editor-vim";

function isEditorMode(value: unknown): value is EditorMode {
  return value === "visual" || value === "source" || value === "live";
}

/**
 * The last mode the user picked. With no choice stored, touch devices start
 * in live preview, which works with an on-screen keyboard where the block
 * editor struggles, and everything else in visual mode.
 */
export function loadEditorModePreference(): EditorMode {
  try {
    const stored = localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
    if (isEditorMode(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  return coarsePointer() ? "live" : "visual";
}

function coarsePointer(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** The editor mode a `default_view` preference names. */
export function editorModeFromView(view: "editor" | "source" | "live"): EditorMode {
  return view === "editor" ? "visual" : view;
}

/** The `default_view` preference for an editor mode. */
export function viewFromEditorMode(mode: EditorMode): "editor" | "source" | "live" {
  return mode === "visual" ? "editor" : mode;
}

export function loadVimPreference(): boolean {
  try {
    return localStorage.getItem(EDITOR_VIM_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveVimPreference(on: boolean): void {
  try {
    localStorage.setItem(EDITOR_VIM_STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* quota / private mode */
  }
}

export function saveEditorModePreference(mode: EditorMode): void {
  try {
    localStorage.setItem(EDITOR_MODE_STORAGE_KEY, mode);
  } catch {
    /* quota / private mode */
  }
}

/**
 * A page as Visual mode loads it: the body BlockNote shows, and the exact
 * bytes in front of it (BOM, frontmatter, and an H1 repeating the title,
 * which the title input already shows). Saving reattaches `head` verbatim
 * unless the frontmatter changed.
 */
export type VisualSource = {
  head: string;
  fmText: string;
  body: string;
  /** The hidden title H1 line, as it appears in the file. */
  titleHeading: string | null;
};

// Not gray-matter: it calls Node's Buffer, so in the browser it always throws.
function frontmatterTitle(markdown: string): string | null {
  const text = frontmatterToText(splitFrontmatter(markdown).frontmatter);
  if (!text) return null;
  try {
    const title = (yaml.load(text) as { title?: unknown } | null)?.title;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
}

export function splitVisualSource(markdown: string): VisualSource {
  const split = splitFrontmatter(markdown);
  const fmText = frontmatterToText(split.frontmatter);
  let body = split.body;
  let titleHeading: string | null = null;
  const title = frontmatterTitle(markdown);
  const h1 = body.match(/^\s*#\s+([^\r\n]+)(?:\r?\n)?/);
  if (title !== null && h1 && h1[1].trim() === title.trim()) {
    titleHeading = h1[0];
    body = body.slice(h1[0].length);
  }
  return { head: markdown.slice(0, markdown.length - body.length), fmText, body, titleHeading };
}

/** Split full-file source into frontmatter textarea text and BlockNote body. */
export function sourceToVisualParts(sourceText: string): { fmText: string; body: string } {
  const { fmText, body } = splitVisualSource(sourceText);
  return { fmText, body };
}

/**
 * The page with `fmText` and `body` in place of the loaded ones. An edited
 * frontmatter block is re-serialised; the hidden title H1 is kept, renamed
 * when the title changed, so saving never drops a heading from the file.
 */
export function joinVisualSource(source: VisualSource, fmText: string, body: string): VisualSource & { markdown: string } {
  if (fmText === source.fmText) {
    return { ...source, body, markdown: source.head + body };
  }
  let heading = source.titleHeading;
  const title = frontmatterTitle(`---\n${fmText}\n---\n`);
  if (heading && title !== null) heading = heading.replace(/^(\s*#\s+)[^\r\n]+/, (_m, hashes: string) => hashes + title);
  let head = joinFrontmatter(fmText, "");
  const loadedFm = splitFrontmatter(source.head).frontmatter;
  const nextFm = textToFrontmatter(fmText);
  if (heading && loadedFm !== null && nextFm !== null && source.titleHeading) {
    // Keep the spacing the file had between the frontmatter and the heading.
    const gap = source.head.slice(loadedFm.length, source.head.length - source.titleHeading.length);
    head = nextFm + gap.replace(/\r\n/g, "\n") + heading.replace(/^\s*\n/, "");
  } else if (heading) head += heading.replace(/^\s*\n/, "");
  else if (head && /^\r?\n/.test(body)) head = head.replace(/\n\n$/, "\n");

  const endings = detectLineEndings(source.head + source.body);
  if (endings.crlf) head = head.replace(/\r?\n/g, "\r\n");
  if (endings.bom && !head.startsWith("\uFEFF")) head = `\uFEFF${head}`;
  return { head, fmText, body, titleHeading: heading, markdown: head + body };
}

export function collectMarkdownPaths(tree: TreeEntry | null | undefined): string[] {
  if (!tree) return [];
  const pages: string[] = [];
  function walk(node: TreeEntry) {
    if (!node.isDir && node.path.toLowerCase().endsWith(".md")) {
      pages.push(node.path);
    }
    node.children?.forEach(walk);
  }
  walk(tree);
  return pages;
}

export function wikiPagesFromTree(tree: TreeEntry | null | undefined): WikiPage[] {
  return collectMarkdownPaths(tree).map((path) => ({
    path,
    title: titleize(path),
  }));
}
