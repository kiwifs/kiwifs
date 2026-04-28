# Schema — Agent Knowledge Base

This knowledge base follows the LLM Wiki pattern: raw sources in,
compiled wiki out, agent maintains it over time.

## Structure

- `concepts/` — One page per concept (agent-created, durable knowledge)
- `entities/` — One page per named entity
- `reports/` — Chronological reports
- `episodes/` — Per-run episodic notes (`memory_kind: episodic`, `episode_id`)

## Operations

### Ingest
Read a raw source, create or update wiki pages in `concepts/` or
`entities/`, then update `index.md` and `log.md`.

### Query
Search the wiki to answer a question. Optionally save the answer
as a new page.

### Lint
Audit for orphan pages, broken `[[wiki links]]`, contradictions,
stale content, and coverage gaps.

## Episodic memory

Files under `episodes/` are treated as episodic by default. Set
`memory_kind: episodic` and `episode_id` in frontmatter. A
consolidation job merges episodes into `concepts/` pages using
`merged-from` in frontmatter. Run `kiwifs memory report` to see
which episodes haven't been consolidated yet.

See [docs/MEMORY.md](../../docs/MEMORY.md) for full reference.

## Conventions
- Link between pages with `[[wiki links]]`.
- Keep pages focused. One concept per page.
- Use YAML frontmatter for structured metadata.
