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
// Resolution is fuzzy:
//   [[authentication]]         → pages/authentication.md
//   [[pages/auth]]             → pages/auth.md  (exact first, then fuzzy)
//   [[Authentication]]         → case-insensitive match on the stem
//
// The resolver is built once from the file tree and re-built whenever the
// tree changes, so lookups are O(1) per link.

import { visit } from "unist-util-visit";
import GithubSlugger from "github-slugger";
import type { Root } from "mdast";
import type { TreeEntry } from "@kw/lib/api";

export type LinkResolver = (target: string) => string | null;

function flatten(tree: TreeEntry): string[] {
  const out: string[] = [];
  const walk = (n: TreeEntry) => {
    if (!n.isDir) out.push(n.path);
    (n.children || []).forEach(walk);
  };
  walk(tree);
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[-_\s]+/g, "-");
}

export function buildResolver(tree: TreeEntry | null): LinkResolver {
  if (!tree) return () => null;
  const paths = flatten(tree);

  const byPath = new Map<string, string>();
  const byNormPath = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const p of paths) {
    byPath.set(p, p);
    byNormPath.set(normalize(p), p);
    const stem = p.substring(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    byStem.set(normalize(stem), p);
  }

  return (target) => {
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

    // Resolve the page part
    let resolved: string | null = null;
    if (byPath.has(pagePart)) resolved = byPath.get(pagePart)!;
    else if (byPath.has(pagePart + ".md")) resolved = byPath.get(pagePart + ".md")!;
    else {
      const n = normalize(pagePart);
      if (byNormPath.has(n)) resolved = byNormPath.get(n)!;
      else if (byStem.has(n)) resolved = byStem.get(n)!;
      else {
        for (const [stem, p] of byStem.entries()) {
          if (stem.startsWith(n)) { resolved = p; break; }
        }
      }
    }

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
export function remarkWikiLinks(opts: { resolver: LinkResolver }) {
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
        const resolved = opts.resolver(target);

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
