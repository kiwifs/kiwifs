import { useEffect, useRef, useState } from "react";
import { Calendar, Clock, File, Filter, FolderOpen, X } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@kw/components/ui/command";
import { api, type MetaFilter, type SemanticResult, type TreeEntry } from "@kw/lib/api";
import { titleize } from "@kw/lib/paths";
import { cn } from "@kw/lib/cn";

const RECENT_KEY = "kiwi:recent-searches";
const MAX_RECENT = 8;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  tree: TreeEntry | null;
  initialQuery?: string;
};

type Hit = {
  path: string;
  snippet?: string;
  score?: number;
};

type SearchSuggestion = {
  query: string;
  path: string;
  title: string;
  distance: number;
};

function topDirs(tree: TreeEntry | null): string[] {
  if (!tree?.children) return [];
  return tree.children
    .filter((c) => c.isDir)
    .map((c) => c.name)
    .sort();
}

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return;
  const prev = loadRecentSearches().filter((s) => s !== trimmed);
  const next = [trimmed, ...prev].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* quota / private mode */ }
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_KEY);
}

export function KiwiSearch({ open, onOpenChange, onSelect, tree, initialQuery }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [dirFilter, setDirFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const debounce = useRef<number | null>(null);
  const requestId = useRef(0);

  const dirs = topDirs(tree);

  useEffect(() => {
    if (open) {
      setRecents(loadRecentSearches());
      if (initialQuery) setQuery(initialQuery);
    } else {
      setQuery("");
      setHits([]);
      setDirFilter("");
      setDateFilter("");
    }
  }, [open, initialQuery]);

  const filtered = dirFilter
    ? hits.filter((h) => h.path.startsWith(dirFilter + "/"))
    : hits;

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (!query.trim()) {
      setHits([]);
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = window.setTimeout(() => {
      const thisRequest = ++requestId.current;
      const modifiedAfter = dateFilterToISO(dateFilter);
      const { text: textQuery, filters: metaFilters } = parseFieldFilters(query);

      const searchQ = textQuery.trim();
      if (!searchQ && metaFilters.length === 0) {
        setHits([]);
        setLoading(false);
        return;
      }

      const metaPromise = metaFilters.length > 0
        ? api.meta({ where: metaFilters, limit: 200 }).then((r) =>
            new Set(r.results.map((x) => x.path))
          ).catch(() => null as Set<string> | null)
        : Promise.resolve(null as Set<string> | null);

      const dateOpts = modifiedAfter ? { modifiedAfter } : undefined;

      // Fire FTS and semantic in parallel — merge results from both.
      const ftsPromise = searchQ
        ? api.search(searchQ, dateOpts).catch(() => null)
        : Promise.resolve(null);

      const semanticPromise = searchQ
        ? api.semanticSearch(searchQ, 15, 0, dateOpts).catch(() => null)
        : Promise.resolve(null);

      Promise.all([ftsPromise, semanticPromise, metaPromise]).then(
        ([ftsRes, semRes, metaPaths]) => {
          if (thisRequest !== requestId.current) return;

          // Collect results into a map keyed by path, merging both sources.
          const merged = new Map<string, Hit>();

          // FTS results first (keyword-precise, keep their snippets).
          if (ftsRes) {
            for (const x of ftsRes.results) {
              merged.set(x.path, {
                path: x.path,
                snippet: x.snippet,
                score: x.score,
              });
            }
          }

          // Fold in semantic results — prefer semantic snippet only if FTS
          // didn't already provide one (FTS snippets have highlighted markup).
          if (semRes) {
            // Deduplicate semantic hits per-path (keep highest score chunk).
            const bestSem = new Map<string, SemanticResult>();
            for (const hit of semRes.results) {
              const prev = bestSem.get(hit.path);
              if (!prev || hit.score > prev.score) bestSem.set(hit.path, hit);
            }

            for (const [path, sem] of bestSem) {
              const existing = merged.get(path);
              if (existing) {
                // Path already in FTS results — boost its score.
                existing.score = (existing.score ?? 0) + (sem.score ?? 0);
              } else {
                merged.set(path, {
                  path,
                  snippet: highlightTerms(sem.snippet, query),
                  score: sem.score,
                });
              }
            }
          }

          let results = Array.from(merged.values());

          // Apply metadata filters if present.
          if (metaPaths) {
            if (results.length > 0) {
              results = results.filter((h) => metaPaths.has(h.path));
            } else {
              // Only metadata filters, no text query matched — show meta paths.
              results = Array.from(metaPaths).map((p) => ({ path: p }));
            }
          }

          // Sort by combined score descending.
          results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

          setHits(results);
          setSuggestions(
            results.length === 0 && ftsRes?.suggestions?.length
              ? ftsRes.suggestions
              : []
          );
        },
      )
        .catch(() => {
          if (thisRequest === requestId.current) {
            setHits([]);
            setSuggestions([]);
          }
        })
        .finally(() => { if (thisRequest === requestId.current) setLoading(false); });
    }, 150);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query, dateFilter]);

  function handleSelect(path: string) {
    if (query.trim()) saveRecentSearch(query.trim());
    onSelect(path);
    onOpenChange(false);
  }

  function handleRecentClick(q: string) {
    setQuery(q);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder="Search…"
        value={query}
        onValueChange={setQuery}
      />
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border text-xs flex-wrap">
        {dirs.length > 0 && (
          <>
            <FolderOpen className="h-3 w-3 text-muted-foreground" />
            {dirFilter ? (
              <button
                type="button"
                onClick={() => setDirFilter("")}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-secondary text-secondary-foreground border-secondary"
              >
                {dirFilter}
                <X className="h-2.5 w-2.5" />
              </button>
            ) : (
              dirs.map((d) => (
                <ModeChip
                  key={d}
                  active={false}
                  onClick={() => setDirFilter(d)}
                  label={d}
                />
              ))
            )}
          </>
        )}
        {dirs.length > 0 && <span className="w-px h-4 bg-border mx-1" />}
        <Calendar className="h-3 w-3 text-muted-foreground" />
        {dateFilter ? (
          <button
            type="button"
            onClick={() => setDateFilter("")}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-secondary text-secondary-foreground border-secondary"
          >
            {dateFilter}
            <X className="h-2.5 w-2.5" />
          </button>
        ) : (
          <>
            <ModeChip active={false} onClick={() => setDateFilter("7d")} label="7 days" />
            <ModeChip active={false} onClick={() => setDateFilter("30d")} label="30 days" />
            <ModeChip active={false} onClick={() => setDateFilter("90d")} label="90 days" />
          </>
        )}
        {parseFieldFilters(query).filters.length > 0 && (
          <>
            <span className="w-px h-4 bg-border mx-1" />
            <Filter className="h-3 w-3 text-muted-foreground" />
            {parseFieldFilters(query).filters.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-primary/10 text-primary border-primary/30"
              >
                {f.field.slice(2)}={f.value}
              </span>
            ))}
          </>
        )}
      </div>
      <CommandList>
        {!query.trim() && recents.length > 0 && (
          <CommandGroup heading="Recent searches">
            {recents.map((q) => (
              <CommandItem
                key={q}
                value={"recent:" + q}
                onSelect={() => handleRecentClick(q)}
                className="!items-center !py-1.5 !gap-1.5"
              >
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs truncate flex-1">{q}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100 hover:text-foreground hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = recents.filter((r) => r !== q);
                    setRecents(next);
                    if (next.length === 0) {
                      clearRecentSearches();
                    } else {
                      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
                    }
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query && filtered.length === 0 && !loading ? (
          <CommandEmpty>
            <div className="text-center py-6 px-4">
              <p className="text-sm text-muted-foreground">No results found.</p>
              {suggestions.length > 0 ? (
                <div className="mt-3 text-sm">
                  <span className="text-muted-foreground">Did you mean: </span>
                  {suggestions.map((s, i) => (
                    <span key={s.path}>
                      {i > 0 && <span className="text-muted-foreground">, </span>}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={() => handleSelect(s.path)}
                      >
                        {s.title}
                      </button>
                    </span>
                  ))}
                  <span className="text-muted-foreground">?</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Try broader terms or check spelling.</p>
              )}
            </div>
          </CommandEmpty>
        ) : null}
        {filtered.map((r) => (
          <CommandItem
            key={r.path}
            value={r.path}
            onSelect={() => handleSelect(r.path)}
          >
            <File className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{titleize(r.path)}</div>
              <div className="text-xs text-muted-foreground truncate">
                {r.path}
              </div>
              {r.snippet && (
                <div
                  className="kiwi-search-snippet text-xs text-muted-foreground mt-0.5 line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              )}
            </div>
          </CommandItem>
        ))}
      </CommandList>
      <div className="text-[11px] text-muted-foreground px-3 py-2 border-t border-border flex justify-between">
        <span>↑↓ navigate · enter to open · esc to close · <code className="font-mono">field:value</code> to filter</span>
        <span>
          {loading
            ? "Searching…"
            : query.trim()
              ? (filtered.length + " result" + (filtered.length === 1 ? "" : "s") +
                (dirFilter && filtered.length !== hits.length
                  ? " in " + dirFilter
                  : ""))
              : ""}
        </span>
      </div>
    </CommandDialog>
  );
}

function parseFieldFilters(q: string): { text: string; filters: MetaFilter[] } {
  const filters: MetaFilter[] = [];
  const textParts: string[] = [];
  for (const token of q.split(/\s+/)) {
    const colonIdx = token.indexOf(":");
    if (colonIdx > 0 && colonIdx < token.length - 1) {
      const field = token.slice(0, colonIdx);
      const value = token.slice(colonIdx + 1);
      if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(field)) {
        filters.push({ field: `$.${field}`, op: "=", value });
        continue;
      }
    }
    textParts.push(token);
  }
  return { text: textParts.join(" "), filters };
}

function dateFilterToISO(filter: string): string | undefined {
  if (!filter) return undefined;
  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : filter === "90d" ? 90 : 0;
  if (days === 0) return undefined;
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString();
}

function highlightTerms(text: string, query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return escapeHtml(text);
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return escapeHtml(text).replace(re, "<mark>$1</mark>");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ModeChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-foreground/40"
      )}
    >
      {label}
    </button>
  );
}
