# UC-10: Event Log

**Label:** [`uc:event-log`](https://github.com/kiwifs/kiwifs/labels/uc%3Aevent-log)

**Live demo:** [demo.kiwifs.com/log](https://demo.kiwifs.com/log/)

## Thesis

Event sourcing — storing state as an append-only log of immutable events — is one of the most compliance-friendly architectural patterns. The event log *is* the audit trail. In 2026, tools like opslog, Chronicle, and audit-log provide append-only storage with hash chains for tamper evidence. KiwiFS already has the core primitive: `POST /api/kiwi/file/append` writes to a file, and git commits provide an immutable hash-chained history by default. The gap is enforcing append-only semantics at the API level and making log entries queryable via DQL. For audit logs, decision logs, agent action logs, or any append-only record where human readability matters, git-tracked markdown is surprisingly powerful.

## Features

KiwiFS already has the building blocks for append-only event logging:

| Feature | Status | Location |
|---------|--------|----------|
| Append endpoint (`POST /api/kiwi/file/append`) | ✅ | `internal/api/handlers_file.go` |
| Git commit per write (implicit hash chain, tamper evidence) | ✅ | `internal/versioning/` |
| `X-Actor` / `X-Provenance` headers on every write | ✅ | `internal/pipeline/` |
| Git blame (who wrote each line, when) | ✅ | `internal/versioning/` |
| DQL queries over frontmatter | ✅ | `internal/dataview/` |
| Full-text search across log files | ✅ | `internal/search/` |
| `DAYS_AGO()` DQL function for temporal queries | ✅ | `internal/dataview/` |
| SSE live event stream | ✅ | `internal/api/handlers_events.go` |
| Webhooks on write events | ✅ | `internal/webhooks/` |
| `kiwifs check` for integrity verification | ✅ | `cmd/check.go` |
| Atomic file writes (crash-safe) | ✅ | `internal/storage/` |
| Backup to remote git (audit trail replication) | ✅ | `cmd/backup.go` |
| `log.md` convention in knowledge template | ✅ | `internal/workspace/templates/knowledge/` |

## Industry Comparison

| Feature | opslog | audit-log (Node) | Chronicle (Laravel) | EventStoreDB | KiwiFS |
|---------|--------|-------------------|---------------------|-------------|--------|
| Append-only enforcement | ✅ (architecture) | ✅ (API) | ✅ (model) | ✅ (native) | Convention (needs enforcement) |
| Hash chain | Implicit (snapshots) | SHA-256 explicit | Ed25519 signed | ✅ (native) | Git commit chain (implicit) |
| Tamper detection | Snapshot verify | `verify()` + head anchoring | Signed checkpoints | Stream hash | `kiwifs check` (needs extension) |
| Human-readable log | ❌ (JSONL) | ❌ (JSON) | ❌ (DB rows) | ❌ (binary) | ✅ (markdown) |
| Queryable entries | In-memory replay | Sink-dependent | Eloquent ORM | Projections | DQL (needs entry flattening) |
| Self-hosted | ✅ (embedded) | ✅ (embedded) | ✅ (embedded) | ✅ (server) | ✅ (single binary) |
| Snapshots / compaction | ✅ | ❌ | ❌ | ✅ | ❌ |
| Agent-accessible | ❌ | ❌ | ❌ | ❌ | MCP (68+ tools) |

**KiwiFS's unique positioning:** The only event log that's human-readable markdown, git-versioned for tamper evidence, and agent-accessible via MCP. For audit trails that need to be reviewed by humans, queried by agents, and verified for integrity, markdown + git is a natural fit.

## What's Missing

| Gap | Why it matters | Industry reference |
|-----|---------------|-------------------|
| ~~Append-only file mode~~ | ✅ Shipped: `validate_write` config enforces append-only semantics (#337) | opslog, Chronicle immutability |
| Structured log entry format | Appended sections lack machine-parseable entry structure | opslog JSONL entries |
| ~~Sequence numbering~~ | ✅ Shipped: `[sequences]` config with `kiwifs check` gap detection (#338) | EventStoreDB stream position |
| Hash chain verification | Git provides implicit chain but `kiwifs check` doesn't verify it explicitly | audit-log `verify()` |
| Log rotation | No automatic file splitting when logs exceed size thresholds | opslog snapshots |
| ~~Entry-level DQL queries~~ | ✅ Shipped: `FLATTEN` clause in DQL (#339) | EventStoreDB projections |

## Proposed Milestones

1. ~~**Append-only file mode**~~ ✅ — Shipped: `[validate_write]` config enforces append-only semantics. `PUT` overwrites rejected for configured paths; only `POST /api/kiwi/file/append` allowed (#337).
2. **Structured log entry format** — Convention for appended sections with heading-level timestamps and YAML metadata blocks. Indexer extracts entries into `file_meta.entries` JSON array.
3. ~~**Sequence numbering**~~ ✅ — Shipped: `[sequences]` config assigns monotonic sequence numbers per append. `kiwifs check` verifies continuity and detects gaps (#338).
4. **Hash chain verification** — `kiwifs check --verify-chain` walks git history for append-only files and verifies commit parent chain integrity. Reports breaks.
5. **Log rotation** — Config option `[log_rotation] max_entries = 1000`. Pipeline renames full files to `{name}-{date}.md` with `continues_from` wiki-link frontmatter.
6. ~~**Entry-level DQL**~~ ✅ — Shipped: `FLATTEN` clause in DQL queries across extracted log entries (#339).

## Good First Issues

See the [Good First Issues](Good-First-Issues) page for issues tagged `uc:event-log`.
