package mcpserver

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"bytes"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/dataview"
	"github.com/kiwifs/kiwifs/internal/docexport"
	"github.com/kiwifs/kiwifs/internal/exporter"
	"github.com/kiwifs/kiwifs/internal/importer"
	"github.com/kiwifs/kiwifs/internal/markdown"
	"github.com/kiwifs/kiwifs/internal/memory"
	"github.com/kiwifs/kiwifs/internal/tracing"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

var stderr = log.New(os.Stderr, "kiwifs-mcp: ", log.LstdFlags)

type Options struct {
	Remote  string
	Root    string
	APIKey  string
	Space   string
	HTTP    bool
	Port    int
	Emitter tracing.Emitter
	Backend Backend
}

func New(opts Options) (*server.MCPServer, Backend, error) {
	var backend Backend
	switch {
	case opts.Backend != nil:
		backend = opts.Backend
	case opts.Remote != "":
		backend = NewRemoteBackend(opts.Remote, opts.APIKey, opts.Space)
	default:
		backend = NewLocalBackend(opts.Root)
	}

	em := opts.Emitter
	if em == nil {
		em = tracing.NoopEmitter{}
	}

	s := server.NewMCPServer(
		"kiwifs",
		"1.0.0",
		server.WithRecovery(),
		server.WithToolHandlerMiddleware(tracingMiddleware(em)),
	)

	registerTools(s, backend, opts)
	registerMemoryTools(s, backend)
	registerResources(s, backend, opts)

	return s, backend, nil
}

func tracingMiddleware(em tracing.Emitter) server.ToolHandlerMiddleware {
	return func(next server.ToolHandlerFunc) server.ToolHandlerFunc {
		return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			ctx = tracing.Start(ctx, "mcp", req.Params.Name)

			if q, ok := req.GetArguments()["query"].(string); ok {
				tracing.SetQuery(ctx, q)
			}

			result, err := next(ctx, req)

			isErr := err != nil || (result != nil && result.IsError)
			rec := tracing.Finish(ctx, err)
			if rec != nil {
				em.Emit(*rec)
			}
			tid, tdur := "", ""
			if rec != nil {
				tid, tdur = rec.ID, rec.Duration
			}
			stderr.Printf("tool=%s trace=%s duration=%s error=%v",
				req.Params.Name, tid, tdur, isErr)

			return result, err
		}
	}
}

func registerTools(s *server.MCPServer, b Backend, opts Options) {
	pathOpts := []mcp.PropertyOption{
		mcp.Required(),
		mcp.Description("Relative path like pages/auth.md"),
		mcp.MaxLength(500),
	}

	s.AddTools(
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_read",
				mcp.WithDescription("Read a markdown file from the knowledge base. Use this to check existing knowledge before writing — e.g. read the coverage strategy before deciding what to test, or read failure patterns to check if a similar failure has been seen before."),
				mcp.WithString("path", pathOpts...),
				mcp.WithBoolean("resolve_links", mcp.Description("When true, resolve [[wiki-links]] to full permalink URLs in the returned content. Default false (raw markdown).")),
				mcp.WithBoolean("metadata_only", mcp.Description("If true, return only YAML frontmatter as JSON. Saves tokens when you only need metadata (status, tags, dates) not the full page content.")),
				mcp.WithString("if_not_etag", mcp.Description("If provided and matches current ETag, returns not_modified instead of content. Saves tokens on unchanged files.")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleRead(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_write",
				mcp.WithDescription("Write a markdown file to the knowledge base. Creates the file if it doesn't exist, overwrites if it does. Every write is an atomic git commit — old content is preserved in git history. Use provenance to link this write to the run or process that produced the knowledge."),
				mcp.WithString("path", pathOpts...),
				mcp.WithString("content", mcp.Required(), mcp.Description("Markdown content to write"), mcp.MaxLength(32*1024*1024)),
				mcp.WithString("actor", mcp.Description("Who is writing — defaults to mcp-agent")),
				mcp.WithString("provenance", mcp.Description("Link to source, format type:id, e.g. run:run-249")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleWrite(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_search",
				mcp.WithDescription("Search the knowledge base using full-text search. Returns ranked results with snippets. Use this to find relevant knowledge — e.g. search for an error message to find similar past failures, or search for a concept to find related pages."),
				mcp.WithString("query", mcp.Required(), mcp.Description("Search query")),
				mcp.WithNumber("limit", mcp.Description("Max results (default 20, max 50)")),
				mcp.WithString("path_prefix", mcp.Description("Filter to a subtree like failures/")),
				mcp.WithString("scope", mcp.Description("Filter to pages whose frontmatter scope exactly matches, e.g. user:alice")),
				mcp.WithNumber("offset", mcp.Description("Offset for pagination (default 0)")),
				mcp.WithNumber("recency_weight", mcp.Description("Blend recency into ranking, from 0.0 relevance-only to 1.0 recency-only")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleSearch(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_tree",
				mcp.WithDescription("List files and folders in the knowledge base. Use this to understand what knowledge exists before reading or writing. Returns an indented tree with file sizes."),
				mcp.WithString("path", mcp.Description("Subtree root, defaults to root"), mcp.MaxLength(500)),
				mcp.WithNumber("depth", mcp.Description("Tree depth (default 3)")),
				mcp.WithBoolean("include_permalinks", mcp.Description("When true, include permalink URLs next to each file. Default false.")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleTree(b, opts),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_query_meta",
				mcp.WithDescription("Query files by their YAML frontmatter fields. Use this for structured queries like 'find all failure patterns with status=open' or 'find all run records for project X sorted by date'. Filter format: $.field=value (e.g. $.status=published, $.priority=high). Filters can be empty to return all rows."),
				mcp.WithArray("filters", mcp.Description("Filters in format $.field=value (AND-ed). Can be empty to return all rows."), mcp.WithStringItems()),
				mcp.WithArray("or", mcp.Description("OR-group filters in format $.field=value (OR-ed together, AND-ed with filters)"), mcp.WithStringItems()),
				mcp.WithArray("paths", mcp.Description("Filter to these specific file paths. Returns frontmatter for each."), mcp.WithStringItems()),
				mcp.WithString("sort", mcp.Description("Sort field like $.last-exercised")),
				mcp.WithString("order", mcp.Description("asc or desc")),
				mcp.WithNumber("limit", mcp.Description("Max results (default 20)")),
				mcp.WithNumber("offset", mcp.Description("Offset for pagination (default 0)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleQueryMeta(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_query",
				mcp.WithDescription("Run a DQL (Dataview Query Language) query against the knowledge base. Supports TABLE, LIST, COUNT, DISTINCT queries with WHERE filters, SORT, GROUP BY, FLATTEN, and pagination. Examples: 'TABLE name, status FROM \"students/\" WHERE status = \"active\" SORT name ASC', 'COUNT WHERE tags IN (\"math\")', 'DISTINCT status'."),
				mcp.WithString("query", mcp.Required(), mcp.Description("DQL query text")),
				mcp.WithString("format", mcp.Description("Output format: table, list, json (default table)")),
				mcp.WithNumber("limit", mcp.Description("Max results (default 20)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleQuery(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_view_refresh",
				mcp.WithDescription("Force-regenerate a computed view file. A computed view is a markdown file with 'kiwi-view: true' in frontmatter — its body is auto-generated from the DQL query in 'kiwi-query'. Use this to refresh a dashboard or report view."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Path to the computed view file")),
				mcp.WithReadOnlyHintAnnotation(false),
				mcp.WithDestructiveHintAnnotation(false),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleViewRefresh(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_delete",
				mcp.WithDescription("Delete a file from the knowledge base. The deletion is a git commit — the file's history is preserved and can be restored. Use sparingly; prefer updating content over deleting."),
				mcp.WithString("path", pathOpts...),
				mcp.WithString("actor", mcp.Description("Who is deleting")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleDelete(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_rename",
				mcp.WithDescription("Atomically rename/move a file. The old path is removed and the new path is created in a single git commit. File history is preserved. By default, all [[wiki-links]] pointing to the old name are rewritten."),
				mcp.WithString("from", mcp.Required(), mcp.Description("Current file path"), mcp.MaxLength(500)),
				mcp.WithString("to", mcp.Required(), mcp.Description("New file path"), mcp.MaxLength(500)),
				mcp.WithString("actor", mcp.Description("Who is renaming")),
				mcp.WithBoolean("update_links", mcp.Description("Rewrite [[wiki-links]] in other files that point to the old name (default true)")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(false),
			),
			Handler: handleRename(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_bulk_write",
				mcp.WithDescription("Write multiple files in a single atomic git commit. Use this when updating related files together — e.g. writing a run record and updating the coverage strategy in the same operation. Old content is preserved in git history."),
				mcp.WithArray(
					"files",
					mcp.Required(),
					mcp.Description("Array of {path, content} objects"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"path":    map[string]any{"type": "string"},
							"content": map[string]any{"type": "string"},
						},
						"required": []string{"path", "content"},
					}),
				),
				mcp.WithString("actor", mcp.Description("Who is writing — defaults to mcp-agent")),
				mcp.WithString("provenance", mcp.Description("Link to source, format type:id")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleBulkWrite(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_aggregate",
				mcp.WithDescription("Aggregate files by a frontmatter field with optional calculations. Use this for analytics like 'count by status', 'average mastery by grade', or 'sum scores by subject'. Supports count, avg, sum, min, max."),
				mcp.WithString("group_by", mcp.Required(), mcp.Description("Field to group by, e.g. status, grade, subject")),
				mcp.WithString("calculate", mcp.Description("Aggregations: count (default), avg:field, sum:field, min:field, max:field. Comma-separated for multiple.")),
				mcp.WithString("where", mcp.Description("Optional DQL WHERE filter expression")),
				mcp.WithString("path_prefix", mcp.Description("Optional path prefix to scope results, e.g. students/")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleAggregate(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_import",
				mcp.WithDescription("Import data from an external source (database, CSV, JSON) into the knowledge base. Each record becomes a markdown file with frontmatter. Supports: postgres, mysql, firestore, sqlite, mongodb, csv, json, jsonl, notion, airtable."),
				mcp.WithString("from", mcp.Required(), mcp.Description(`Source type: "postgres" | "mysql" | "firestore" | "sqlite" | "mongodb" | "csv" | "json" | "jsonl" | "notion" | "airtable"`)),
				mcp.WithString("dsn", mcp.Description("Connection string (postgres, mysql)")),
				mcp.WithString("uri", mcp.Description("Connection URI (mongodb)")),
				mcp.WithString("db", mcp.Description("Database file path (sqlite)")),
				mcp.WithString("file", mcp.Description("File path (csv, json, jsonl)")),
				mcp.WithString("table", mcp.Description("Table name (postgres, mysql, sqlite)")),
				mcp.WithString("collection", mcp.Description("Collection name (firestore, mongodb)")),
				mcp.WithString("database", mcp.Description("Database name (mongodb)")),
				mcp.WithString("database_id", mcp.Description("Database ID (notion)")),
				mcp.WithString("base_id", mcp.Description("Base ID (airtable)")),
				mcp.WithString("table_id", mcp.Description("Table ID (airtable)")),
				mcp.WithString("project", mcp.Description("GCP project ID (firestore)")),
				mcp.WithString("query", mcp.Description("Custom SQL query (overrides table)")),
				mcp.WithArray("columns", mcp.Description("Optional column filter"), mcp.WithStringItems()),
				mcp.WithString("prefix", mcp.Description("Path prefix in kiwifs (default: table/collection name)")),
				mcp.WithNumber("limit", mcp.Description("Max rows to import")),
				mcp.WithBoolean("dry_run", mcp.Description("Preview mode — show what would be imported without writing")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleImport(b, opts),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_ingest",
				mcp.WithDescription("Ingest a document (PDF, DOCX, PPTX, Excel, HTML, EPUB) into the knowledge base. Converts to markdown via MarkItDown, then runs post-processing: section splitting, TF-IDF keyword extraction, cross-reference→wiki-link conversion, and frontmatter generation. Distinct from kiwi_import which handles structured data sources (databases, CSV)."),
				mcp.WithString("file", mcp.Required(), mcp.Description("Path to the document file to ingest")),
				mcp.WithString("split_mode", mcp.Description(`"single" (one big file, default) or "sections" (one file per top-level heading)`)),
				mcp.WithString("prefix", mcp.Description("Output path prefix in kiwifs (e.g. imports/financial-report/). Auto-derived from filename if omitted.")),
				mcp.WithBoolean("extract_keywords", mcp.Description("Run TF-IDF keyword extraction and add to frontmatter (default false)")),
				mcp.WithNumber("max_keywords", mcp.Description("Max keywords per section (default 10)")),
				mcp.WithBoolean("convert_crossrefs", mcp.Description("Convert 'See Section X.Y' references to [[wiki-links]] (default false)")),
				mcp.WithString("actor", mcp.Description("Who is ingesting — defaults to kiwi-ingest")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleIngest(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_export",
				mcp.WithDescription("Export knowledge base files to JSONL, CSV, or Parquet format. Streams all files (or a subset) with their frontmatter, content, and link data. Optionally include vector embeddings for ML pipelines."),
				mcp.WithString("format", mcp.Required(), mcp.Description(`Output format: "jsonl" | "csv" | "parquet"`)),
				mcp.WithString("path", mcp.Description("Scope to a subdirectory (e.g. students/)")),
				mcp.WithArray("columns", mcp.Description("Frontmatter fields for CSV mode"), mcp.WithStringItems()),
				mcp.WithBoolean("include_content", mcp.Description("Include full markdown content")),
				mcp.WithBoolean("include_embeddings", mcp.Description("Include vector embeddings for each file's chunks")),
				mcp.WithNumber("limit", mcp.Description("Max files to export")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleExport(b, opts),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_export_document",
				mcp.WithDescription("Render markdown documents to publication-ready formats: PDF, standalone HTML, slide decks (Marp), or static documentation sites (MkDocs). Supports themes, bibliography/citations, cross-references, and multi-file book compilation. Requires external tools (Pandoc, Marp, MkDocs) to be installed."),
				mcp.WithString("format", mcp.Required(), mcp.Description(`Output format: "pdf" | "html" | "slides" | "site"`)),
				mcp.WithString("path", mcp.Required(), mcp.Description("File or directory path to export (e.g. docs/report.md or docs/)")),
				mcp.WithString("theme", mcp.Description(`Theme name: "paper" | "modern" | "minimal" | "dark" | "presentation"`)),
				mcp.WithBoolean("self_contained", mcp.Description("Embed all resources (images, CSS, fonts) in output")),
				mcp.WithString("bibliography", mcp.Description("Path to .bib or .json bibliography file")),
				mcp.WithString("csl_style", mcp.Description(`Citation style: "apa" | "ieee" | "chicago" | "vancouver" | "harvard"`)),
				mcp.WithBoolean("crossref", mcp.Description("Enable cross-references for figures, tables, equations")),
				mcp.WithString("pdf_engine", mcp.Description(`PDF engine: "typst" | "xelatex" (default: auto-detect)`)),
				mcp.WithString("slide_format", mcp.Description(`Slide output: "html" | "pdf" | "pptx" (default: "html")`)),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleExportDocument(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_changes",
				mcp.WithDescription("List files changed since a given checkpoint. Returns changes with paths, actions, actors, and timestamps. Store last_seq and pass it as since on next call to get incremental updates."),
				mcp.WithString("since", mcp.Description("Commit hash to start from (exclusive). Omit to get recent changes.")),
				mcp.WithNumber("limit", mcp.Description("Max changes to return (default 50, max 500)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleChanges(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_append",
				mcp.WithDescription("Atomically append content to a file. No read-modify-write race. Ideal for log files, journals, and append-only records."),
				mcp.WithString("path", pathOpts...),
				mcp.WithString("content", mcp.Required(), mcp.Description("Content to append")),
				mcp.WithString("separator", mcp.Description(`Separator between existing and new content (default "\\n")`)),
				mcp.WithString("actor", mcp.Description("Who is appending")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(false),
			),
			Handler: handleAppend(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_search_semantic",
				mcp.WithDescription("Find pages semantically similar to a query. Uses vector embeddings. Useful for finding related content, checking for near-duplicates before creating a page, and discovering connections."),
				mcp.WithString("query", mcp.Required(), mcp.Description("Search query")),
				mcp.WithNumber("limit", mcp.Description("Max results (default 5)")),
				mcp.WithNumber("threshold", mcp.Description("Minimum similarity score 0.0–1.0")),
				mcp.WithString("scope", mcp.Description("Filter to pages whose frontmatter scope exactly matches, e.g. user:alice")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleSearchSemantic(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_recall",
				mcp.WithDescription("Fused memory recall combining keyword (FTS), semantic (vector), and graph (backlink) retrieval with Reciprocal Rank Fusion. Use for agent memory retrieval instead of calling kiwi_search, kiwi_search_semantic, and kiwi_backlinks separately."),
				mcp.WithString("query", mcp.Required(), mcp.Description("Natural language recall query")),
				mcp.WithNumber("limit", mcp.Description("Max results (default 10, max 50)")),
				mcp.WithArray("sources", mcp.Description("Retrieval sources to fuse: fts, vector, graph (default: all three)"), mcp.WithStringItems()),
				mcp.WithString("scope", mcp.Description("Filter to pages whose frontmatter scope exactly matches, e.g. semantic")),
				mcp.WithBoolean("boost_verified", mcp.Description("Multiply score by frontmatter confidence (0.0–1.0) when present")),
				mcp.WithNumber("k", mcp.Description("RRF rank constant (default 60)")),
				mcp.WithString("path_prefix", mcp.Description("Optional path prefix to scope results")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleRecall(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_backlinks",
				mcp.WithDescription("List all pages that link to a given page via [[wiki links]]. Useful for understanding page connections and impact of changes."),
				mcp.WithString("path", pathOpts...),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleBacklinks(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_analytics",
				mcp.WithDescription("Get knowledge base analytics: total pages/words, health metrics (stale, orphans, broken links, empty, no frontmatter), link coverage stats, and recently updated pages."),
				mcp.WithString("scope", mcp.Description("Optional path prefix to scope results, e.g. students/")),
				mcp.WithNumber("stale_threshold", mcp.Description("Days to consider a page stale (default 30)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleAnalytics(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_memory_report",
				mcp.WithDescription("Report episodic memory coverage: lists markdown files classified as episodic and whether any page cites them under merged-from (central/semantic consolidation). Use before or after merge jobs to find episodes not yet folded into concept pages."),
				mcp.WithString("episodes_prefix", mcp.Description("Override path prefix for episodic files (default from [memory] episodes_path_prefix or episodes/)")),
				mcp.WithNumber("limit", mcp.Description("Maximum episodic_files and unmerged entries to return. Omit or set 0 for all entries.")),
				mcp.WithNumber("offset", mcp.Description("Number of episodic_files and unmerged entries to skip before returning results.")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleMemoryReport(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_suggestions",
				mcp.WithDescription("Find semantically similar pages that aren't already linked to the given page. Useful for discovering connections and suggesting new wiki-links."),
				mcp.WithString("path", pathOpts...),
				mcp.WithNumber("limit", mcp.Description("Max suggestions (default 10)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleSuggestions(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_embeddings",
				mcp.WithDescription("Get pre-computed vector embeddings for a page. Returns chunk texts and their embedding vectors."),
				mcp.WithString("path", pathOpts...),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleEmbeddings(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_graph_analytics",
				mcp.WithDescription("Get link graph analytics: PageRank scores, connected components, orphan pages, hub detection, topic clusters (groups of connected pages with keywords), and bridge pages (high betweenness centrality connecting clusters). Use this for the big-picture map of the knowledge graph."),
				mcp.WithNumber("limit", mcp.Description("Max top pages to return (default 20)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleGraphAnalytics(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_graph_centrality",
				mcp.WithDescription("Get PageRank and betweenness centrality scores for all pages. Returns pages ranked by PageRank with both centrality measures, in/out degree. Use this to find the most important and most connective pages."),
				mcp.WithNumber("limit", mcp.Description("Max pages to return (default all)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleGraphCentrality(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_graph_communities",
				mcp.WithDescription("Detect community clusters in the wiki-link graph using the Louvain algorithm. Returns groups of topically related pages. Use this to understand the natural topic structure of the knowledge base."),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleGraphCommunities(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_graph_path",
				mcp.WithDescription("Find the shortest path between two pages in the wiki-link graph. Returns the sequence of pages from source to target. Use this to understand how knowledge connects."),
				mcp.WithString("from", mcp.Required(), mcp.Description("Source page path")),
				mcp.WithString("to", mcp.Required(), mcp.Description("Target page path")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleGraphPath(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_peek",
				mcp.WithDescription("Quick glance at a file — returns title, frontmatter, first paragraph snippet, outbound wiki links, inbound backlinks, heading outline, and word count. Use this to decide if a page is worth reading fully. Costs ~200 tokens vs reading the whole file."),
				mcp.WithString("path", pathOpts...),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handlePeek(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_section",
				mcp.WithDescription("Read a single heading section from a file. Specify either a heading text (fuzzy match) or a section index (0-based). Returns only that section's content — much cheaper than reading the whole file. Use after kiwi_peek tells you which heading is relevant."),
				mcp.WithString("path", pathOpts...),
				mcp.WithString("heading", mcp.Description("Heading text to find (case-insensitive partial match)")),
				mcp.WithNumber("index", mcp.Description("Section index (0-based)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleSection(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_graph_walk",
				mcp.WithDescription("One-hop knowledge graph traversal from a page. Returns outbound wiki links, inbound backlinks, sibling pages (same directory or shared tags), and the page's hub score. Use this to explore connections."),
				mcp.WithString("path", pathOpts...),
				mcp.WithBoolean("include_siblings", mcp.Description("Include directory siblings and tag siblings (default true). Set false for faster response when you only need links.")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleGraphWalk(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_velocity",
				mcp.WithDescription("Change velocity analytics from git history: hot spots, cold spots, burst detection, authorship patterns."),
				mcp.WithString("period", mcp.Description("Time period like 30d, 7d, 90d (default 30d)")),
				mcp.WithNumber("limit", mcp.Description("Max results per category (default 20)")),
				mcp.WithString("path_prefix", mcp.Description("Scope to a subdirectory")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleVelocity(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_timeline",
				mcp.WithDescription("Activity timeline from git history: recent changes across all files with timestamps, authors, and change types (write/delete). Returns a feed of recent activity sorted by time."),
				mcp.WithNumber("limit", mcp.Description("Max events to return (default 50, max 500)")),
				mcp.WithNumber("offset", mcp.Description("Offset for pagination (default 0)")),
				mcp.WithString("actor", mcp.Description("Filter by actor/author name")),
				mcp.WithString("type", mcp.Description("Filter by event type: write or delete")),
				mcp.WithString("path_prefix", mcp.Description("Filter by path prefix")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleTimeline(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_context",
				mcp.WithDescription("Get the knowledge base's schema, agent playbook, current index, and rules in one call. Call this first when connecting to understand structure, conventions, and user-defined rules."),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleContext(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_health_check",
				mcp.WithDescription("Get health information for a specific page: word count, link count, backlink count, days since update, quality score, and any issues (stale, orphan, broken links)."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Path to the page to check, e.g. students/priya-sharma.md")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleHealthCheck(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_eval",
				mcp.WithDescription("Evaluate retrieval quality: send queries with expected paths, get Hit Rate, MRR, and Precision@5 for both FTS and semantic search."),
				mcp.WithArray("queries", mcp.Required(), mcp.Description("Array of {question, expected_paths} evaluation queries"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"question":       map[string]any{"type": "string"},
							"expected_paths": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
						},
						"required": []string{"question", "expected_paths"},
					}),
				),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleEval(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_eligible",
				mcp.WithDescription("Find tasks eligible for work: unclaimed, unblocked, status=todo. Returns ranked by priority. Convenience wrapper over DQL."),
				mcp.WithNumber("limit", mcp.Description("Max results, default 10")),
				mcp.WithString("path_prefix", mcp.Description("Scope to subdirectory, e.g. tasks/")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleEligible(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_claim",
				mcp.WithDescription("Claim a task for exclusive work. Returns 409 if already claimed by another agent. Use lease_duration to set how long the claim lasts (default 30m)."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Path to task file")),
				mcp.WithString("actor", mcp.Required(), mcp.Description("Agent identity for claim ownership — pass your unique session ID or name")),
				mcp.WithString("lease_duration", mcp.Description("Lease duration (default 30m), e.g. 15m, 1h")),
				mcp.WithDestructiveHintAnnotation(false),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleClaim(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_task_create",
				mcp.WithDescription("Create a task page with standard frontmatter (workflow: tasks, state: backlog). Optionally claim it for the calling agent."),
				mcp.WithString("title", mcp.Required(), mcp.Description("Task title")),
				mcp.WithString("description", mcp.Description("Task body markdown")),
				mcp.WithString("assignee", mcp.Description("Owner identifier")),
				mcp.WithNumber("priority", mcp.Description("Priority 1-5 (default 3)")),
				mcp.WithArray("blocked_by", mcp.Description("Paths of blocking tasks"), mcp.WithStringItems()),
				mcp.WithArray("labels", mcp.Description("Label strings"), mcp.WithStringItems()),
				mcp.WithString("parent", mcp.Description("Parent task path")),
				mcp.WithArray("artifacts", mcp.Description("Related artifact paths"), mcp.WithStringItems()),
				mcp.WithBoolean("claim", mcp.Description("Claim the task after creation (default false)")),
				mcp.WithString("actor", mcp.Description("Writer/claim identity (default mcp-agent)")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleTaskCreate(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_task_progress",
				mcp.WithDescription("Append a timestamped progress note under ## Progress on a task page. See docs/TASKS.md for the convention."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Task page path")),
				mcp.WithString("message", mcp.Required(), mcp.Description("Progress update text")),
				mcp.WithString("agent", mcp.Description("Agent name in the progress heading")),
				mcp.WithString("actor", mcp.Description("Git commit actor (default mcp-agent)")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleTaskProgress(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_cite",
				mcp.WithDescription("Fetch bibliographic metadata for a DOI or arXiv ID and create a literature note at papers/{bibtex_key}.md with structured frontmatter."),
				mcp.WithString("identifier", mcp.Description("DOI or arXiv ID (e.g. 10.1234/example or 2301.12345)")),
				mcp.WithString("doi", mcp.Description("Explicit DOI when not using identifier")),
				mcp.WithString("arxiv_id", mcp.Description("Explicit arXiv ID when not using identifier")),
				mcp.WithString("actor", mcp.Description("Git commit actor (default mcp-agent)")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleCite(b, nil),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_release",
				mcp.WithDescription("Release a previously claimed task so other agents can work on it."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Path to task file")),
				mcp.WithString("actor", mcp.Required(), mcp.Description("Agent identity for claim ownership — must match the actor used when claiming")),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleRelease(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_create",
				mcp.WithDescription("Create a new draft space for isolated writing. Returns a draft_id. Writes to the draft are invisible to main until merged. Use this when you want to batch changes and review them before committing."),
				mcp.WithString("actor", mcp.Description("Who is creating the draft — defaults to mcp-agent")),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleDraftCreate(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_list",
				mcp.WithDescription("List all active draft spaces."),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleDraftList(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_write",
				mcp.WithDescription("Write a file to a draft space. The file is written to the draft's isolated worktree — main is not affected."),
				mcp.WithString("draft_id", mcp.Required(), mcp.Description("Draft ID returned by kiwi_draft_create")),
				mcp.WithString("path", mcp.Required(), mcp.Description("Relative file path"), mcp.MaxLength(500)),
				mcp.WithString("content", mcp.Required(), mcp.Description("File content")),
				mcp.WithString("actor", mcp.Description("Who is writing — defaults to mcp-agent")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleDraftWrite(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_read",
				mcp.WithDescription("Read a file from a draft space."),
				mcp.WithString("draft_id", mcp.Required(), mcp.Description("Draft ID")),
				mcp.WithString("path", mcp.Required(), mcp.Description("Relative file path"), mcp.MaxLength(500)),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleDraftRead(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_diff",
				mcp.WithDescription("Show what changed in a draft vs main. Returns a unified diff."),
				mcp.WithString("draft_id", mcp.Required(), mcp.Description("Draft ID")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleDraftDiff(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_merge",
				mcp.WithDescription("Merge a draft into main. Fast-forward only — if main has diverged, returns an error."),
				mcp.WithString("draft_id", mcp.Required(), mcp.Description("Draft ID")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleDraftMerge(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_draft_discard",
				mcp.WithDescription("Discard a draft and all its changes. Removes the worktree and branch."),
				mcp.WithString("draft_id", mcp.Required(), mcp.Description("Draft ID")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleDraftDiscard(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_lint",
				mcp.WithDescription("Validate markdown content or a file for structural issues (tables, fences, frontmatter, headings, mermaid). Returns a list of issues with line numbers. Call after kiwi_write to verify quality, or pass raw content to check before writing."),
				mcp.WithString("path", mcp.Description("Path to an existing file to lint")),
				mcp.WithString("content", mcp.Description("Raw markdown content to lint (alternative to path)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleLint(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_clip",
				mcp.WithDescription("Clip a web page into the knowledge base as a markdown page with extracted article content"),
				mcp.WithString("url", mcp.Required(), mcp.Description("URL to clip")),
				mcp.WithString("title", mcp.Description("Override title")),
				mcp.WithArray("tags", mcp.Description("Tags to apply"), mcp.WithStringItems()),
				mcp.WithString("folder", mcp.Description("Target folder (default clips/)")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleClip(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_canvas_list",
				mcp.WithDescription("List all canvas files (.canvas.json) in the knowledge base. Canvases are visual graphs of nodes and edges."),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleCanvasList(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_canvas_read",
				mcp.WithDescription("Read a canvas file and return its JSON structure (nodes and edges)."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Path to the canvas file, must end with .canvas.json"), mcp.MaxLength(500)),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleCanvasRead(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_canvas_write",
				mcp.WithDescription("Write a canvas file. Content must be a JSON object with nodes and edges arrays."),
				mcp.WithString("path", mcp.Required(), mcp.Description("Path to the canvas file, must end with .canvas.json"), mcp.MaxLength(500)),
				mcp.WithString("content", mcp.Required(), mcp.Description("JSON string with nodes and edges arrays")),
				mcp.WithString("actor", mcp.Description("Who is writing — defaults to mcp-agent")),
				mcp.WithDestructiveHintAnnotation(true),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleCanvasWrite(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_versions",
				mcp.WithDescription("List git version history for a file. Returns commit hashes, dates, authors, and messages. Use this to inspect page history and see who changed what."),
				mcp.WithString("path", pathOpts...),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleVersions(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_claims_list",
				mcp.WithDescription("List all currently active task claims. Shows which pages are claimed by which agents and when claims expire."),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleClaimsList(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_feed",
				mcp.WithDescription("Get the JSON feed of recently updated pages. Returns title, URL, date, and summary for each entry. Useful for seeing what changed recently in a structured format."),
				mcp.WithNumber("limit", mcp.Description("Max entries (default 20)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleFeed(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_workflow_list",
				mcp.WithDescription("List all workflow definitions. Workflows define state machines for pages (e.g. draft→review→published)."),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleWorkflowList(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_workflow_get",
				mcp.WithDescription("Get a specific workflow definition by name. Returns states, transitions, and terminal states."),
				mcp.WithString("name", mcp.Required(), mcp.Description("Workflow name")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleWorkflowGet(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_workflow_save",
				mcp.WithDescription("Save or update a workflow definition. Validates states and transitions before saving."),
				mcp.WithString("name", mcp.Required(), mcp.Description("Workflow name")),
				mcp.WithArray("states", mcp.Required(), mcp.Description("Array of {name, color, terminal} state definitions"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name":     map[string]any{"type": "string"},
							"color":    map[string]any{"type": "string"},
							"terminal": map[string]any{"type": "boolean"},
						},
						"required": []string{"name"},
					}),
				),
				mcp.WithArray("transitions", mcp.Required(), mcp.Description("Array of {from, to, required_role} transition definitions"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"from":          map[string]any{"type": "string"},
							"to":            map[string]any{"type": "string"},
							"required_role": map[string]any{"type": "string"},
						},
						"required": []string{"from", "to"},
					}),
				),
				mcp.WithDestructiveHintAnnotation(false),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleWorkflowSave(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_workflow_advance",
				mcp.WithDescription("Advance a page's workflow state. Validates the transition is allowed by the workflow definition, then updates the page's frontmatter 'state' field."),
				mcp.WithString("path", pathOpts...),
				mcp.WithString("target_state", mcp.Required(), mcp.Description("State to transition to")),
				mcp.WithString("actor", mcp.Description("Who is advancing — defaults to mcp-agent")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleWorkflowAdvance(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_workflow_board",
				mcp.WithDescription("Get a Kanban board view: pages grouped by their workflow state. Use this to see all pages in each state of a workflow."),
				mcp.WithString("name", mcp.Required(), mcp.Description("Workflow name")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleWorkflowBoard(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_views_list",
				mcp.WithDescription("List all saved view definitions (bases/views) in the knowledge base"),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleViewsList(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_views_get",
				mcp.WithDescription("Get a specific view definition by name"),
				mcp.WithString("name", mcp.Required(), mcp.Description("View name")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleViewsGet(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_views_save",
				mcp.WithDescription("Save or update a view definition (base/view) with query, layout, columns, filters, sort, and grouping"),
				mcp.WithString("name", mcp.Required(), mcp.Description("View name")),
				mcp.WithString("query", mcp.Required(), mcp.Description("DQL query for the view")),
				mcp.WithString("layout", mcp.Description("Layout type: table, list, calendar, kanban")),
				mcp.WithString("group_by", mcp.Description("Field to group by")),
				mcp.WithArray("columns", mcp.Description("Column definitions: array of {property, label, formula, summary}"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"property": map[string]any{"type": "string"},
							"label":    map[string]any{"type": "string"},
							"formula":  map[string]any{"type": "string"},
							"summary":  map[string]any{"type": "string"},
						},
						"required": []string{"property"},
					}),
				),
				mcp.WithArray("filters", mcp.Description("Filter definitions: array of {field, operator, value}"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"field":    map[string]any{"type": "string"},
							"operator": map[string]any{"type": "string"},
							"value":    map[string]any{},
						},
						"required": []string{"field", "operator", "value"},
					}),
				),
				mcp.WithArray("sort", mcp.Description("Sort definitions: array of {field, order}"),
					mcp.Items(map[string]any{
						"type": "object",
						"properties": map[string]any{
							"field": map[string]any{"type": "string"},
							"order": map[string]any{"type": "string"},
						},
						"required": []string{"field", "order"},
					}),
				),
				mcp.WithDestructiveHintAnnotation(false),
				mcp.WithIdempotentHintAnnotation(true),
			),
			Handler: handleViewsSave(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_views_delete",
				mcp.WithDescription("Delete a saved view definition by name"),
				mcp.WithString("name", mcp.Required(), mcp.Description("View name to delete")),
				mcp.WithDestructiveHintAnnotation(true),
			),
			Handler: handleViewsDelete(b),
		},
		server.ServerTool{
			Tool: mcp.NewTool("kiwi_views_execute",
				mcp.WithDescription("Execute a saved view query and return results"),
				mcp.WithString("name", mcp.Required(), mcp.Description("View name to execute")),
				mcp.WithNumber("limit", mcp.Description("Max results (default 50)")),
				mcp.WithNumber("offset", mcp.Description("Offset for pagination (default 0)")),
				mcp.WithReadOnlyHintAnnotation(true),
				mcp.WithDestructiveHintAnnotation(false),
			),
			Handler: handleViewsExecute(b),
		},
	)
}

func registerResources(s *server.MCPServer, b Backend, opts Options) {
	var schemaMu sync.Mutex
	var schemaText string
	var schemaLoaded bool

	s.AddResource(
		mcp.NewResource("kiwi://schema", "Knowledge Base Schema",
			mcp.WithResourceDescription("The knowledge base schema — instructions for how to maintain the wiki (ingest, query, lint patterns)"),
			mcp.WithMIMEType("text/markdown"),
		),
		func(ctx context.Context, _ mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			schemaMu.Lock()
			if !schemaLoaded {
				schemaText = loadSchema(opts, b, ctx)
				if schemaText != "" {
					schemaLoaded = true
				}
			}
			text := schemaText
			schemaMu.Unlock()

			if text == "" {
				return nil, fmt.Errorf("no SCHEMA.md found")
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      "kiwi://schema",
					MIMEType: "text/markdown",
					Text:     text,
				},
			}, nil
		},
	)

	s.AddResourceTemplate(
		mcp.NewResourceTemplate("kiwi://file/{path}", "Knowledge File",
			mcp.WithTemplateDescription("Read any file from the knowledge base by path"),
			mcp.WithTemplateMIMEType("text/markdown"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			path := strings.TrimPrefix(req.Params.URI, "kiwi://file/")
			resolved, err := resolveMCPPath(path, mcpPathReadOnly)
			if err != nil {
				return nil, err
			}
			path = resolved.Path
			content, _, err := b.ReadFile(ctx, path)
			if err != nil {
				if isNotFound(err) {
					return nil, fmt.Errorf("file not found at %s", path)
				}
				return nil, fmt.Errorf("failed to read %s: %w", path, err)
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      req.Params.URI,
					MIMEType: "text/markdown",
					Text:     content,
				},
			}, nil
		},
	)

	s.AddResourceTemplate(
		mcp.NewResourceTemplate("kiwi://tree/{path}", "Knowledge Tree",
			mcp.WithTemplateDescription("List files and folders under a given path"),
			mcp.WithTemplateMIMEType("text/plain"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			path := strings.TrimPrefix(req.Params.URI, "kiwi://tree/")
			if strings.TrimSpace(path) != "" {
				resolved, err := resolveMCPPath(path, mcpPathReadOnly)
				if err != nil {
					return nil, err
				}
				path = resolved.Path
			}
			text, err := treeText(ctx, b, path, 3, "")
			if err != nil {
				return nil, err
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      req.Params.URI,
					MIMEType: "text/plain",
					Text:     text,
				},
			}, nil
		},
	)
}

func loadSchema(opts Options, b Backend, ctx context.Context) string {
	if opts.Root != "" {
		data, err := os.ReadFile(filepath.Join(opts.Root, "SCHEMA.md"))
		if err != nil {
			return ""
		}
		return string(data)
	}
	content, _, err := b.ReadFile(ctx, "SCHEMA.md")
	if err != nil {
		return ""
	}
	return content
}

func handleRead(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		content, etag, err := b.ReadFile(ctx, path)
		if err != nil {
			if isNotFound(err) {
				return mcp.NewToolResultError(fmt.Sprintf("File not found at %s. Use kiwi_tree to see available files.", path)), nil
			}
			return mcp.NewToolResultError(fmt.Sprintf("Failed to read %s: %v", path, err)), nil
		}
		if ifNotEtag, _ := args["if_not_etag"].(string); ifNotEtag != "" && ifNotEtag == etag {
			return mcp.NewToolResultText(fmt.Sprintf("File not modified (etag: %s). Content unchanged since your last read.", etag)), nil
		}
		if metadataOnly, _ := args["metadata_only"].(bool); metadataOnly {
			fm := extractFrontmatterFromContent(content)
			fmJSON, _ := json.Marshal(fm)
			return mcp.NewToolResultText(fmt.Sprintf("[ETag: %s]\n\n%s", etag, string(fmJSON))), nil
		}
		if resolveLinks, _ := args["resolve_links"].(bool); resolveLinks {
			content = b.ResolveWikiLinks(ctx, content)
		}
		result := content
		if etag != "" {
			result = fmt.Sprintf("[ETag: %s]\n\n%s", etag, content)
		}
		return mcp.NewToolResultText(result), nil
	}
}

func handleWrite(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		content, _ := args["content"].(string)
		actor, _ := args["actor"].(string)
		provenance, _ := args["provenance"].(string)
		if content == "" {
			return mcp.NewToolResultError("content is required"), nil
		}
		if actor == "" {
			actor = "mcp-agent"
		}
		etag, err := b.WriteFile(ctx, path, content, actor, provenance)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Failed to write %s: %v", path, err)), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Written %s (ETag: %s)", path, etag)), nil
	}
}

type scopedSearchBackend interface {
	SearchScoped(ctx context.Context, query string, limit, offset int, pathPrefix, scope string) ([]SearchResult, error)
}

type scopedSemanticBackend interface {
	SearchSemanticScoped(ctx context.Context, query string, limit int, scope string) ([]SearchResult, error)
}

func handleSearch(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		query, _ := args["query"].(string)
		if query == "" {
			return mcp.NewToolResultError("query is required"), nil
		}
		limit := intArg(args, "limit", 20)
		if limit > 50 {
			limit = 50
		}
		offset := intArg(args, "offset", 0)
		prefix, err := optionalReadOnlyPathArg(args, "path_prefix")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		scope, _ := args["scope"].(string)
		recencyWeight, err := floatArg(args, "recency_weight", 0)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		var results []SearchResult
		if scope != "" {
			sb, ok := b.(scopedSearchBackend)
			if !ok {
				return mcp.NewToolResultError("scope search is not supported by this backend"), nil
			}
			results, err = sb.SearchScoped(ctx, query, limit+1, offset, prefix, scope)
		} else if recencyWeight > 0 {
			recencyBackend, ok := b.(recencySearchBackend)
			if !ok {
				return mcp.NewToolResultError("recency_weight is not supported by this backend"), nil
			}
			results, err = recencyBackend.SearchWithRecency(ctx, query, limit+1, offset, prefix, recencyWeight)
		} else {
			results, err = b.Search(ctx, query, limit+1, offset, prefix)
		}
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Search failed: %v", err)), nil
		}
		if len(results) == 0 {
			if prefix != "" {
				return mcp.NewToolResultText(fmt.Sprintf("No results found in %s.", prefix)), nil
			}
			return mcp.NewToolResultText("No results found."), nil
		}

		hasMore := len(results) > limit
		if hasMore {
			results = results[:limit]
		}

		var sb strings.Builder
		for i, r := range results {
			fmt.Fprintf(&sb, "%d. %s (score: %.2f)\n", i+1+offset, r.Path, r.Score)
			if r.Snippet != "" {
				fmt.Fprintf(&sb, "   %s\n", r.Snippet)
			}
			sb.WriteString("\n")
		}
		if hasMore {
			fmt.Fprintf(&sb, "Showing %d-%d. Use offset=%d to see more.\n", offset+1, offset+limit, offset+limit)
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleTree(b Backend, opts Options) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := optionalReadOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		if path == "" {
			path = "/"
		}
		depth := intArg(args, "depth", 3)

		var publicURL string
		if incl, _ := args["include_permalinks"].(bool); incl {
			publicURL = b.PublicURL()
		}

		text, err := treeText(ctx, b, path, depth, publicURL)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Failed to list tree: %v", err)), nil
		}
		if text == "" {
			text = "(empty)"
		}
		return mcp.NewToolResultText(text), nil
	}
}

func treeText(ctx context.Context, b Backend, path string, depth int, publicURL string) (string, error) {
	tree, err := b.Tree(ctx, path)
	if err != nil {
		return "", err
	}
	return formatTreeJSON(tree, depth, publicURL), nil
}

type treeNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"isDir"`
	Size     int64      `json:"size"`
	Children []treeNode `json:"children"`
}

func formatTreeJSON(data json.RawMessage, depth int, publicURL string) string {
	var root struct {
		Children []treeNode `json:"children"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return fmt.Sprintf("(error parsing tree: %v)", err)
	}
	var sb strings.Builder
	writeTreeNodes(&sb, root.Children, "", depth, publicURL)
	return sb.String()
}

func writeTreeNodes(sb *strings.Builder, nodes []treeNode, prefix string, depth int, publicURL string) {
	for _, n := range nodes {
		if n.IsDir {
			sb.WriteString(prefix + n.Name + "/\n")
			if depth > 0 {
				writeTreeNodes(sb, n.Children, prefix+"  ", depth-1, publicURL)
			}
		} else {
			line := fmt.Sprintf("%s%s (%s)", prefix, n.Name, formatSize(n.Size))
			if publicURL != "" && n.Path != "" {
				line += "  " + config.Permalink(publicURL, n.Path)
			}
			sb.WriteString(line + "\n")
		}
	}
}

func handleQueryMeta(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()

		var filters []string
		if raw, ok := args["filters"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if s, ok := item.(string); ok {
						filters = append(filters, s)
					}
				}
			case []string:
				filters = v
			}
		}

		var orFilters []string
		if raw, ok := args["or"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if s, ok := item.(string); ok {
						orFilters = append(orFilters, s)
					}
				}
			case []string:
				orFilters = v
			}
		}

		var paths []string
		if raw, ok := args["paths"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if s, ok := item.(string); ok {
						paths = append(paths, s)
					}
				}
			case []string:
				paths = v
			}
		}

		sortField, _ := args["sort"].(string)
		order, _ := args["order"].(string)
		limit := intArg(args, "limit", 20)
		offset := intArg(args, "offset", 0)

		results, err := b.QueryMetaOr(ctx, filters, orFilters, sortField, order, limit+1, offset, paths...)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Query failed: %v", err)), nil
		}
		if len(results) == 0 {
			return mcp.NewToolResultText("No matching files found."), nil
		}

		hasMore := len(results) > limit
		if hasMore {
			results = results[:limit]
		}

		var sb strings.Builder
		for _, r := range results {
			fmt.Fprintf(&sb, "- %s\n", r.Path)
			if len(r.Frontmatter) > 0 {
				var fm map[string]any
				if json.Unmarshal(r.Frontmatter, &fm) == nil {
					keys := make([]string, 0, len(fm))
					for k := range fm {
						keys = append(keys, k)
					}
					sort.Strings(keys)
					for _, k := range keys {
						fmt.Fprintf(&sb, "  %s: %v\n", k, fm[k])
					}
				}
			}
		}
		if hasMore {
			fmt.Fprintf(&sb, "\nShowing %d-%d. Use offset=%d to see more.\n", offset+1, offset+limit, offset+limit)
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleViewRefresh(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		changed, err := b.ViewRefresh(ctx, path)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("View refresh failed: %v", err)), nil
		}
		if changed {
			return mcp.NewToolResultText(fmt.Sprintf("Regenerated view %s", path)), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("View %s is already up to date", path)), nil
	}
}

func handleQuery(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		query, _ := args["query"].(string)
		if query == "" {
			return mcp.NewToolResultError("query is required"), nil
		}
		format, _ := args["format"].(string)
		if format == "" {
			format = "table"
		}
		limit := intArg(args, "limit", 20)

		result, err := b.QueryDQL(ctx, query, limit, 0)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Query failed: %v", err)), nil
		}

		dvResult := &dataview.QueryResult{
			Columns: result.Columns,
			Rows:    result.Rows,
			Total:   result.Total,
			HasMore: result.HasMore,
		}
		for _, g := range result.Groups {
			dvResult.Groups = append(dvResult.Groups, dataview.GroupResult{Key: g.Key, Count: g.Count})
		}
		rendered := dataview.Render(dvResult, format)
		return mcp.NewToolResultText(rendered), nil
	}
}

func handleAggregate(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		groupBy, _ := args["group_by"].(string)
		if groupBy == "" {
			return mcp.NewToolResultError("group_by is required"), nil
		}
		calc, _ := args["calculate"].(string)
		where, _ := args["where"].(string)
		pathPrefix, err := optionalReadOnlyPathArg(args, "path_prefix")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		results, err := b.Aggregate(ctx, groupBy, calc, where, pathPrefix)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Aggregate failed: %v", err)), nil
		}
		if len(results) == 0 {
			return mcp.NewToolResultText("No results."), nil
		}

		var sb strings.Builder
		// Sort keys for deterministic output
		keys := make([]string, 0, len(results))
		for k := range results {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			vals := results[k]
			fmt.Fprintf(&sb, "%s:", k)
			vkeys := make([]string, 0, len(vals))
			for vk := range vals {
				vkeys = append(vkeys, vk)
			}
			sort.Strings(vkeys)
			for _, vk := range vkeys {
				fmt.Fprintf(&sb, " %s=%v", vk, vals[vk])
			}
			sb.WriteString("\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleMemoryReport(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		prefix, _ := args["episodes_prefix"].(string)
		limit, err := optionalNonNegativeIntArg(args, "limit")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		offset, err := optionalNonNegativeIntArg(args, "offset")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		raw, err := b.MemoryReport(ctx, prefix, limit, offset)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Memory report failed: %v", err)), nil
		}

		var rep memory.Report
		if err := json.Unmarshal(raw, &rep); err != nil {
			return mcp.NewToolResultText(string(raw)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Episodic files:           %d\n", rep.EpisodicCount)
		fmt.Fprintf(&sb, "merged-from references:   %d\n", rep.MergedFromRefs)
		fmt.Fprintf(&sb, "Unmerged (no merged-from): %d\n", rep.TotalUnmerged)
		rep.WriteHealthMetrics(&sb)
		if limit > 0 || offset > 0 {
			fmt.Fprintf(&sb, "Showing unmerged:          %d (offset %d)\n", len(rep.Unmerged), offset)
		}
		for _, u := range rep.Unmerged {
			fmt.Fprintf(&sb, "  - %s", u.Path)
			if u.EpisodeID != "" {
				fmt.Fprintf(&sb, "  episode_id=%s", u.EpisodeID)
			}
			sb.WriteString("\n")
		}
		for _, w := range rep.Warnings {
			fmt.Fprintf(&sb, "warning: %s\n", w)
		}
		if len(rep.Unmerged) == 0 {
			sb.WriteString("All episodic files are referenced by at least one merged-from list.\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func optionalNonNegativeIntArg(args map[string]any, name string) (int, error) {
	raw, ok := args[name]
	if !ok || raw == nil {
		return 0, nil
	}
	switch v := raw.(type) {
	case float64:
		if v < 0 || v != float64(int(v)) {
			return 0, fmt.Errorf("%s must be a non-negative integer", name)
		}
		return int(v), nil
	case int:
		if v < 0 {
			return 0, fmt.Errorf("%s must be a non-negative integer", name)
		}
		return v, nil
	default:
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
}

func handleAnalytics(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		scope, err := optionalReadOnlyPathArg(args, "scope")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		staleThreshold := intArg(args, "stale_threshold", 30)

		raw, err := b.Analytics(ctx, scope, staleThreshold)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Analytics failed: %v", err)), nil
		}

		var data struct {
			TotalPages int `json:"total_pages"`
			TotalWords int `json:"total_words"`
			Health     struct {
				Stale         struct{ Count int } `json:"stale"`
				Orphans       struct{ Count int } `json:"orphans"`
				BrokenLinks   struct{ Count int } `json:"broken_links"`
				Empty         struct{ Count int } `json:"empty"`
				NoFrontmatter struct{ Count int } `json:"no_frontmatter"`
			} `json:"health"`
			Coverage struct {
				PagesWithLinks    int     `json:"pages_with_links"`
				PagesWithoutLinks int     `json:"pages_without_links"`
				AvgLinksPerPage   float64 `json:"avg_links_per_page"`
			} `json:"coverage"`
			TopUpdated []struct {
				Path      string `json:"path"`
				UpdatedAt string `json:"updated_at"`
			} `json:"top_updated"`
			Engagement struct {
				TotalViews int `json:"total_views"`
				TopViewed  []struct {
					Path  string `json:"path"`
					Count int    `json:"count"`
				} `json:"top_viewed"`
				FailedSearches []struct {
					Query      string `json:"query"`
					Count      int    `json:"count"`
					SearchType string `json:"search_type"`
				} `json:"failed_searches"`
			} `json:"engagement"`
		}
		if err := json.Unmarshal(raw, &data); err != nil {
			return mcp.NewToolResultText(string(raw)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Knowledge Base Health\n")
		fmt.Fprintf(&sb, "Total pages:     %d\n", data.TotalPages)
		fmt.Fprintf(&sb, "Total words:     %d\n", data.TotalWords)
		fmt.Fprintf(&sb, "Stale (>%dd):    %d pages\n", staleThreshold, data.Health.Stale.Count)
		fmt.Fprintf(&sb, "Orphans:         %d pages\n", data.Health.Orphans.Count)
		fmt.Fprintf(&sb, "Broken links:    %d\n", data.Health.BrokenLinks.Count)
		fmt.Fprintf(&sb, "Empty pages:     %d\n", data.Health.Empty.Count)
		fmt.Fprintf(&sb, "No frontmatter:  %d\n", data.Health.NoFrontmatter.Count)
		sb.WriteString("\nCoverage\n")
		total := data.Coverage.PagesWithLinks + data.Coverage.PagesWithoutLinks
		pct := 0.0
		if total > 0 {
			pct = float64(data.Coverage.PagesWithLinks) / float64(total) * 100
		}
		fmt.Fprintf(&sb, "Pages with links:    %d (%.1f%%)\n", data.Coverage.PagesWithLinks, pct)
		fmt.Fprintf(&sb, "Avg links/page:      %.1f\n", data.Coverage.AvgLinksPerPage)
		if len(data.TopUpdated) > 0 {
			sb.WriteString("\nRecently Updated\n")
			for _, p := range data.TopUpdated {
				fmt.Fprintf(&sb, "  %s  %s\n", p.Path, p.UpdatedAt)
			}
		}
		sb.WriteString("\nEngagement\n")
		fmt.Fprintf(&sb, "Total page views:  %d\n", data.Engagement.TotalViews)
		if len(data.Engagement.TopViewed) > 0 {
			sb.WriteString("Top viewed:\n")
			for _, v := range data.Engagement.TopViewed {
				fmt.Fprintf(&sb, "  %s  %d views\n", v.Path, v.Count)
			}
		}
		if len(data.Engagement.FailedSearches) > 0 {
			sb.WriteString("Failed searches:\n")
			for _, f := range data.Engagement.FailedSearches {
				fmt.Fprintf(&sb, "  %s  %d× (%s)\n", f.Query, f.Count, f.SearchType)
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleContext(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		schema, playbook, index, rules, err := b.Context(ctx)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Context failed: %v", err)), nil
		}

		var sb strings.Builder
		sb.WriteString("=== SCHEMA ===\n")
		if schema != "" {
			sb.WriteString(schema)
		} else {
			sb.WriteString("(no SCHEMA.md found)")
		}
		sb.WriteString("\n\n=== PLAYBOOK ===\n")
		if playbook != "" {
			sb.WriteString(playbook)
		} else {
			sb.WriteString("(no playbook found)")
		}
		sb.WriteString("\n\n=== CURRENT INDEX ===\n")
		if index != "" {
			sb.WriteString(index)
		} else {
			sb.WriteString("(no index.md found)")
		}
		sb.WriteString("\n\n=== RULES ===\n")
		if rules != "" {
			sb.WriteString(rules)
		} else {
			sb.WriteString("(no .kiwi/rules.md found)")
		}

		if ga, gaErr := b.GraphAnalytics(ctx, 3); gaErr == nil && ga != nil {
			sb.WriteString("\n\n=== GRAPH ===\n")
			fmt.Fprintf(&sb, "Pages: %d | Links: %d | Clusters: %d\n", ga.TotalNodes, ga.TotalEdges, ga.Components)
			if len(ga.TopPages) > 0 {
				hubs := make([]string, 0, len(ga.TopPages))
				for _, p := range ga.TopPages {
					hubs = append(hubs, p.Path)
				}
				fmt.Fprintf(&sb, "Hubs: %s\n", strings.Join(hubs, ", "))
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleHealthCheck(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		raw, err := b.HealthCheckPage(ctx, path)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Health check failed: %v", err)), nil
		}

		var data struct {
			Path            string   `json:"path"`
			WordCount       int      `json:"word_count"`
			LinkCount       int      `json:"link_count"`
			BacklinkCount   int      `json:"backlink_count"`
			DaysSinceUpdate float64  `json:"days_since_update"`
			QualityScore    *float64 `json:"quality_score,omitempty"`
			Issues          []string `json:"issues"`
		}
		if err := json.Unmarshal(raw, &data); err != nil {
			return mcp.NewToolResultText(string(raw)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Health: %s\n", data.Path)
		fmt.Fprintf(&sb, "  Word count:       %d\n", data.WordCount)
		fmt.Fprintf(&sb, "  Link count:       %d\n", data.LinkCount)
		fmt.Fprintf(&sb, "  Backlink count:   %d\n", data.BacklinkCount)
		fmt.Fprintf(&sb, "  Days since update: %.1f\n", data.DaysSinceUpdate)
		if data.QualityScore != nil {
			fmt.Fprintf(&sb, "  Quality score:    %.2f\n", *data.QualityScore)
		}
		if len(data.Issues) > 0 {
			sb.WriteString("  Issues:\n")
			for _, issue := range data.Issues {
				fmt.Fprintf(&sb, "    - %s\n", issue)
			}
		} else {
			sb.WriteString("  Issues: none\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleChanges(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		since, _ := args["since"].(string)
		limit := intArg(args, "limit", 50)

		result, err := b.Changes(ctx, since, limit)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Changes failed: %v", err)), nil
		}
		if len(result.Changes) == 0 {
			return mcp.NewToolResultText("No changes found."), nil
		}

		var sb strings.Builder
		for _, ch := range result.Changes {
			seq := ch.Seq
			if len(seq) > 8 {
				seq = seq[:8]
			}
			if ch.Path != "" {
				fmt.Fprintf(&sb, "%s %s %s (by %s at %s)\n", seq, ch.Action, ch.Path, ch.Actor, ch.Timestamp)
			} else {
				fmt.Fprintf(&sb, "%s %s (by %s at %s)\n", seq, ch.Action, ch.Actor, ch.Timestamp)
			}
		}
		fmt.Fprintf(&sb, "\nlast_seq: %s\n", result.LastSeq)
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleAppend(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		content, _ := args["content"].(string)
		separator, _ := args["separator"].(string)
		actor, _ := args["actor"].(string)
		if content == "" {
			return mcp.NewToolResultError("content is required"), nil
		}
		if actor == "" {
			actor = "mcp-agent"
		}
		etag, err := b.Append(ctx, path, content, separator, actor)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Append failed: %v", err)), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Appended to %s (ETag: %s)", path, etag)), nil
	}
}

func handleSearchSemantic(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		query, _ := args["query"].(string)
		if query == "" {
			return mcp.NewToolResultError("query is required"), nil
		}
		limit := intArg(args, "limit", 5)
		if limit > 50 {
			limit = 50
		}
		var threshold float64
		if v, ok := args["threshold"].(float64); ok {
			threshold = v
		}
		scope, _ := args["scope"].(string)

		var (
			results []SearchResult
			err     error
		)
		if scope != "" {
			sb, ok := b.(scopedSemanticBackend)
			if !ok {
				return mcp.NewToolResultError("scope search is not supported by this backend"), nil
			}
			results, err = sb.SearchSemanticScoped(ctx, query, limit, scope)
		} else {
			results, err = b.SearchSemantic(ctx, query, limit)
		}
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Semantic search failed: %v", err)), nil
		}
		if len(results) == 0 {
			return mcp.NewToolResultText("No results found."), nil
		}

		var sb strings.Builder
		for i, r := range results {
			if threshold > 0 && r.Score < threshold {
				continue
			}
			fmt.Fprintf(&sb, "%d. %s (score: %.3f)\n", i+1, r.Path, r.Score)
			if r.Snippet != "" {
				fmt.Fprintf(&sb, "   %s\n", r.Snippet)
			}
			sb.WriteString("\n")
		}
		if sb.Len() == 0 {
			return mcp.NewToolResultText("No results above threshold."), nil
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleRecall(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		query, _ := args["query"].(string)
		if query == "" {
			return mcp.NewToolResultError("query is required"), nil
		}
		limit := intArg(args, "limit", 10)
		if limit > 50 {
			limit = 50
		}
		prefix, err := optionalReadOnlyPathArg(args, "path_prefix")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		scope, _ := args["scope"].(string)
		boostVerified, _ := args["boost_verified"].(bool)
		k := intArg(args, "k", 0)
		var sources []string
		if raw, ok := args["sources"].([]any); ok {
			for _, item := range raw {
				if s, ok := item.(string); ok {
					sources = append(sources, s)
				}
			}
		}
		results, err := b.Recall(ctx, RecallParams{
			Query:         query,
			Limit:         limit,
			Sources:       sources,
			Scope:         scope,
			BoostVerified: boostVerified,
			K:             k,
			PathPrefix:    prefix,
		})
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Recall failed: %v", err)), nil
		}
		if len(results) == 0 {
			return mcp.NewToolResultText("No results found."), nil
		}
		var sb strings.Builder
		for i, r := range results {
			title := r.Title
			if title != "" {
				fmt.Fprintf(&sb, "%d. %s — %s (score: %.3f, sources: %s)\n", i+1, r.Path, title, r.Score, strings.Join(r.Sources, "+"))
			} else {
				fmt.Fprintf(&sb, "%d. %s (score: %.3f, sources: %s)\n", i+1, r.Path, r.Score, strings.Join(r.Sources, "+"))
			}
			if r.Snippet != "" {
				fmt.Fprintf(&sb, "   %s\n", r.Snippet)
			}
			sb.WriteString("\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleBacklinks(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		links, err := b.Backlinks(ctx, path)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Backlinks failed: %v", err)), nil
		}
		if len(links) == 0 {
			return mcp.NewToolResultText(fmt.Sprintf("No pages link to %s.", path)), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "%d pages link to %s:\n", len(links), path)
		for _, bl := range links {
			fmt.Fprintf(&sb, "  - %s (%d links)\n", bl.Path, bl.Count)
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleDelete(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		actor, _ := args["actor"].(string)
		if actor == "" {
			actor = "mcp-agent"
		}
		if err := b.DeleteFile(ctx, path, actor); err != nil {
			if isNotFound(err) {
				return mcp.NewToolResultError(fmt.Sprintf("File not found at %s. Use kiwi_tree to see available files.", path)), nil
			}
			return mcp.NewToolResultError(fmt.Sprintf("Failed to delete %s: %v", path, err)), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Deleted %s", path)), nil
	}
}

func handleRename(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		from, err := mutationPathArg(args, "from")
		if err != nil {
			return mcp.NewToolResultError("from: " + err.Error()), nil
		}
		to, err := mutationPathArg(args, "to")
		if err != nil {
			return mcp.NewToolResultError("to: " + err.Error()), nil
		}
		actor, _ := args["actor"].(string)
		if actor == "" {
			actor = "mcp-agent"
		}
		updateLinks := true
		if ul, ok := args["update_links"].(bool); ok {
			updateLinks = ul
		}
		etag, updatedLinks, err := b.RenameWithLinks(ctx, from, to, actor, updateLinks)
		if err != nil {
			if isNotFound(err) {
				return mcp.NewToolResultError(fmt.Sprintf("File not found at %s. Use kiwi_tree to see available files.", from)), nil
			}
			return mcp.NewToolResultError(fmt.Sprintf("Failed to rename %s → %s: %v", from, to, err)), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Renamed %s → %s (ETag: %s)", from, to, etag)
		if len(updatedLinks) > 0 {
			fmt.Fprintf(&sb, "\nUpdated links in %d files:", len(updatedLinks))
			for _, p := range updatedLinks {
				fmt.Fprintf(&sb, "\n  - %s", p)
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleBulkWrite(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		actor, _ := args["actor"].(string)
		provenance, _ := args["provenance"].(string)
		if actor == "" {
			actor = "mcp-agent"
		}

		var files []BulkFile
		if raw, ok := args["files"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if m, ok := item.(map[string]any); ok {
						p, _ := m["path"].(string)
						c, _ := m["content"].(string)
						if p != "" {
							argsForPath := map[string]any{"path": p}
							resolvedPath, err := mutationPathArg(argsForPath, "path")
							if err != nil {
								return mcp.NewToolResultError(err.Error()), nil
							}
							files = append(files, BulkFile{Path: resolvedPath, Content: c})
						}
					}
				}
			case []map[string]any:
				for _, m := range v {
					p, _ := m["path"].(string)
					c, _ := m["content"].(string)
					if p != "" {
						argsForPath := map[string]any{"path": p}
						resolvedPath, err := mutationPathArg(argsForPath, "path")
						if err != nil {
							return mcp.NewToolResultError(err.Error()), nil
						}
						files = append(files, BulkFile{Path: resolvedPath, Content: c})
					}
				}
			}
		}
		if len(files) == 0 {
			return mcp.NewToolResultError("files is required — array of {path, content} objects"), nil
		}

		etags, err := b.BulkWrite(ctx, files, actor, provenance)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Bulk write failed: %v", err)), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Written %d files in a single commit\n", len(files))
		for _, f := range files {
			if etag, ok := etags[f.Path]; ok {
				fmt.Fprintf(&sb, "  %s (ETag: %s)\n", f.Path, etag)
			} else {
				fmt.Fprintf(&sb, "  %s\n", f.Path)
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleImport(b Backend, opts Options) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		from, _ := args["from"].(string)
		if from == "" {
			return mcp.NewToolResultError("from is required"), nil
		}

		lb, ok := b.(*LocalBackend)
		if !ok {
			return mcp.NewToolResultError("import is only supported in local mode"), nil
		}
		if err := lb.init(); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("init: %v", err)), nil
		}

		src, err := buildMCPSource(args, from)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		defer src.Close()

		var columns []string
		if raw, ok := args["columns"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if s, ok := item.(string); ok {
						columns = append(columns, s)
					}
				}
			case []string:
				columns = v
			}
		}

		prefix, _ := args["prefix"].(string)
		dryRun, _ := args["dry_run"].(bool)
		limit := intArg(args, "limit", 0)

		importOpts := importer.Options{
			Prefix:  prefix,
			Columns: columns,
			DryRun:  dryRun,
			Limit:   limit,
			Actor:   "mcp-import",
		}

		stats, err := importer.Run(ctx, src, lb.stack.Pipeline, importOpts)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Import failed: %v", err)), nil
		}

		var sb strings.Builder
		if dryRun {
			fmt.Fprintf(&sb, "Dry run: would import %d records\n", stats.Imported)
		} else {
			fmt.Fprintf(&sb, "Imported %d records, skipped %d\n", stats.Imported, stats.Skipped)
		}
		if len(stats.Errors) > 0 {
			fmt.Fprintf(&sb, "Errors (%d):\n", len(stats.Errors))
			for _, e := range stats.Errors {
				fmt.Fprintf(&sb, "  - %s\n", e)
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleIngest(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		filePath, _ := args["file"].(string)
		if filePath == "" {
			return mcp.NewToolResultError("file is required"), nil
		}

		ext := filepath.Ext(filePath)
		if !importer.IsMarkItDownFormat(ext) {
			return mcp.NewToolResultError(fmt.Sprintf("unsupported format %q — supported: pdf, docx, pptx, xlsx, html, epub, etc.", ext)), nil
		}

		lb, ok := b.(*LocalBackend)
		if !ok {
			return mcp.NewToolResultError("ingest is only supported in local mode"), nil
		}
		if err := lb.init(); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("init: %v", err)), nil
		}

		splitMode, _ := args["split_mode"].(string)
		if splitMode == "" {
			splitMode = "single"
		}
		prefix, _ := args["prefix"].(string)
		extractKW, _ := args["extract_keywords"].(bool)
		maxKW := intArg(args, "max_keywords", 10)
		convertXRefs, _ := args["convert_crossrefs"].(bool)
		actor, _ := args["actor"].(string)

		opts := importer.IngestOptions{
			SplitMode:        splitMode,
			Prefix:           prefix,
			ExtractKeywords:  extractKW,
			MaxKeywords:      maxKW,
			ConvertCrossRefs: convertXRefs,
			Actor:            actor,
		}

		result, err := importer.Ingest(ctx, filePath, lb.stack.Pipeline, opts)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Ingest failed: %v", err)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Ingested %s (%s)\n", result.SourceFile, result.Format)
		fmt.Fprintf(&sb, "Sections: %d\n", result.TotalPages)
		fmt.Fprintf(&sb, "Output files:\n")
		for _, f := range result.OutputFiles {
			fmt.Fprintf(&sb, "  - %s\n", f)
		}
		if len(result.Keywords) > 0 {
			max := 15
			if len(result.Keywords) < max {
				max = len(result.Keywords)
			}
			fmt.Fprintf(&sb, "Top keywords: %s\n", strings.Join(result.Keywords[:max], ", "))
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func buildMCPSource(args map[string]any, from string) (importer.Source, error) {
	str := func(key string) string {
		s, _ := args[key].(string)
		return s
	}

	switch from {
	case "postgres":
		dsn := str("dsn")
		table := str("table")
		query := str("query")
		if dsn == "" {
			return nil, fmt.Errorf("dsn is required for postgres")
		}
		if table == "" && query == "" {
			return nil, fmt.Errorf("table or query is required for postgres")
		}
		return importer.NewPostgres(dsn, table, query, nil)
	case "mysql":
		dsn := str("dsn")
		table := str("table")
		query := str("query")
		if dsn == "" {
			return nil, fmt.Errorf("dsn is required for mysql")
		}
		if table == "" && query == "" {
			return nil, fmt.Errorf("table or query is required for mysql")
		}
		return importer.NewMySQL(dsn, table, query, nil)
	case "firestore":
		project := str("project")
		collection := str("collection")
		if project == "" {
			return nil, fmt.Errorf("project is required for firestore")
		}
		if collection == "" {
			return nil, fmt.Errorf("collection is required for firestore")
		}
		return importer.NewFirestore(project, collection)
	case "sqlite":
		dbPath := str("db")
		table := str("table")
		query := str("query")
		if dbPath == "" {
			return nil, fmt.Errorf("db is required for sqlite")
		}
		if table == "" && query == "" {
			return nil, fmt.Errorf("table or query is required for sqlite")
		}
		return importer.NewSQLiteSource(dbPath, table, query)
	case "mongodb":
		uri := str("uri")
		if uri == "" {
			uri = str("dsn")
		}
		database := str("database")
		collection := str("collection")
		if uri == "" {
			return nil, fmt.Errorf("uri is required for mongodb")
		}
		if database == "" {
			return nil, fmt.Errorf("database is required for mongodb")
		}
		if collection == "" {
			return nil, fmt.Errorf("collection is required for mongodb")
		}
		return importer.NewMongoDB(uri, database, collection)
	case "csv":
		filePath := str("file")
		if filePath == "" {
			return nil, fmt.Errorf("file is required for csv")
		}
		return importer.NewCSV(filePath, true)
	case "json", "jsonl":
		filePath := str("file")
		if filePath == "" {
			return nil, fmt.Errorf("file is required for json/jsonl")
		}
		return importer.NewJSON(filePath)
	case "notion":
		apiKey := os.Getenv("NOTION_API_KEY")
		databaseID := str("database_id")
		if databaseID == "" {
			return nil, fmt.Errorf("database_id is required for notion")
		}
		return importer.NewNotion(apiKey, databaseID)
	case "airtable":
		apiKey := os.Getenv("AIRTABLE_API_KEY")
		baseID := str("base_id")
		tableID := str("table_id")
		if baseID == "" {
			return nil, fmt.Errorf("base_id is required for airtable")
		}
		if tableID == "" {
			return nil, fmt.Errorf("table_id is required for airtable")
		}
		return importer.NewAirtable(apiKey, baseID, tableID)
	default:
		return nil, fmt.Errorf("unknown source type %q", from)
	}
}

func handleExport(b Backend, _ Options) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		format, _ := args["format"].(string)
		if format == "" {
			format = "jsonl"
		}
		if format != "jsonl" && format != "csv" && format != "parquet" {
			return mcp.NewToolResultError("format must be jsonl, csv, or parquet"), nil
		}

		lb, ok := b.(*LocalBackend)
		if !ok {
			return mcp.NewToolResultError("export is only supported in local mode"), nil
		}
		if err := lb.init(); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("init: %v", err)), nil
		}

		var columns []string
		if raw, ok := args["columns"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if s, ok := item.(string); ok {
						columns = append(columns, s)
					}
				}
			case []string:
				columns = v
			}
		}

		pathPrefix, err := optionalReadOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		includeContent, _ := args["include_content"].(bool)
		includeEmb, _ := args["include_embeddings"].(bool)
		limit := intArg(args, "limit", 0)

		var buf bytes.Buffer
		opts := exporter.Options{
			Format:            format,
			PathPrefix:        pathPrefix,
			Columns:           columns,
			IncludeContent:    includeContent,
			IncludeEmbeddings: includeEmb,
			Output:            &buf,
			Limit:             limit,
		}

		if format == "parquet" {
			return mcp.NewToolResultText("Parquet export is binary and cannot be returned via MCP text. Use the HTTP endpoint instead: GET /api/kiwi/export?format=parquet"), nil
		}

		count, err := exporter.Export(ctx, lb.stack.Store, lb.stack.Searcher, lb.stack.Vectors, opts)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Export failed: %v", err)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Exported %d files (%s format)\n\n", count, format)
		sb.Write(buf.Bytes())
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleExportDocument(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()

		format, _ := args["format"].(string)
		if format == "" {
			return mcp.NewToolResultError("format is required (pdf, html, slides, site)"), nil
		}

		docFormat, err := docexport.ParseFormat(format)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		lb, ok := b.(*LocalBackend)
		if !ok {
			return mcp.NewToolResultError("document export is only supported in local mode"), nil
		}
		if err := lb.init(); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("init: %v", err)), nil
		}

		path, _ := args["path"].(string)
		if path == "" {
			return mcp.NewToolResultError("path is required (file or directory to export)"), nil
		}

		theme, _ := args["theme"].(string)
		selfContained, _ := args["self_contained"].(bool)
		bibliography, _ := args["bibliography"].(string)
		cslStyle, _ := args["csl_style"].(string)
		crossref, _ := args["crossref"].(bool)
		pdfEngine, _ := args["pdf_engine"].(string)
		slideFormat, _ := args["slide_format"].(string)

		provider := docexport.NewStorageProvider(lb.stack.Store, lb.root)
		registry := docexport.NewRegistry()
		registry.Register(docexport.NewPDFExporter(provider, lb.root))
		registry.Register(docexport.NewHTMLExporter(provider, lb.root))
		registry.Register(docexport.NewSlidesExporter(provider, lb.root))
		registry.Register(docexport.NewSiteExporter(provider, lb.stack.Store, lb.root))

		opts := docexport.ExportOpts{
			Format:        docFormat,
			InputPath:     path,
			Theme:         theme,
			SelfContained: selfContained,
			Bibliography:  bibliography,
			CSLStyle:      cslStyle,
			CrossRef:      crossref,
			PDFEngine:     pdfEngine,
			SlideFormat:   slideFormat,
		}

		exportCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()

		result, err := registry.Export(exportCtx, opts)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("export failed: %v", err)), nil
		}

		// For binary formats (PDF, PPTX, ZIP), save to a temp file and return the path.
		// For text formats (HTML), return the content directly.
		switch docFormat {
		case docexport.FormatHTML:
			if len(result.Data) > 100000 {
				// Large HTML — save to temp file.
				tmpPath := filepath.Join(os.TempDir(), result.Filename)
				if werr := os.WriteFile(tmpPath, result.Data, 0644); werr != nil {
					return mcp.NewToolResultError(fmt.Sprintf("write temp: %v", werr)), nil
				}
				return mcp.NewToolResultText(fmt.Sprintf("Exported HTML document (%d bytes) saved to: %s", len(result.Data), tmpPath)), nil
			}
			return mcp.NewToolResultText(string(result.Data)), nil
		default:
			// Binary formats — always write to temp file.
			tmpPath := filepath.Join(os.TempDir(), result.Filename)
			if werr := os.WriteFile(tmpPath, result.Data, 0644); werr != nil {
				return mcp.NewToolResultError(fmt.Sprintf("write temp: %v", werr)), nil
			}
			return mcp.NewToolResultText(fmt.Sprintf("Exported %s document (%d bytes) saved to: %s\nContent-Type: %s", format, len(result.Data), tmpPath, result.ContentType)), nil
		}
	}
}

func intArg(args map[string]any, key string, def int) int {
	v, ok := args[key]
	if !ok {
		return def
	}
	var n int
	switch raw := v.(type) {
	case float64:
		n = int(raw)
	case int:
		n = raw
	case json.Number:
		if i, err := raw.Int64(); err == nil {
			n = int(i)
		} else {
			return def
		}
	default:
		return def
	}
	if n < 0 {
		return def
	}
	return n
}

func floatArg(args map[string]any, key string, def float64) (float64, error) {
	v, ok := args[key]
	if !ok {
		return def, nil
	}
	var n float64
	switch raw := v.(type) {
	case float64:
		n = raw
	case float32:
		n = float64(raw)
	case int:
		n = float64(raw)
	case int64:
		n = float64(raw)
	case json.Number:
		var err error
		n, err = raw.Float64()
		if err != nil {
			return 0, fmt.Errorf("%s must be a number", key)
		}
	default:
		return 0, fmt.Errorf("%s must be a number", key)
	}
	if n < 0 || n > 1 {
		return 0, fmt.Errorf("%s must be between 0.0 and 1.0", key)
	}
	return n, nil
}

func extractFrontmatterFromContent(content string) map[string]any {
	fm, err := markdown.Frontmatter([]byte(content))
	if err != nil || fm == nil {
		return map[string]any{}
	}
	return fm
}

func handleSuggestions(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		limit := intArg(args, "limit", 10)
		results, err := b.Suggestions(ctx, path, limit)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Suggestions failed: %v", err)), nil
		}
		if len(results) == 0 {
			return mcp.NewToolResultText("No unlinked similar pages found."), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Suggested links for %s:\n\n", path)
		for i, r := range results {
			fmt.Fprintf(&sb, "%d. %s (similarity: %.3f)\n", i+1, r.Target, r.Similarity)
			if r.Snippet != "" {
				fmt.Fprintf(&sb, "   %s\n", r.Snippet)
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleEmbeddings(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		result, err := b.Embeddings(ctx, path)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Embeddings failed: %v", err)), nil
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(data)), nil
	}
}

func handleGraphAnalytics(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		limit := intArg(args, "limit", 20)
		result, err := b.GraphAnalytics(ctx, limit)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Graph analytics failed: %v", err)), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Graph Analytics\n")
		fmt.Fprintf(&sb, "  Nodes: %d\n", result.TotalNodes)
		fmt.Fprintf(&sb, "  Edges: %d\n", result.TotalEdges)
		fmt.Fprintf(&sb, "  Components: %d\n", result.Components)
		fmt.Fprintf(&sb, "  Largest component: %d nodes\n", result.LargestComponentSize)
		fmt.Fprintf(&sb, "  Orphans: %d\n\n", len(result.Orphans))
		if len(result.TopPages) > 0 {
			sb.WriteString("Top Pages (by PageRank):\n")
			for i, p := range result.TopPages {
				fmt.Fprintf(&sb, "  %d. %s (rank: %.4f, in: %d, out: %d)\n", i+1, p.Path, p.PageRank, p.InDegree, p.OutDegree)
			}
			sb.WriteString("\n")
		}
		if len(result.Clusters) > 0 {
			sb.WriteString("Topic Clusters:\n")
			for _, c := range result.Clusters {
				fmt.Fprintf(&sb, "  Cluster %d: %d pages, hub: %s", c.ID, c.Size, c.TopPage)
				if len(c.Keywords) > 0 {
					fmt.Fprintf(&sb, " [%s]", strings.Join(c.Keywords, ", "))
				}
				sb.WriteString("\n")
			}
			sb.WriteString("\n")
		}
		if len(result.Bridges) > 0 {
			sb.WriteString("Bridge Pages:\n")
			for _, br := range result.Bridges {
				fmt.Fprintf(&sb, "  %s (betweenness: %.4f)\n", br.Path, br.Betweenness)
			}
			sb.WriteString("\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleGraphCentrality(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		limit := intArg(args, "limit", 0)
		result, err := b.GraphCentrality(ctx, limit)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Graph centrality failed: %v", err)), nil
		}
		var sb strings.Builder
		sb.WriteString("Page Centrality (PageRank + Betweenness)\n\n")
		for i, p := range result.Pages {
			fmt.Fprintf(&sb, "%d. %s\n   PageRank: %.4f  Betweenness: %.4f  In: %d  Out: %d\n",
				i+1, p.Path, p.PageRank, p.Betweenness, p.InDegree, p.OutDegree)
		}
		if len(result.Pages) == 0 {
			sb.WriteString("No pages found in the link graph.\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleGraphCommunities(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		result, err := b.GraphCommunities(ctx)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Community detection failed: %v", err)), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Communities (%d detected)\n\n", len(result.Communities))
		for _, c := range result.Communities {
			fmt.Fprintf(&sb, "Community %d (%d pages):\n", c.ID, len(c.Pages))
			for _, p := range c.Pages {
				fmt.Fprintf(&sb, "  - %s\n", p)
			}
			sb.WriteString("\n")
		}
		if len(result.Communities) == 0 {
			sb.WriteString("No communities detected.\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleGraphPath(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		from, err := readOnlyPathArg(args, "from")
		if err != nil {
			return mcp.NewToolResultError("from: " + err.Error()), nil
		}
		to, err := readOnlyPathArg(args, "to")
		if err != nil {
			return mcp.NewToolResultError("to: " + err.Error()), nil
		}
		result, err := b.GraphPath(ctx, from, to)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Path finding failed: %v", err)), nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "Shortest path from %s to %s (%d hops):\n\n", from, to, len(result.Path)-1)
		for i, p := range result.Path {
			if i > 0 {
				sb.WriteString("  → ")
			} else {
				sb.WriteString("  ")
			}
			sb.WriteString(p)
			sb.WriteString("\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handlePeek(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		path, err := readOnlyPathArg(req.GetArguments(), "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		result, err := b.Peek(ctx, path)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(data)), nil
	}
}

func handleSection(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		heading, _ := args["heading"].(string)
		index := -1
		if idx, ok := args["index"].(float64); ok {
			index = int(idx)
		}
		if heading == "" && index < 0 {
			return mcp.NewToolResultError("heading or index is required"), nil
		}
		result, err := b.Section(ctx, path, heading, index)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(data)), nil
	}
}

func handleGraphWalk(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		path, err := readOnlyPathArg(req.GetArguments(), "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		includeSiblings := true
		if v, ok := req.GetArguments()["include_siblings"].(bool); ok {
			includeSiblings = v
		}
		result, err := b.GraphWalk(ctx, path, includeSiblings)
		if err != nil {
			if isNotFound(err) {
				return mcp.NewToolResultError(fmt.Sprintf("File not found at %s.", path)), nil
			}
			return mcp.NewToolResultError(err.Error()), nil
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(data)), nil
	}
}

func handleVelocity(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		period, _ := args["period"].(string)
		if period == "" {
			period = "30d"
		}
		limit := intArg(args, "limit", 20)
		pathPrefix, err := optionalReadOnlyPathArg(args, "path_prefix")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		result, err := b.Velocity(ctx, period, limit, pathPrefix)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Velocity failed: %v", err)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Change Velocity (%s)\n", result.Period)
		fmt.Fprintf(&sb, "Total changes: %d\n\n", result.TotalChanges)

		if len(result.HotSpots) > 0 {
			sb.WriteString("Hot Spots:\n")
			for _, h := range result.HotSpots {
				fmt.Fprintf(&sb, "  %s — %d changes, %d authors, %d lines\n", h.Path, h.Changes, h.Authors, h.LinesChanged)
			}
			sb.WriteString("\n")
		}
		if len(result.Bursts) > 0 {
			sb.WriteString("Burst Activity:\n")
			for _, b := range result.Bursts {
				fmt.Fprintf(&sb, "  %s — recent: %.1f/day, avg: %.1f/day\n", b.Path, b.RecentRate, b.AvgRate)
			}
			sb.WriteString("\n")
		}
		if len(result.ColdSpots) > 0 {
			sb.WriteString("Cold Spots:\n")
			for _, c := range result.ColdSpots {
				fmt.Fprintf(&sb, "  %s — %d+ days\n", c.Path, c.DaysSinceChange)
			}
			sb.WriteString("\n")
		}
		if len(result.SingleAuthorPages) > 0 {
			fmt.Fprintf(&sb, "Single-author pages: %d\n", len(result.SingleAuthorPages))
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleTimeline(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		limit := intArg(args, "limit", 50)
		offset := intArg(args, "offset", 0)
		actor, _ := args["actor"].(string)
		eventType, _ := args["type"].(string)
		pathPrefix, err := optionalReadOnlyPathArg(args, "path_prefix")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		result, err := b.Timeline(ctx, limit, offset, actor, eventType, pathPrefix)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Timeline failed: %v", err)), nil
		}

		if len(result.Events) == 0 {
			return mcp.NewToolResultText("No events found."), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Activity Timeline (%d events, %d total)\n\n", len(result.Events), result.Total)

		for _, e := range result.Events {
			// Format timestamp to be more readable
			ts := e.Timestamp
			if t, err := time.Parse(time.RFC3339, e.Timestamp); err == nil {
				ts = t.Format("2006-01-02 15:04")
			}

			typeIcon := "✏️"
			if e.Type == "delete" {
				typeIcon = "🗑️"
			}

			fmt.Fprintf(&sb, "%s [%s] %s by %s\n", typeIcon, ts, e.Path, e.Actor)
			if e.Message != "" {
				fmt.Fprintf(&sb, "    %s\n", e.Message)
			}
		}

		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleEval(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		var queries []EvalQuery
		if raw, ok := args["queries"]; ok {
			switch v := raw.(type) {
			case []any:
				for _, item := range v {
					if m, ok := item.(map[string]any); ok {
						q := EvalQuery{}
						q.Question, _ = m["question"].(string)
						if paths, ok := m["expected_paths"].([]any); ok {
							for _, p := range paths {
								if s, ok := p.(string); ok {
									q.ExpectedPaths = append(q.ExpectedPaths, s)
								}
							}
						}
						if q.Question != "" {
							queries = append(queries, q)
						}
					}
				}
			}
		}
		if len(queries) == 0 {
			return mcp.NewToolResultError("queries is required — array of {question, expected_paths} objects"), nil
		}

		result, err := b.Eval(ctx, queries)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Eval failed: %v", err)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Retrieval Evaluation (%d queries)\n\n", len(queries))
		fmt.Fprintf(&sb, "FTS:      hit_rate=%.2f  mrr=%.2f  precision@5=%.2f\n", result.FTS.HitRate, result.FTS.MRR, result.FTS.PrecisionAtK)
		fmt.Fprintf(&sb, "Semantic: hit_rate=%.2f  mrr=%.2f  precision@5=%.2f\n\n", result.Semantic.HitRate, result.Semantic.MRR, result.Semantic.PrecisionAtK)
		for _, pq := range result.PerQuery {
			fmt.Fprintf(&sb, "Q: %s\n", pq.Question)
			fmt.Fprintf(&sb, "  FTS rank: %d, Semantic rank: %d\n", pq.FTSRank, pq.SemanticRank)
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleEligible(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		limit := 10
		if l, ok := args["limit"].(float64); ok && l > 0 {
			limit = int(l)
		}
		pathPrefix, err := optionalReadOnlyPathArg(args, "path_prefix")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		result, err := b.Eligible(ctx, limit, pathPrefix)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Eligible query failed: %v", err)), nil
		}

		if len(result.Rows) == 0 {
			return mcp.NewToolResultText("No eligible tasks found."), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Eligible tasks (%d found):\n\n", len(result.Rows))
		for i, row := range result.Rows {
			path, _ := row["_path"].(string)
			title, _ := row["title"].(string)
			priority := row["priority"]
			fmt.Fprintf(&sb, "%d. [P%v] %s — %s\n", i+1, priority, path, title)
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleClaim(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		actor, _ := args["actor"].(string)
		if actor == "" {
			return mcp.NewToolResultError("actor is required — pass your agent name to identify claim ownership"), nil
		}

		lease := 30 * time.Minute
		if d, ok := args["lease_duration"].(string); ok && d != "" {
			parsed, err := time.ParseDuration(d)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("invalid lease_duration: %v", err)), nil
			}
			lease = parsed
		}
		if lease < time.Minute {
			lease = time.Minute
		}
		if lease > 24*time.Hour {
			return mcp.NewToolResultError("lease_duration must be <= 24h"), nil
		}

		claim, err := b.Claim(ctx, path, actor, lease)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Claim failed: %v", err)), nil
		}

		data, _ := json.Marshal(claim)
		return mcp.NewToolResultText(string(data)), nil
	}
}

func handleRelease(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		actor, _ := args["actor"].(string)
		if actor == "" {
			return mcp.NewToolResultError("actor is required — pass your agent name to identify claim ownership"), nil
		}

		if err := b.Release(ctx, path, actor); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("Release failed: %v", err)), nil
		}

		return mcp.NewToolResultText(fmt.Sprintf("Released claim on %s", path)), nil
	}
}

func isNotFound(err error) bool {
	var he *httpError
	if errors.As(err, &he) {
		return he.StatusCode == 404
	}
	return errors.Is(err, os.ErrNotExist)
}

func Serve(opts Options) error {
	s, backend, err := New(opts)
	if err != nil {
		return err
	}
	defer backend.Close()

	if opts.Remote != "" {
		if err := backend.Health(context.Background()); err != nil {
			fmt.Fprintf(os.Stderr, "warning: KiwiFS server at %s is not reachable: %v\n", opts.Remote, err)
		}
	}

	if opts.HTTP {
		return serveHTTP(s, opts)
	}

	return server.ServeStdio(s)
}

func serveHTTP(s *server.MCPServer, opts Options) error {
	addr := fmt.Sprintf(":%d", opts.Port)
	authToken, err := httpAuthToken(opts)
	if err != nil {
		return err
	}
	stderr.Printf("serving MCP Streamable HTTP on http://localhost:%d/mcp", opts.Port)
	return http.ListenAndServe(addr, newHTTPHandler(s, time.Now(), authToken))
}

func httpAuthToken(opts Options) (string, error) {
	if opts.Root == "" {
		return "", nil
	}

	cfgPath := filepath.Join(opts.Root, ".kiwi", "config.toml")
	if _, err := os.Stat(cfgPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}

	cfg, err := config.Load(opts.Root)
	if err != nil {
		return "", fmt.Errorf("load MCP HTTP auth config: %w", err)
	}
	return AuthTokenFromConfig(cfg), nil
}

// AuthTokenFromConfig returns the bearer token for MCP HTTP when apikey auth is enabled.
func AuthTokenFromConfig(cfg *config.Config) string {
	if cfg == nil {
		return ""
	}
	if cfg.Auth.Type == "apikey" && cfg.Auth.APIKey != "" {
		return cfg.Auth.APIKey
	}
	return ""
}

// StreamableHTTPHandler returns an http.Handler for MCP Streamable HTTP transport.
func StreamableHTTPHandler(s *server.MCPServer, authToken string) http.Handler {
	mcpHandler := server.NewStreamableHTTPServer(
		s,
		server.WithEndpointPath("/mcp"),
		server.WithStateLess(true),
	)
	return bearerAuth(authToken, mcpHandler)
}

func newHTTPHandler(s *server.MCPServer, started time.Time, authToken string) http.Handler {
	mcpHandler := StreamableHTTPHandler(s, authToken)

	mux := http.NewServeMux()
	mux.Handle("/mcp", mcpHandler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"status":"ok","transport":"http","uptime_seconds":%d}`+"\n", int(time.Since(started).Seconds()))
	})

	return mux
}

func handleLint(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		content, _ := args["content"].(string)

		var data []byte
		if content != "" {
			data = []byte(content)
		} else if path != "" {
			raw, _, err := b.ReadFile(ctx, path)
			if err != nil {
				if isNotFound(err) {
					return mcp.NewToolResultError("file not found: " + path), nil
				}
				return mcp.NewToolResultError(fmt.Sprintf("failed to read %s: %v", path, err)), nil
			}
			data = []byte(raw)
		} else {
			return mcp.NewToolResultError("provide either path or content"), nil
		}

		issues := markdown.LintMarkdown(data)
		if len(issues) == 0 {
			return mcp.NewToolResultText("No issues found"), nil
		}

		out, _ := json.MarshalIndent(issues, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleClip(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		url, _ := args["url"].(string)
		title, _ := args["title"].(string)
		folder, _ := args["folder"].(string)

		var tags []string
		if tagsRaw, ok := args["tags"].([]any); ok {
			for _, t := range tagsRaw {
				if s, ok := t.(string); ok {
					tags = append(tags, s)
				}
			}
		}

		if url == "" {
			return mcp.NewToolResultError("url is required"), nil
		}

		result, err := b.Clip(ctx, url, title, tags, folder)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("clip failed: %v", err)), nil
		}

		out, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func bearerAuth(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	expected := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(got, expected) != 1 {
			http.Error(w, "invalid API key", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleViewsList(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		views, err := b.ViewsList(ctx)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to list views: %v", err)), nil
		}
		out, _ := json.MarshalIndent(views, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleViewsGet(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		name, _ := args["name"].(string)
		if name == "" {
			return mcp.NewToolResultError("name is required"), nil
		}

		view, err := b.ViewsGet(ctx, name)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to get view: %v", err)), nil
		}
		out, _ := json.MarshalIndent(view, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleViewsSave(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		name, _ := args["name"].(string)
		query, _ := args["query"].(string)
		layout, _ := args["layout"].(string)
		groupBy, _ := args["group_by"].(string)

		if name == "" || query == "" {
			return mcp.NewToolResultError("name and query are required"), nil
		}

		view := ViewInfo{
			Name:    name,
			Query:   query,
			Layout:  layout,
			GroupBy: groupBy,
		}

		// Task 4: Parse optional columns, filters, sort
		if raw, ok := args["columns"]; ok {
			if arr, ok := raw.([]any); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						col := ViewColumn{}
						col.Property, _ = m["property"].(string)
						col.Label, _ = m["label"].(string)
						col.Formula, _ = m["formula"].(string)
						col.Summary, _ = m["summary"].(string)
						if col.Property != "" {
							view.Columns = append(view.Columns, col)
						}
					}
				}
			}
		}

		if raw, ok := args["filters"]; ok {
			if arr, ok := raw.([]any); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						f := ViewFilter{}
						f.Field, _ = m["field"].(string)
						f.Operator, _ = m["operator"].(string)
						f.Value = m["value"]
						if f.Field != "" && f.Operator != "" {
							view.Filters = append(view.Filters, f)
						}
					}
				}
			}
		}

		if raw, ok := args["sort"]; ok {
			if arr, ok := raw.([]any); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						s := ViewSort{}
						s.Field, _ = m["field"].(string)
						s.Order, _ = m["order"].(string)
						if s.Field != "" {
							view.Sort = append(view.Sort, s)
						}
					}
				}
			}
		}

		if err := b.ViewsSave(ctx, view); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to save view: %v", err)), nil
		}

		return mcp.NewToolResultText(fmt.Sprintf("View %s saved", name)), nil
	}
}

func handleViewsDelete(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		name, _ := args["name"].(string)
		if name == "" {
			return mcp.NewToolResultError("name is required"), nil
		}

		if err := b.ViewsDelete(ctx, name); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to delete view: %v", err)), nil
		}

		return mcp.NewToolResultText(fmt.Sprintf("View %s deleted", name)), nil
	}
}

func handleCanvasList(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		canvases, err := b.CanvasList(ctx)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to list canvases: %v", err)), nil
		}
		out, _ := json.MarshalIndent(map[string]any{"canvases": canvases}, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleCanvasRead(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		content, err := b.CanvasRead(ctx, path)
		if err != nil {
			if isNotFound(err) {
				return mcp.NewToolResultError(fmt.Sprintf("Canvas not found at %s", path)), nil
			}
			return mcp.NewToolResultError(fmt.Sprintf("failed to read canvas: %v", err)), nil
		}
		return mcp.NewToolResultText(content), nil
	}
}

func handleCanvasWrite(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		content, _ := args["content"].(string)
		actor, _ := args["actor"].(string)
		if content == "" {
			return mcp.NewToolResultError("content is required"), nil
		}
		if actor == "" {
			actor = "mcp-agent"
		}

		etag, err := b.CanvasWrite(ctx, path, content, actor)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to write canvas: %v", err)), nil
		}

		out, _ := json.MarshalIndent(map[string]any{"path": path, "etag": etag}, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleVersions(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := readOnlyPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		versions, err := b.Versions(ctx, path)
		if err != nil {
			if isNotFound(err) {
				return mcp.NewToolResultError(fmt.Sprintf("File not found at %s", path)), nil
			}
			return mcp.NewToolResultError(fmt.Sprintf("failed to get versions: %v", err)), nil
		}

		if len(versions) == 0 {
			return mcp.NewToolResultText(fmt.Sprintf("No version history for %s", path)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Version history for %s (%d commits):\n\n", path, len(versions))
		for i, v := range versions {
			hash := v.Hash
			if len(hash) > 8 {
				hash = hash[:8]
			}
			fmt.Fprintf(&sb, "%d. %s  %s  by %s\n", i+1, hash, v.Date, v.Author)
			if v.Message != "" {
				fmt.Fprintf(&sb, "   %s\n", v.Message)
			}
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleClaimsList(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		claims, err := b.ListClaims(ctx)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to list claims: %v", err)), nil
		}

		if len(claims) == 0 {
			return mcp.NewToolResultText("No active claims."), nil
		}

		out, _ := json.MarshalIndent(map[string]any{"claims": claims}, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleWorkflowList(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		workflows, err := b.WorkflowList(ctx)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to list workflows: %v", err)), nil
		}
		if len(workflows) == 0 {
			return mcp.NewToolResultText("No workflows defined. Create one with kiwi_workflow_save."), nil
		}
		out, _ := json.MarshalIndent(map[string]any{"workflows": workflows}, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleWorkflowGet(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		name, _ := req.GetArguments()["name"].(string)
		if name == "" {
			return mcp.NewToolResultError("name is required"), nil
		}
		w, err := b.WorkflowGet(ctx, name)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to get workflow: %v", err)), nil
		}
		out, _ := json.MarshalIndent(w, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleWorkflowSave(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		name, _ := args["name"].(string)
		if name == "" {
			return mcp.NewToolResultError("name is required"), nil
		}

		w := WorkflowDef{Name: name}

		if raw, ok := args["states"]; ok {
			if arr, ok := raw.([]any); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						s := WorkflowState{}
						s.Name, _ = m["name"].(string)
						s.Color, _ = m["color"].(string)
						s.Terminal, _ = m["terminal"].(bool)
						if s.Name != "" {
							w.States = append(w.States, s)
						}
					}
				}
			}
		}

		if raw, ok := args["transitions"]; ok {
			if arr, ok := raw.([]any); ok {
				for _, item := range arr {
					if m, ok := item.(map[string]any); ok {
						t := WorkflowTransition{}
						t.From, _ = m["from"].(string)
						t.To, _ = m["to"].(string)
						t.RequiredRole, _ = m["required_role"].(string)
						if t.From != "" && t.To != "" {
							w.Transitions = append(w.Transitions, t)
						}
					}
				}
			}
		}

		if err := b.WorkflowSave(ctx, w); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to save workflow: %v", err)), nil
		}

		return mcp.NewToolResultText(fmt.Sprintf("Workflow %s saved with %d states and %d transitions", name, len(w.States), len(w.Transitions))), nil
	}
}

func handleWorkflowAdvance(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		path, err := mutationPathArg(args, "path")
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		targetState, _ := args["target_state"].(string)
		actor, _ := args["actor"].(string)
		if targetState == "" {
			return mcp.NewToolResultError("target_state is required"), nil
		}

		result, err := b.WorkflowAdvance(ctx, path, targetState, actor)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("workflow advance failed: %v", err)), nil
		}

		out, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}

func handleWorkflowBoard(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		name, _ := req.GetArguments()["name"].(string)
		if name == "" {
			return mcp.NewToolResultError("name is required"), nil
		}

		result, err := b.WorkflowBoard(ctx, name)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("workflow board failed: %v", err)), nil
		}

		var sb strings.Builder
		fmt.Fprintf(&sb, "Kanban Board: %s\n\n", result.Workflow.Name)
		for _, state := range result.Workflow.States {
			pages := result.Board[state.Name]
			fmt.Fprintf(&sb, "=== %s (%d) ===\n", state.Name, len(pages))
			for _, p := range pages {
				path, _ := p["path"].(string)
				title, _ := p["title"].(string)
				if title != "" {
					fmt.Fprintf(&sb, "  - %s (%s)\n", path, title)
				} else {
					fmt.Fprintf(&sb, "  - %s\n", path)
				}
			}
			sb.WriteString("\n")
		}
		return mcp.NewToolResultText(sb.String()), nil
	}
}

func handleFeed(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		limit := intArg(args, "limit", 20)

		raw, err := b.Feed(ctx, limit)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("feed failed: %v", err)), nil
		}

		// Pretty-print JSON
		var pretty json.RawMessage
		if json.Unmarshal(raw, &pretty) == nil {
			indented, _ := json.MarshalIndent(pretty, "", "  ")
			return mcp.NewToolResultText(string(indented)), nil
		}
		return mcp.NewToolResultText(string(raw)), nil
	}
}

func handleViewsExecute(b Backend) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		name, _ := args["name"].(string)
		limit, _ := args["limit"].(float64)
		offset, _ := args["offset"].(float64)

		if name == "" {
			return mcp.NewToolResultError("name is required"), nil
		}

		if limit == 0 {
			limit = 50
		}

		result, err := b.ViewsExecute(ctx, name, int(limit), int(offset))
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to execute view: %v", err)), nil
		}

		out, _ := json.MarshalIndent(result, "", "  ")
		return mcp.NewToolResultText(string(out)), nil
	}
}
