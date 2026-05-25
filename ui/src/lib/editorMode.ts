import matter from "gray-matter";
import type { TreeEntry } from "@kw/lib/api";
import type { WikiPage } from "@kw/components/editor/wikiLinkCompletion";
import { frontmatterToText, joinFrontmatter, splitFrontmatter } from "@kw/lib/frontmatter";
import { titleize } from "@kw/lib/paths";

export type EditorMode = "visual" | "source";

export const EDITOR_MODE_STORAGE_KEY = "kiwifs-editor-mode";

export function loadEditorModePreference(): EditorMode {
  try {
    const v = localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
    return v === "source" ? "source" : "visual";
  } catch {
    return "visual";
  }
}

export function saveEditorModePreference(mode: EditorMode): void {
  try {
    localStorage.setItem(EDITOR_MODE_STORAGE_KEY, mode);
  } catch {
    /* quota / private mode */
  }
}

/** Export current visual editor state to a full markdown file string. */
export async function visualToSource(
  fmText: string,
  blocksToMd: () => Promise<string>,
): Promise<string> {
  const body = await blocksToMd();
  return joinFrontmatter(fmText, body);
}

/** Split full-file source into frontmatter textarea text and BlockNote body. */
export function sourceToVisualParts(sourceText: string): { fmText: string; body: string } {
  const split = splitFrontmatter(sourceText);
  const fmText = frontmatterToText(split.frontmatter);
  let body = split.body;
  try {
    const parsed = matter(sourceText);
    if (typeof parsed.data?.title === "string") {
      const h1Match = body.match(/^\s*#\s+(.+)\n?/);
      if (h1Match && h1Match[1].trim() === parsed.data.title.trim()) {
        body = body.replace(/^\s*#\s+.+\n?/, "");
      }
    }
  } catch {
    /* ignore invalid frontmatter */
  }
  return { fmText, body };
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
