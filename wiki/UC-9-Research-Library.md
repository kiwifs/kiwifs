# UC-9: Research Library

**Label:** [`uc:research`](https://github.com/kiwifs/kiwifs/labels/uc%3Aresearch)

**Live demo:** [demo.kiwifs.com/research](https://demo.kiwifs.com/research/)

## Thesis

The dominant research workflow in 2026 is Zotero (reference manager) + Obsidian (synthesis environment), connected by community plugins. Researchers capture papers in Zotero, annotate PDFs, export literature notes as markdown into Obsidian, then use Dataview to build synthesis tables. KiwiFS has a superset of Obsidian's query capabilities (DQL, FTS5, vector search, graph view) plus what Obsidian lacks: a REST/MCP API, multi-user spaces, git versioning, and agent-native access. A researcher's KiwiFS space where an agent can query "find papers that contradict this claim" across the entire literature collection — using vector search for semantic similarity and the link graph for citation chains — doesn't exist in any single tool today.

## Features

KiwiFS already has strong alignment with literature management workflows:

| Feature | Status | Location |
|---------|--------|----------|
| Markdown files with YAML frontmatter (doi, authors, year, venue, tags) | ✅ | Every `.md` file |
| Wiki links for citation relationships (`[[smith-2024]]`) | ✅ | `internal/links/` |
| Backlinks ("what cites this paper?") | ✅ | `internal/links/` |
| Knowledge graph (2D + 3D) for citation visualization | ✅ | `ui/src/components/KiwiGraph.tsx` |
| `contradicts` frontmatter indexed as backlinks | ✅ | `internal/links/` |
| DQL queries (filter by year, venue, tags, reading status) | ✅ | `internal/dataview/` |
| Full-text search across all notes and annotations | ✅ | `internal/search/` |
| Semantic/vector search ("find papers related to…") | ✅ | `internal/vectorstore/` |
| Workflow state machine (reading pipeline) | ✅ | `internal/workflow/` |
| Git versioning (annotation history, collaborative editing) | ✅ | `internal/versioning/` |
| Multi-space (separate libraries per project/lab) | ✅ | `internal/spaces/` |
| MCP tools for agent-driven literature review | ✅ | `internal/mcpserver/` |
| Import from JSON/CSV/JSONL | ✅ | `internal/importer/` |
| Export to JSONL/CSV | ✅ | `internal/exporter/` |

## Industry Comparison

| Feature | Zotero | Obsidian (+ Dataview) | Semantic Scholar | Connected Papers | KiwiFS |
|---------|--------|----------------------|-----------------|-------------------|--------|
| Reference metadata | ✅ (native) | Plugin (Zotero Integration) | ✅ (API) | ❌ | Frontmatter |
| Citation graph | ❌ | ❌ | ✅ | ✅ | Wiki-link graph |
| Contradiction detection | ❌ | ❌ | ❌ | ❌ | ✅ (`contradicts` links) |
| Structured queries | SQL-like (limited) | Dataview | ❌ | ❌ | DQL (superset of Dataview) |
| Semantic search | ❌ | ❌ | ✅ | ❌ | ✅ (7 embedding backends) |
| Reading workflow | Tags | Manual | ❌ | ❌ | Workflow state machine |
| Collaborative | Zotero Groups | ❌ (local only) | ❌ | ❌ | Multi-space + share links |
| Agent-accessible | ❌ | ❌ | API only | ❌ | MCP (68+ tools) |
| Self-hosted | ✅ | ✅ (local) | ❌ (SaaS) | ❌ (SaaS) | ✅ (single binary) |

**KiwiFS's unique positioning:** The only tool combining citation graph visualization, contradiction detection, semantic search, structured queries, and agent-native access in one self-hosted system. A research agent can search the literature, find contradicting claims, and synthesize findings — all through MCP.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| ~~BibTeX import/export~~ | ✅ Shipped: `kiwifs import --from bibtex` (#335) | Zotero, Mendeley, LaTeX |
| DOI/arXiv metadata fetch | Single-paper ingest from identifier without manual entry | Zotero browser connector |
| Typed link relations | No distinction between `cites`, `extends`, `contradicts`, `reviews` in links | Semantic Scholar citation types |
| Author normalization | Author name variants ("J. Smith" vs "Smith, John") not resolved | Zotero author disambiguation |
| ~~Reading workflow config~~ | ✅ Shipped: `kiwifs init --template research` includes reading workflow | Zotero + Obsidian reading workflow |
| ~~Graph filtering by link type~~ | ✅ Shipped: graph view link-type filter (#340) | Connected Papers view |

## Proposed Milestones

1. ~~**Research init template**~~ ✅ — Shipped: `kiwifs init --template research` with `papers/`, `notes/`, `reviews/`, `.kiwi/workflows/reading.json`, `.kiwi/schemas/paper.json`.
2. ~~**BibTeX importer**~~ ✅ — Shipped: `kiwifs import --from bibtex --file references.bib` (#335).
3. ~~**DOI/arXiv metadata ingest**~~ ✅ — Shipped: `kiwi_cite` MCP tool fetches metadata and writes a markdown file (#336).
4. **Typed link relations** — Index `cites`, `extends`, `reviews` frontmatter arrays as typed wiki-links. Graph queries filter by relation type.
5. **Author normalization** — `FormatWrite` hook normalizes `authors` array entries to canonical form via `.kiwi/authors.json` lookup table.
6. ~~**Graph link-type filtering**~~ ✅ — Shipped: UI filter on graph view to show only specific link types (#340).

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:research`.
