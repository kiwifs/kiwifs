/**
 * Reading order: `_book.yaml` first, then frontmatter `order`, then filename.
 *
 * The same manifest already drives multi-file export (`internal/docexport`).
 * This module is the UI-side parse so prev/next and the outline share one
 * definition of "what comes next."
 */

import yaml from "js-yaml";
import type { TreeEntry } from "./api";
import { basename, dirOf, isMarkdown, normalizePath, stem, titleize } from "./paths";

/** Human title for a book part: folder name for `_index`, strip leading `01-`. */
export function bookPageTitle(path: string): string {
  const base = stem(path);
  const raw = base === "_index" || base === "index" ? (basename(dirOf(path)) || base) : base;
  return titleize(raw.replace(/^\d+[-_]+/, ""));
}

export type BookPage = {
  path: string;
  title: string;
  description?: string;
};

export type BookOrder = {
  title?: string;
  source: "manifest" | "fallback";
  pages: BookPage[];
};

export type BookNav = {
  current: BookPage;
  prev: BookPage | null;
  next: BookPage | null;
  index: number;
  total: number;
};

export function parseBookManifest(source: string, baseDir = ""): BookOrder | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  const parts = rec.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const pages: BookPage[] = [];
  for (const part of parts) {
    if (typeof part !== "string" || !part.trim()) continue;
    const rel = part.trim().replace(/^\.\//, "");
    const path = normalizePath(baseDir ? `${baseDir}/${rel}` : rel);
    pages.push({ path, title: bookPageTitle(path) });
  }
  if (pages.length === 0) return null;
  return {
    title: typeof rec.title === "string" ? rec.title : undefined,
    source: "manifest",
    pages,
  };
}

/** Candidate `_book.yaml` paths, nearest directory first. */
export function bookManifestCandidates(pagePath: string): string[] {
  const names = ["_book.yaml", "_book.yml"];
  const out: string[] = [];
  let dir = dirOf(pagePath);
  const seen = new Set<string>();
  while (true) {
    for (const name of names) {
      const p = dir ? `${dir}/${name}` : name;
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    if (!dir) break;
    dir = dirOf(dir);
  }
  return out;
}

function flattenFiles(tree: TreeEntry | null | undefined): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const walk = (n: TreeEntry) => {
    if (!n.isDir) out.push(n.path);
    for (const child of n.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

function samePage(a: string, b: string): boolean {
  const na = normalizePath(a.replace(/\.md$/i, ""));
  const nb = normalizePath(b.replace(/\.md$/i, ""));
  return na === nb || normalizePath(a) === normalizePath(b);
}

export function navForPath(order: BookOrder, pagePath: string): BookNav | null {
  const index = order.pages.findIndex((p) => samePage(p.path, pagePath));
  if (index < 0) return null;
  return {
    current: order.pages[index]!,
    prev: index > 0 ? order.pages[index - 1]! : null,
    next: index < order.pages.length - 1 ? order.pages[index + 1]! : null,
    index,
    total: order.pages.length,
  };
}

/**
 * Sibling markdown files in the current directory, `_index.md` first,
 * then everything else by filename. Used when no `_book.yaml` exists.
 */
export function fallbackBookOrder(tree: TreeEntry | null, pagePath: string): BookOrder | null {
  const dir = dirOf(pagePath);
  const files = flattenFiles(tree)
    .filter((p) => isMarkdown(p) && dirOf(p) === dir)
    .filter((p) => !p.toLowerCase().endsWith(".excalidraw.md"));
  if (files.length < 2) return null;
  files.sort((a, b) => {
    const aIndex = basename(a).startsWith("_index.") ? 0 : 1;
    const bIndex = basename(b).startsWith("_index.") ? 0 : 1;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.localeCompare(b);
  });
  return {
    source: "fallback",
    pages: files.map((path) => ({ path, title: bookPageTitle(path) })),
  };
}

export function applyTitles(order: BookOrder, titles: Record<string, string>): BookOrder {
  const meta: Record<string, BookPageMeta> = {};
  for (const [path, title] of Object.entries(titles)) meta[path] = { title };
  return applyPageMeta(order, meta);
}

export type BookPageMeta = {
  title?: string;
  description?: string;
};

export function applyPageMeta(order: BookOrder, meta: Record<string, BookPageMeta>): BookOrder {
  return {
    ...order,
    pages: order.pages.map((p) => {
      const m = meta[p.path] || meta[normalizePath(p.path)];
      return {
        ...p,
        title: m?.title || p.title,
        description: m?.description || p.description,
      };
    }),
  };
}

const FRONTMATTER_BLOCK = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Title a page calls itself: frontmatter `title`, else its first heading.
 * Read straight from the file so a page that is missing from the meta index
 * still shows "CAP and Consistency" rather than a title-cased filename.
 */
export function pageTitleFromMarkdown(markdown: string): string {
  const fm = markdown.match(FRONTMATTER_BLOCK);
  if (fm) {
    const title = fm[1]!.match(/^title:[ \t]*(.+)$/m);
    if (title) {
      const value = title[1]!.trim().replace(/^["']|["']$/g, "").trim();
      if (value) return value;
    }
  }
  const body = fm ? markdown.slice(fm[0].length) : markdown;
  const heading = body.match(/^#{1,2}[ \t]+(.+?)[ \t]*#*$/m);
  return heading ? heading[1]!.trim() : "";
}

/**
 * Subtitle for a page card. Only an explicit `description` (or `summary`)
 * counts — body prose makes a poor one-liner and is left out on purpose.
 */
export function pageDescriptionFromMarkdown(markdown: string): string {
  const fm = markdown.match(FRONTMATTER_BLOCK);
  if (!fm) return "";
  const field = fm[1]!.match(/^(?:description|summary):[ \t]*(.+)$/m);
  if (!field) return "";
  return field[1]!.trim().replace(/^["']|["']$/g, "").trim();
}
