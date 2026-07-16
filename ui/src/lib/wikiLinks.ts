// Remark plugin + resolver for [[wiki-link]] and ![[embed]] syntax.
//
// Parses `[[target]]` or `[[target|label]]` inside text nodes and replaces
// them with link nodes whose URL uses a `#kiwi:` hash-prefixed scheme.
// The hash prefix ensures rehype-sanitize never strips the URL (hash
// fragments bypass protocol checking). React-markdown then renders those
// as clickable spans via a custom <a> component.
//
// `![[target]]` is the Obsidian-style embed syntax: it emits an image node
// instead of a link, so the media-aware img override renders it as
// <img>, <video>, <audio>, or <iframe> based on file extension.
//
// ── Resolution model (Obsidian-compatible, directory-aware) ─────────────────
// Resolution takes the *source* page's path (`fromPath`) so links resolve
// relative to where they were written, matching Obsidian's
// `getFirstLinkpathDest(linkpath, sourcePath)`:
//
//   [[./sibling]] / [[../up/note]]  → explicit-relative to the source dir
//   [[/folder/note]]                → vault-absolute (leading slash)
//   [[folder/note]]                 → absolute-from-root, then relative to the
//                                     source dir, then a unique path suffix
//   [[note]]                        → unique basename; on collision, prefer a
//                                     file in the source dir, then the shortest
//                                     path, then lexicographically first
//
// A bare name matches only an exact (normalized) basename — there is no
// stem-*prefix* fuzzing, which previously mis-resolved [[reverse]] to whichever
// of reverse-string / reverse-vowels happened to be indexed first.
//
// The Go backend (internal/links) implements the same order and tie-breaks so
// rendering, backlinks, and the graph never disagree; the shared cases are
// exercised by wikiLinks.test.ts and links resolver tests.
//
// The index is built once from the file tree and rebuilt whenever the tree
// changes, so per-link lookups are O(1) except the rare path-suffix fallback.

import { visit } from "unist-util-visit";
import GithubSlugger from "github-slugger";
import type { Root } from "mdast";
import type { TreeEntry } from "@kw/lib/api";
import { dirOf, normalizePath } from "@kw/lib/paths";

/**
 * Resolve a raw wiki-link target to a canonical file path (or null).
 * `fromPath` is the page the link was written on; omit it (or pass "") to
 * resolve from the vault root only (no relative resolution).
 */
export type LinkResolver = (target: string, fromPath?: string) => string | null;

function flatten(tree: TreeEntry): string[] {
  const out: string[] = [];
  const walk = (n: TreeEntry) => {
    if (!n.isDir) out.push(n.path);
    (n.children || []).forEach(walk);
  };
  walk(tree);
  return out;
}

// Normalize a path or target for case/separator-insensitive matching:
// lowercase, drop a trailing `.md`, and collapse runs of -, _, and whitespace
// to a single hyphen. Slashes are preserved so path structure survives.
function normalize(s: string): string {
  return s.toLowerCase().replace(/\.md$/i, "").replace(/[-_\s]+/g, "-");
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function segmentCount(p: string): number {
  return p.split("/").length;
}

// Deterministic tie-break shared with the Go backend: a candidate in the
// source directory wins; otherwise the shortest path; otherwise the
// lexicographically smallest path.
function tieBreak(candidates: string[], fromDir: string): string {
  const inDir = candidates.filter((p) => dirOf(p) === fromDir);
  const pool = inDir.length > 0 ? inDir : candidates;
  return [...pool].sort((a, b) => {
    const sa = segmentCount(a);
    const sb = segmentCount(b);
    if (sa !== sb) return sa - sb;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];
}

export function buildResolver(tree: TreeEntry | null): LinkResolver {
  if (!tree) return () => null;
  // Sort for deterministic tie-breaking regardless of tree walk order.
  const paths = flatten(tree).sort();

  // normalize(fullPath) → canonical path (handles absolute + relative exacts).
  const byNormPath = new Map<string, string>();
  // normalize(basename) → all canonical paths with that basename (ambiguity).
  const byStem = new Map<string, string[]>();
  for (const p of paths) {
    const np = normalize(p);
    if (!byNormPath.has(np)) byNormPath.set(np, p);
    const stem = normalize(basenameOf(p));
    const bucket = byStem.get(stem);
    if (bucket) bucket.push(p);
    else byStem.set(stem, [p]);
  }

  const lookupExact = (p: string): string | null => byNormPath.get(normalize(p)) ?? null;

  const resolveSuffix = (page: string, fromDir: string): string | null => {
    const key = "/" + normalize(page);
    const matches = paths.filter((p) => normalize(p).endsWith(key));
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return tieBreak(matches, fromDir);
  };

  const resolvePage = (page: string, fromPath?: string): string | null => {
    if (!page) return null;
    const fromDir = fromPath ? dirOf(fromPath) : "";

    // 1. Explicit-relative: resolve against the source directory only.
    if (page.startsWith("./") || page.startsWith("../")) {
      const joined = normalizePath(fromDir ? `${fromDir}/${page}` : page);
      return lookupExact(joined);
    }

    // 2. Vault-absolute (leading slash).
    if (page.startsWith("/")) {
      return lookupExact(page.replace(/^\/+/, ""));
    }

    // 3. Contains a slash: absolute-from-root, then relative, then suffix.
    if (page.includes("/")) {
      const abs = lookupExact(page);
      if (abs) return abs;
      if (fromDir) {
        const rel = lookupExact(normalizePath(`${fromDir}/${page}`));
        if (rel) return rel;
      }
      return resolveSuffix(page, fromDir);
    }

    // 4. Bare name: unique basename, else deterministic tie-break.
    const cands = byStem.get(normalize(page));
    if (!cands || cands.length === 0) return null;
    if (cands.length === 1) return cands[0];
    return tieBreak(cands, fromDir);
  };

  return (target, fromPath) => {
    if (!target) return null;
    const t = target.trim();

    // Split off heading anchor: [[page#heading]] → page + heading
    const hashIdx = t.indexOf("#");
    const pagePart = hashIdx >= 0 ? t.slice(0, hashIdx) : t;
    const headingPart = hashIdx >= 0 ? t.slice(hashIdx + 1) : "";

    // Same-page heading link: [[#heading]]
    if (!pagePart && headingPart) {
      const slugger = new GithubSlugger();
      return `#${slugger.slug(headingPart)}`;
    }

    const resolved = resolvePage(pagePart, fromPath);
    if (!resolved) return null;

    // Append heading slug if present
    if (headingPart) {
      const slugger = new GithubSlugger();
      return `${resolved}#${slugger.slug(headingPart)}`;
    }
    return resolved;
  };
}

// Extract all [[wiki]] targets from a markdown string (including ![[embeds]]).
export function extractWikiTargets(md: string): string[] {
  const out: string[] = [];
  const re = /!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1].trim());
  return out;
}

// Remark plugin: rewrite [[x]] and ![[x]] occurrences in text nodes.
// [[x]] → link node (wiki link), ![[x]] → image node (embed).
export function remarkWikiLinks(opts: { resolver: LinkResolver; fromPath?: string }) {
  const re = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes("[[")) return;

      const parts: (typeof node | any)[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(node.value)) !== null) {
        if (m.index > last) {
          parts.push({ type: "text", value: node.value.slice(last, m.index) });
        }
        const isEmbed = m[1] === "!";
        const target = m[2].trim();
        const label = (m[3] || target).trim();
        const resolved = opts.resolver(target, opts.fromPath);

        if (isEmbed) {
          const src = resolved ? `/raw/${resolved}` : `/raw/${target}`;
          const sizeMatch = label !== target ? label.match(/^(\d+)(?:x(\d+))?$/) : null;
          const width = sizeMatch ? sizeMatch[1] : undefined;
          const height = sizeMatch ? sizeMatch[2] : undefined;

          if (resolved && resolved.endsWith(".md")) {
            parts.push({
              type: "link",
              url: `#kiwi:${resolved}`,
              title: "Embedded page (click to open)",
              children: [{ type: "text", value: label }],
              data: {
                hProperties: {
                  className: "wiki-link wiki-embed-page",
                  dataKiwiTarget: resolved,
                },
              },
            });
          } else {
            parts.push({
              type: "image",
              url: src,
              alt: sizeMatch ? (resolved || target) : label,
              data: {
                hProperties: {
                  ...(width ? { width } : {}),
                  ...(height ? { height } : {}),
                },
              },
            });
          }
        } else {
          // Same-page heading anchors: resolved is "#slug"
          const isSamePageAnchor = resolved?.startsWith("#");
          const url = isSamePageAnchor
            ? resolved
            : resolved
              ? `#kiwi:${resolved}`
              : `#kiwi-missing:${target}`;
          parts.push({
            type: "link",
            url,
            title: resolved || `Missing: ${target}`,
            children: [{ type: "text", value: label }],
            data: {
              hProperties: {
                className: resolved ? "wiki-link" : "wiki-link wiki-link-missing",
                dataKiwiTarget: resolved || target,
                dataKiwiMissing: resolved ? undefined : "true",
              },
            },
          });
        }
        last = m.index + m[0].length;
      }
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      if (parts.length > 0) {
        (parent as any).children.splice(index, 1, ...parts);
        return index + parts.length;
      }
    });
  };
}
