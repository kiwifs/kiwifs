import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TreeEntry } from "@kw/lib/api";
import { dirOf, titleize } from "@kw/lib/paths";

export interface PageIndexEntry {
  /** Workspace-relative path, e.g. `02-arrays/two-sum.md`. */
  path: string;
  /** File name including extension. */
  name: string;
  /** Containing directory, `""` for workspace root. */
  dir: string;
  /** Frontmatter `title` when present, otherwise a titleized file name. */
  title: string;
  /** True for folder landing pages (`_index.md`, `index.md`). */
  isIndex: boolean;
  /** Frontmatter of the page — empty when `frontmatter: false`. */
  frontmatter: Record<string, unknown>;
}

export interface PageIndexOptions {
  /** Limit the index to pages under this directory. Default: whole workspace. */
  root?: string;
  /** Include `_index.md` / `index.md` landing pages. Default false. */
  includeIndex?: boolean;
  /** Load frontmatter and real titles. Default true. */
  frontmatter?: boolean;
}

export interface PageIndexResult {
  pages: PageIndexEntry[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** The meta API caps each response at 200 rows. */
const META_PAGE_SIZE = 200;

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isIndexPage(name: string): boolean {
  return name === "index.md" || name.startsWith("_");
}

function collectPages(node: TreeEntry, out: TreeEntry[]) {
  for (const child of node.children ?? []) {
    if (child.isDir) collectPages(child, out);
    else if (child.name.endsWith(".md")) out.push(child);
  }
}

async function fetchAllFrontmatter(): Promise<Record<string, Record<string, unknown>>> {
  const map: Record<string, Record<string, unknown>> = {};
  let offset = 0;
  for (;;) {
    const res = await api.meta({ limit: META_PAGE_SIZE, offset });
    for (const row of res.results) map[row.path] = row.frontmatter;
    if (res.results.length < META_PAGE_SIZE) break;
    offset += META_PAGE_SIZE;
  }
  return map;
}

/**
 * Read-only index of the markdown pages in the workspace, with frontmatter.
 *
 * Exposed to `widget:live` so markdown widgets can reason about the workspace
 * as a whole — curriculum totals, coverage, roadmaps — instead of only the data
 * hand-written into the widget. Pages are sorted naturally by path, so numbered
 * folders (`01-`, `02-`, `10-`) come out in authoring order.
 */
export function usePageIndex(options?: PageIndexOptions): PageIndexResult {
  const root = options?.root ?? "/";
  const includeIndex = options?.includeIndex ?? false;
  const withFrontmatter = options?.frontmatter ?? true;

  const [tree, setTree] = useState<TreeEntry | null>(null);
  const [meta, setMeta] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.tree(root), withFrontmatter ? fetchAllFrontmatter() : Promise.resolve({})])
      .then(([t, m]) => {
        if (cancelled) return;
        setTree(t);
        setMeta(m);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [root, withFrontmatter, nonce]);

  const pages = useMemo(() => {
    if (!tree) return [];
    const files: TreeEntry[] = [];
    collectPages(tree, files);

    const entries = files
      .filter((f) => includeIndex || !isIndexPage(f.name))
      .map((f) => {
        const frontmatter = meta[f.path] ?? {};
        const fmTitle = typeof frontmatter.title === "string" ? frontmatter.title : "";
        return {
          path: f.path,
          name: f.name,
          dir: dirOf(f.path),
          title: fmTitle || titleize(f.name),
          isIndex: isIndexPage(f.name),
          frontmatter,
        };
      });

    entries.sort((a, b) => naturalCompare(a.path, b.path));
    return entries;
  }, [tree, meta, includeIndex]);

  return { pages, loading, error, reload };
}
