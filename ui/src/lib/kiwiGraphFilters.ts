import type { GraphEdge } from "@kw/lib/api";

export const RELATION_FILTER_SESSION_KEY = "kiwifs-graph-relation-filter";

/** Matches backend links.ValidTypedFieldName — safe typed-link frontmatter keys. */
const VALID_RELATION_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Sanitize relation from API/session input.
 * Empty string = wiki-link; invalid values normalize to wiki-link (defense in depth).
 */
export function sanitizeRelation(relation: unknown): string {
  if (relation == null || relation === "") return "";
  if (typeof relation !== "string") return "";
  const trimmed = relation.trim();
  if (trimmed === "" || !VALID_RELATION_RE.test(trimmed)) return "";
  return trimmed;
}

/** Display label for a relation type; empty string = body wiki-link. */
export function relationLabel(relation: string): string {
  return relation === "" ? "wiki-link" : relation;
}

/** Unique relation types from edges, wiki-link first then alphabetical. */
export function collectRelationTypes(edges: Array<{ relation?: string }>): string[] {
  const set = new Set<string>();
  for (const e of edges) {
    set.add(sanitizeRelation(e.relation));
  }
  return Array.from(set).sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
}

export function edgeMatchesRelationFilter(
  relation: string,
  selected: ReadonlySet<string>,
  available?: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  const safe = sanitizeRelation(relation);
  if (available && available.size > 0 && !available.has(safe)) return false;
  return selected.has(safe);
}

export type ResolvedGraphLink = {
  source: string;
  target: string;
  relation: string;
};

/** Whether a node participates in at least one edge matching the relation filter. */
export function nodeMatchesRelationFilter(
  nodeId: string,
  links: ResolvedGraphLink[],
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  for (const link of links) {
    if (!edgeMatchesRelationFilter(link.relation, selected)) continue;
    if (link.source === nodeId || link.target === nodeId) return true;
  }
  return false;
}

/** Resolve API edges to canonical source/target/relation tuples for filtering. */
export function resolveGraphLinks(
  edges: GraphEdge[],
  resolver: (target: string, fromPath?: string) => string | null,
  nodeIds: ReadonlySet<string>,
): ResolvedGraphLink[] {
  const out: ResolvedGraphLink[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (!nodeIds.has(e.source)) continue;
    const resolved = resolver(e.target, e.source);
    if (!resolved || !nodeIds.has(resolved) || resolved === e.source) continue;
    const relation = sanitizeRelation(e.relation);
    const key = `${e.source}||${resolved}||${relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: e.source, target: resolved, relation });
  }
  return out;
}

export function loadRelationFilterFromSession(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(RELATION_FILTER_SESSION_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((v): v is string => typeof v === "string")
        .map(sanitizeRelation),
    );
  } catch {
    return new Set();
  }
}

/** Drop stale relation types; empty intersection resets to "All". */
export function reconcileRelationFilter(
  selected: ReadonlySet<string>,
  available: readonly string[],
): Set<string> {
  if (selected.size === 0) return new Set();
  const valid = new Set(available);
  const next = new Set([...selected].filter((r) => valid.has(r)));
  return next.size === 0 ? new Set() : next;
}

export function saveRelationFilterToSession(selected: ReadonlySet<string>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (selected.size === 0) {
      sessionStorage.removeItem(RELATION_FILTER_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      RELATION_FILTER_SESSION_KEY,
      JSON.stringify(Array.from(selected).sort()),
    );
  } catch {
    // ignore quota / privacy mode
  }
}

export function shouldShowRelationFilters(relations: string[]): boolean {
  return relations.length > 1 || relations.some((r) => r !== "");
}
