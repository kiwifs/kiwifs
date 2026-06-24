package mcpserver

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/claims"
)

func sanitizePathPrefix(s string) string {
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ReplaceAll(s, `\`, "")
	s = strings.ReplaceAll(s, `'`, "")
	return s
}

type SearchResult struct {
	Path    string  `json:"path"`
	Snippet string  `json:"snippet,omitempty"`
	Score   float64 `json:"score,omitempty"`
}

type RecallResult struct {
	Path       string   `json:"path"`
	Title      string   `json:"title,omitempty"`
	Snippet    string   `json:"snippet,omitempty"`
	Score      float64  `json:"score"`
	Sources    []string `json:"sources"`
	FTSRank    int      `json:"fts_rank,omitempty"`
	VectorRank int      `json:"vector_rank,omitempty"`
	GraphRank  int      `json:"graph_rank,omitempty"`
}

type RecallParams struct {
	Query         string   `json:"query"`
	Limit         int      `json:"limit"`
	Sources       []string `json:"sources"`
	Scope         string   `json:"scope"`
	BoostVerified bool     `json:"boost_verified"`
	K             int      `json:"k"`
	PathPrefix    string   `json:"path_prefix"`
}

type MetaResult struct {
	Path        string          `json:"path"`
	Frontmatter json.RawMessage `json:"frontmatter"`
}

type Version struct {
	Hash    string `json:"hash"`
	Date    string `json:"date"`
	Author  string `json:"author"`
	Message string `json:"message"`
}

type Backlink struct {
	Path     string `json:"path"`
	Count    int    `json:"count"`
	Relation string `json:"relation,omitempty"`
}

type BulkFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

var (
	_ Backend              = (*RemoteBackend)(nil)
	_ Backend              = (*LocalBackend)(nil)
	_ recencySearchBackend = (*RemoteBackend)(nil)
	_ recencySearchBackend = (*LocalBackend)(nil)
)

// QueryResult is the response from a DQL query via the dataview engine.
type QueryResult struct {
	Columns []string         `json:"columns"`
	Rows    []map[string]any `json:"rows"`
	Total   int              `json:"total"`
	HasMore bool             `json:"has_more"`
	Groups  []GroupResult    `json:"groups,omitempty"`
}

// GroupResult mirrors dataview.GroupResult for MCP transport.
type GroupResult struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

type Change struct {
	Seq       string `json:"seq"`
	Path      string `json:"path"`
	Action    string `json:"action"`
	Actor     string `json:"actor"`
	Timestamp string `json:"timestamp"`
}

type ChangesResult struct {
	Changes []Change `json:"changes"`
	LastSeq string   `json:"last_seq"`
}

// PeekResult is a lightweight summary of a file.
type PeekResult struct {
	Path        string          `json:"path"`
	Title       string          `json:"title"`
	Frontmatter json.RawMessage `json:"frontmatter,omitempty"`
	Snippet     string          `json:"snippet"`
	LinksOut    []string        `json:"links_out"`
	LinksIn     []string        `json:"links_in"`
	WordCount   int             `json:"word_count"`
	Headings    []string        `json:"headings"`
}

// SectionResult is a single heading section extracted from a markdown file.
type SectionResult struct {
	Path      string `json:"path"`
	Heading   string `json:"heading"`
	Level     int    `json:"level"`
	Content   string `json:"content"`
	LineStart int    `json:"line_start"`
	LineEnd   int    `json:"line_end"`
}

// GraphWalkResult is one-hop graph traversal from a page.
type GraphWalkResult struct {
	Path      string     `json:"path"`
	LinksOut  []string   `json:"links_out"`
	LinksIn   []string   `json:"links_in"`
	Siblings  []Neighbor `json:"siblings"`
	HubScore  float64    `json:"hub_score"`
	InDegree  int        `json:"in_degree"`
	OutDegree int        `json:"out_degree"`
}

// Neighbor is a related page discovered via graph walk.
type Neighbor struct {
	Path      string `json:"path"`
	Relation  string `json:"relation"`
	SharedTag string `json:"shared_tag,omitempty"`
}

// Cluster is a connected component in the link graph.
type Cluster struct {
	ID       int      `json:"id"`
	Size     int      `json:"size"`
	Pages    []string `json:"pages"`
	TopPage  string   `json:"top_page"`
	Keywords []string `json:"keywords"`
}

// Bridge is a page with high betweenness centrality.
type Bridge struct {
	Path        string  `json:"path"`
	Betweenness float64 `json:"betweenness"`
}

type Backend interface {
	Changes(ctx context.Context, since string, limit int) (*ChangesResult, error)
	ReadFile(ctx context.Context, path string) (content string, etag string, err error)
	WriteFile(ctx context.Context, path, content, actor string, provenance string) (etag string, err error)
	DeleteFile(ctx context.Context, path, actor string) error
	Tree(ctx context.Context, path string) (json.RawMessage, error)
	Search(ctx context.Context, query string, limit, offset int, pathPrefix string) ([]SearchResult, error)
	SearchSemantic(ctx context.Context, query string, limit int) ([]SearchResult, error)
	Recall(ctx context.Context, params RecallParams) ([]RecallResult, error)
	QueryMeta(ctx context.Context, filters []string, sort, order string, limit, offset int) ([]MetaResult, error)
	QueryMetaOr(ctx context.Context, andFilters, orFilters []string, sort, order string, limit, offset int, paths ...string) ([]MetaResult, error)
	QueryDQL(ctx context.Context, dql string, limit, offset int) (*QueryResult, error)
	ViewRefresh(ctx context.Context, path string) (changed bool, err error)
	Versions(ctx context.Context, path string) ([]Version, error)
	BulkWrite(ctx context.Context, files []BulkFile, actor, provenance string) (map[string]string, error)
	Aggregate(ctx context.Context, groupBy, calc, where, pathPrefix string) (map[string]map[string]any, error)
	Analytics(ctx context.Context, scope string, staleThreshold int) (json.RawMessage, error)
	MemoryReport(ctx context.Context, episodesPrefix string, limit, offset int) (json.RawMessage, error)
	HealthCheckPage(ctx context.Context, path string) (json.RawMessage, error)
	Append(ctx context.Context, path, content, separator, actor string) (string, error)
	Rename(ctx context.Context, from, to, actor string) (string, error)
	RenameWithLinks(ctx context.Context, from, to, actor string, updateLinks bool) (string, []string, error)
	Backlinks(ctx context.Context, path string) ([]Backlink, error)
	ResolveWikiLinks(ctx context.Context, content string) string
	Peek(ctx context.Context, path string) (*PeekResult, error)
	Section(ctx context.Context, path, heading string, index int) (*SectionResult, error)
	GraphWalk(ctx context.Context, path string, includeSiblings bool) (*GraphWalkResult, error)
	Context(ctx context.Context) (schema, playbook, index, rules string, err error)
	Suggestions(ctx context.Context, path string, limit int) ([]SuggestionResult, error)
	Embeddings(ctx context.Context, path string) (*EmbeddingsResult, error)
	GraphAnalytics(ctx context.Context, limit int) (*GraphAnalyticsResult, error)
	GraphCentrality(ctx context.Context, limit int) (*GraphCentralityResult, error)
	GraphCommunities(ctx context.Context) (*GraphCommunitiesResult, error)
	GraphPath(ctx context.Context, from, to string) (*GraphPathResult, error)
	Velocity(ctx context.Context, period string, limit int, pathPrefix string) (*VelocityResult, error)
	Timeline(ctx context.Context, limit, offset int, actor, eventType, pathPrefix string) (*TimelineResult, error)
	Eval(ctx context.Context, queries []EvalQuery) (*EvalResult, error)
	Eligible(ctx context.Context, limit int, pathPrefix string) (*QueryResult, error)
	Claim(ctx context.Context, path, claimedBy string, leaseDuration time.Duration) (*claims.Claim, error)
	Release(ctx context.Context, path, claimedBy string) error
	ListClaims(ctx context.Context) ([]claims.Claim, error)
	DraftCreate(ctx context.Context, actor string) (*DraftInfo, error)
	DraftList(ctx context.Context) ([]DraftInfo, error)
	DraftRead(ctx context.Context, draftID, path string) (string, string, error)
	DraftWrite(ctx context.Context, draftID, path, content, actor string) (string, error)
	DraftDiff(ctx context.Context, draftID string) (string, error)
	DraftMerge(ctx context.Context, draftID string) error
	DraftDiscard(ctx context.Context, draftID string) error
	Clip(ctx context.Context, url, title string, tags []string, folder string) (*ClipResultMCP, error)
	PublicURL() string
	Health(ctx context.Context) error
	Close() error
	ViewsList(ctx context.Context) ([]ViewInfo, error)
	ViewsGet(ctx context.Context, name string) (*ViewInfo, error)
	ViewsSave(ctx context.Context, view ViewInfo) error
	ViewsDelete(ctx context.Context, name string) error
	ViewsExecute(ctx context.Context, name string, limit, offset int) (*QueryResult, error)
	CanvasList(ctx context.Context) ([]string, error)
	CanvasRead(ctx context.Context, path string) (string, error)
	CanvasWrite(ctx context.Context, path, content, actor string) (string, error)
	Feed(ctx context.Context, limit int) (json.RawMessage, error)
	WorkflowList(ctx context.Context) ([]WorkflowDef, error)
	WorkflowGet(ctx context.Context, name string) (*WorkflowDef, error)
	WorkflowSave(ctx context.Context, w WorkflowDef) error
	WorkflowAdvance(ctx context.Context, path, targetState, actor string) (*WorkflowAdvanceResult, error)
	WorkflowBoard(ctx context.Context, workflowName string) (*WorkflowBoardResult, error)
}

type recencySearchBackend interface {
	SearchWithRecency(ctx context.Context, query string, limit, offset int, pathPrefix string, recencyWeight float64) ([]SearchResult, error)
}

type DraftInfo struct {
	ID        string `json:"id"`
	Branch    string `json:"branch"`
	Actor     string `json:"actor"`
	CreatedAt string `json:"created_at"`
}

type SuggestionResult struct {
	Target     string  `json:"target"`
	Similarity float64 `json:"similarity"`
	Snippet    string  `json:"snippet"`
}

type EmbeddingsResult struct {
	Path       string           `json:"path"`
	Model      string           `json:"model"`
	Dimensions int              `json:"dimensions"`
	Chunks     []EmbeddingChunk `json:"chunks"`
}

type EmbeddingChunk struct {
	ChunkIdx int       `json:"chunk_idx"`
	Text     string    `json:"text"`
	Vector   []float32 `json:"vector"`
}

type GraphAnalyticsResult struct {
	TotalNodes           int             `json:"total_nodes"`
	TotalEdges           int             `json:"total_edges"`
	Components           int             `json:"components"`
	TopPages             []PageRankEntry `json:"top_pages"`
	Orphans              []string        `json:"orphans"`
	LargestComponentSize int             `json:"largest_component_size"`
	Clusters             []Cluster       `json:"clusters"`
	Bridges              []Bridge        `json:"bridges"`
}

type PageRankEntry struct {
	Path      string  `json:"path"`
	PageRank  float64 `json:"pagerank"`
	InDegree  int     `json:"in_degree"`
	OutDegree int     `json:"out_degree"`
}

// GraphCentralityResult holds PageRank and betweenness centrality data.
type GraphCentralityResult struct {
	Pages []CentralityEntry `json:"pages"`
}

// CentralityEntry holds centrality scores for a single page.
type CentralityEntry struct {
	Path        string  `json:"path"`
	PageRank    float64 `json:"pagerank"`
	Betweenness float64 `json:"betweenness"`
	InDegree    int     `json:"in_degree"`
	OutDegree   int     `json:"out_degree"`
}

// GraphCommunitiesResult holds community detection results.
type GraphCommunitiesResult struct {
	Communities []CommunityGroup `json:"communities"`
}

// CommunityGroup is a cluster of related pages.
type CommunityGroup struct {
	ID    int      `json:"id"`
	Pages []string `json:"pages"`
}

// GraphPathResult holds the shortest path between two pages.
type GraphPathResult struct {
	Path []string `json:"path"`
}

type VelocityResult struct {
	Period            string          `json:"period"`
	TotalChanges      int             `json:"total_changes"`
	HotSpots          []HotSpotEntry  `json:"hot_spots"`
	ColdSpots         []ColdSpotEntry `json:"cold_spots"`
	Bursts            []BurstEntry    `json:"bursts"`
	SingleAuthorPages []string        `json:"single_author_pages"`
}

type HotSpotEntry struct {
	Path         string `json:"path"`
	Changes      int    `json:"changes"`
	Authors      int    `json:"authors"`
	LinesChanged int    `json:"lines_changed"`
}

type ColdSpotEntry struct {
	Path            string `json:"path"`
	DaysSinceChange int    `json:"days_since_change"`
}

type BurstEntry struct {
	Path       string  `json:"path"`
	RecentRate float64 `json:"recent_rate"`
	AvgRate    float64 `json:"avg_rate"`
}

type EvalQuery struct {
	Question      string   `json:"question"`
	ExpectedPaths []string `json:"expected_paths"`
}

type EvalResult struct {
	FTS      EvalMetrics       `json:"fts"`
	Semantic EvalMetrics       `json:"semantic"`
	PerQuery []EvalQueryResult `json:"per_query"`
}

type EvalMetrics struct {
	HitRate      float64 `json:"hit_rate"`
	MRR          float64 `json:"mrr"`
	PrecisionAtK float64 `json:"precision_at_5"`
}

type EvalQueryResult struct {
	Question     string   `json:"question"`
	FTSRank      int      `json:"fts_rank"`
	SemanticRank int      `json:"semantic_rank"`
	FTSHits      []string `json:"fts_hits"`
	SemanticHits []string `json:"semantic_hits"`
}

type ClipResultMCP struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
}

type ViewInfo struct {
	Name    string       `json:"name"`
	Query   string       `json:"query"`
	Layout  string       `json:"layout"`
	Columns []ViewColumn `json:"columns,omitempty"`
	Filters []ViewFilter `json:"filters,omitempty"`
	Sort    []ViewSort   `json:"sort,omitempty"`
	GroupBy string       `json:"group_by,omitempty"`
}

type ViewColumn struct {
	Property string `json:"property"`
	Label    string `json:"label,omitempty"`
	Formula  string `json:"formula,omitempty"`
	Summary  string `json:"summary,omitempty"`
}

type ViewFilter struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}

type ViewSort struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

// WorkflowDef is the MCP-transport representation of a workflow definition.
type WorkflowDef struct {
	Name        string               `json:"name"`
	States      []WorkflowState      `json:"states"`
	Transitions []WorkflowTransition `json:"transitions"`
}

type WorkflowState struct {
	Name     string `json:"name"`
	Color    string `json:"color,omitempty"`
	Terminal bool   `json:"terminal,omitempty"`
}

type WorkflowTransition struct {
	From         string `json:"from"`
	To           string `json:"to"`
	RequiredRole string `json:"required_role,omitempty"`
}

type WorkflowAdvanceResult struct {
	Path      string `json:"path"`
	FromState string `json:"from_state"`
	ToState   string `json:"to_state"`
	ETag      string `json:"etag"`
}

type WorkflowBoardResult struct {
	Workflow WorkflowDef                 `json:"workflow"`
	Board    map[string][]map[string]any `json:"board"`
}

type TimelineResult struct {
	Events []TimelineEvent `json:"events"`
	Total  int             `json:"total"`
}

type TimelineEvent struct {
	Type      string `json:"type"`
	Path      string `json:"path"`
	Actor     string `json:"actor"`
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
}
