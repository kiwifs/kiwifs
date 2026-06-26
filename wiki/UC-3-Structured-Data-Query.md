# UC-3: Structured Data Query

**Label:** [`uc:data-query`](https://github.com/kiwifs/kiwifs/labels/uc%3Adata-query)

**Live demo:** [demo.kiwifs.com/data](https://demo.kiwifs.com/data/)

## Thesis

A user wants to import their Firebase database into markdown and query user behavior data using KiwiFS — potentially outperforming a RAG solution. This is compelling because KiwiFS has one of the most complete import + query stacks in the markdown ecosystem, and recent research shows structured markdown queries outperform RAG for bounded domains.

## Features

| Feature | Status | Location |
|---------|--------|----------|
| Import from 18+ sources (Firestore, MongoDB, PostgreSQL, MySQL, DynamoDB, Redis, Elasticsearch, CSV, JSON/JSONL, YAML, Excel, etc.) | ✅ | `internal/importer/` |
| Airbyte protocol support (hundreds more connectors) | ✅ | `internal/importer/airbyte*.go` |
| DQL with TABLE, LIST, COUNT, WHERE, SORT, GROUP BY, FLATTEN, aggregates | ✅ | `internal/dataview/` |
| `DAYS_AGO()` DQL function for temporal queries | ✅ | `internal/dataview/` |
| Full-text search (FTS5/BM25) | ✅ | `internal/search/` |
| Semantic/vector search (7 backends) | ✅ | `internal/vectorstore/` |
| Structured frontmatter queries (JSON path filters) | ✅ | `GET /api/kiwi/meta?where=` |
| Graph queries (backlinks, communities, centrality) | ✅ | `internal/api/handlers_graph.go` |
| Export to JSONL/CSV/Parquet with embeddings | ✅ | `internal/exporter/` |
| Import wizard UI with field mapping and type coercion | ✅ | `ui/src/components/KiwiImportWizard.tsx` |
| Schema inference on CSV/JSON import | ✅ | `internal/importer/` |
| Inferred schemas saved to `.kiwi/schemas/` | ✅ | `internal/importer/` |
| Inline `kiwi-chart` blocks | ✅ | `ui/src/components/KiwiPage.tsx` |

## Why Markdown Query Can Outperform RAG

Research in 2026 shows that for bounded, well-structured domains, compiled markdown consistently outperforms raw-chunk RAG:

| Metric | Markdown + RAG | Structured Query | Delta |
|--------|---------------|-----------------|-------|
| Entity recall | 0.514 | 0.976 | +90% |
| "Why?" recall | 0.000 | 1.000 | 0% → 100% |
| Reasoning quality (1-5) | 1.96 | 4.33 | +121% |
| Stability (variance) | 1.457 | 0.472 | 3× more stable |
| Latency | 284.6s | 183.8s | 35% faster |

*Source: [Structured ontology vs. Markdown+RAG](https://dev.to/martinarva/we-tested-structured-ontology-vs-markdownrag-for-ai-agents-why-recall-was-0-vs-100-42p3)*

**Key insight:** KiwiFS's import pipeline already does the critical step — it converts database rows into structured markdown with frontmatter metadata at ingest time, not at query time. DQL queries over frontmatter are deterministic SQL queries, not probabilistic vector retrieval. For "show me users who did X then Y in the last 7 days," DQL is exact. RAG would hallucinate.

The [LLM Wiki pattern](https://pasqualepillitteri.it/en/news/1496/rag-llm-wiki-agentic-search-differences-costs-2026) (coined by Karpathy) confirms: "If you have a finite, well-defined domain, the LLM Wiki pattern is almost always the right choice — total control, minimal costs, maximum transparency."

## What's Missing

| Gap | Why it matters |
|-----|---------------|
| Incremental sync / CDC | Import is batch-only; user behavior data needs continuous ingestion |
| Full temporal DQL | `DATE()`, `NOW()`, `BETWEEN` for date filtering (partial: `DAYS_AGO` shipped) |
| Multi-stage aggregation | `COUNT`/`SUM`/`AVG` exist but composable pipelines (funnel, cohort) are missing |
| Computed fields / formulas | Derived frontmatter fields without duplicating data |
| Large dataset performance | DQL over 100K+ pages needs pagination, query planning, partitioning |
| Dashboard view | `kiwi-chart` blocks exist but no combined dashboard view |

## Proposed Milestones

1. **Temporal DQL** — Remaining date/time functions: `DATE()`, `NOW()`, `BETWEEN`, date arithmetic (`DAYS_AGO` already shipped).
2. **Incremental import** — `--watch` mode for `kiwifs import` that polls for changes (Firestore listeners, PostgreSQL logical replication, CDC via Airbyte).
3. **Multi-stage aggregation** — Pipeline chaining in DQL, funnel/retention templates.
4. **Dashboard view** — UI view combining multiple `kiwi-chart` + `kiwi-query` blocks as a single dashboard.

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:data-query`.
