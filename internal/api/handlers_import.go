package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/importer"
	"github.com/labstack/echo/v4"
)

type importRequest struct {
	From        string          `json:"from"`
	DSN         string          `json:"dsn"`
	URI         string          `json:"uri"`
	DB          string          `json:"db"`
	File        string          `json:"file"`
	Path        string          `json:"path"` // Directory path (markdown, obsidian, confluence)
	Table       string          `json:"table"`
	Collection  string          `json:"collection"`
	Database    string          `json:"database"`
	DatabaseID  string          `json:"database_id"`
	BaseID      string          `json:"base_id"`
	TableID     string          `json:"table_id"`
	Project     string          `json:"project"`
	Query       string          `json:"query"`
	Columns        []string               `json:"columns"`
	FieldMappings  []importer.FieldMapping `json:"field_mappings,omitempty"`
	IDColumn       string                 `json:"id_column"`
	Prefix      string          `json:"prefix"`
	DryRun      bool            `json:"dry_run"`
	Limit       int             `json:"limit"`
	Credentials json.RawMessage `json:"credentials,omitempty" swaggertype:"object"` // Service account JSON (Firestore)
	APIKey      string          `json:"api_key,omitempty"`                          // API key (Notion, Airtable)

	// Airbyte-specific fields
	AirbyteConfig map[string]any `json:"airbyte_config,omitempty"` // Raw Airbyte connector config
	AirbyteImage  string         `json:"airbyte_image,omitempty"`  // Custom Docker image override
	Streams       []string       `json:"streams,omitempty"`        // Specific streams to sync
	Via           string         `json:"via,omitempty"`            // "airbyte" | "airbyte-cloud" | "builtin" (auto if empty)
}

type importResponse struct {
	Imported int      `json:"imported"`
	Skipped  int      `json:"skipped"`
	Archived int      `json:"archived,omitempty"`
	Errors   []string `json:"errors"`
}

type toggleSyncRequest struct {
	Enabled  *bool  `json:"enabled,omitempty"`
	Interval string `json:"interval,omitempty"`
}

type runConnectionRequest struct {
	Credentials json.RawMessage `json:"credentials,omitempty" swaggertype:"object"`
	APIKey      string          `json:"api_key,omitempty"`
}

type airbyteCloudCheckRequest struct {
	From   string         `json:"from"`
	Config map[string]any `json:"config"`
}

type airbyteCloudDiscoverRequest struct {
	SourceID string `json:"source_id"`
}

type airbyteCloudSyncRequest struct {
	ConnectionID string `json:"connection_id"`
}

// Import godoc
//
//	@Summary		Run an import job
//	@Description	Runs an import job from a specified data source (builtin connectors like Postgres, SQLite, Notion, Markdown, etc., or Airbyte connectors).
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		importRequest	true	"Import request details"
//	@Success		200		{object}	importResponse
//	@Failure		400		{object}	map[string]string	"Invalid request body or source configuration details"
//	@Failure		500		{object}	map[string]string	"Internal server or import pipeline error"
//	@Router			/api/kiwi/import [post]
func (h *Handlers) Import(c echo.Context) error {
	var req importRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.From == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from is required")
	}

	src, err := buildAPISource(req)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	defer src.Close()

	var columns []string
	if len(req.Columns) > 0 {
		columns = req.Columns
	}

	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = "api-import"
	}

	opts := importer.Options{
		Prefix:        req.Prefix,
		IDColumn:      req.IDColumn,
		Columns:       columns,
		FieldMappings: req.FieldMappings,
		DryRun:        req.DryRun,
		Limit:    req.Limit,
		Actor:    actor,
		FullSync: !req.DryRun && req.Limit == 0 && importer.IsSyncable(req.From),
	}

	ctx := c.Request().Context()
	stats, err := importer.Run(ctx, src, h.pipe, opts)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("import failed: %v", err))
	}

	// Auto-save connection metadata on successful import (no credentials stored)
	if h.connStore != nil {
		// Upsert: find existing connection with same source+prefix to avoid duplicates
		existing := h.connStore.FindBySourceAndPrefix(req.From, opts.Prefix)
		connMeta := existing
		if connMeta == nil {
			connMeta = &importer.ConnectionMeta{}
		}
		connMeta.From = req.From
		connMeta.Name = req.From + ":" + coalesce(req.Collection, req.Table, req.DatabaseID, req.TableID)
		connMeta.Project = req.Project
		connMeta.Table = req.Table
		connMeta.Collection = req.Collection
		connMeta.Database = req.Database
		connMeta.DatabaseID = req.DatabaseID
		connMeta.BaseID = req.BaseID
		connMeta.TableID = req.TableID
		connMeta.DSN = req.DSN
		connMeta.URI = req.URI
		connMeta.Prefix = opts.Prefix
		connMeta.IDColumn = req.IDColumn
		connMeta.Columns = req.Columns
		connMeta.Via = req.Via
		connMeta.AirbyteImage = req.AirbyteImage
		connMeta.Streams = req.Streams
		connMeta.LastStats = &importer.ConnectionStats{Imported: stats.Imported, Skipped: stats.Skipped, Archived: stats.Archived, Errors: stats.Errors}
		connMeta.LastRun = time.Now().UTC().Format(time.RFC3339)

		// Auto-enable sync for syncable sources (default: every hour)
		if importer.IsSyncable(req.From) && !connMeta.SyncEnabled {
			connMeta.SyncEnabled = true
			connMeta.SyncInterval = "1h"
			connMeta.SyncStatus = "idle"
			connMeta.NextSync = time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339)
		}
		_ = h.connStore.Save(connMeta)
	}

	return c.JSON(http.StatusOK, importResponse{
		Imported: stats.Imported,
		Skipped:  stats.Skipped,
		Archived: stats.Archived,
		Errors:   stats.Errors,
	})
}

func coalesce(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}

// buildSourceFromConnection creates an importer Source from a saved connection.
// Used by the sync scheduler — note: only works for connections that have stored
// their airbyte config or use native connectors that don't require credentials.
func buildSourceFromConnection(conn *importer.ConnectionMeta) (importer.Source, error) {
	req := importRequest{
		From:         conn.From,
		DSN:          conn.DSN,
		URI:          conn.URI,
		Table:        conn.Table,
		Collection:   conn.Collection,
		Database:     conn.Database,
		DatabaseID:   conn.DatabaseID,
		BaseID:       conn.BaseID,
		TableID:      conn.TableID,
		Project:      conn.Project,
		Prefix:       conn.Prefix,
		IDColumn:     conn.IDColumn,
		Columns:      conn.Columns,
		Via:          conn.Via,
		AirbyteImage: conn.AirbyteImage,
		Streams:      conn.Streams,
	}
	return buildAPISource(req)
}

func buildAPISource(req importRequest) (importer.Source, error) {
	// If explicit via=airbyte or airbyte_config provided, use Airbyte directly
	if req.Via == "airbyte" || req.AirbyteConfig != nil {
		if importer.DockerAvailable() {
			return buildAirbyteSource(req)
		}
		// No Docker — try Airbyte Cloud if config is present
		return buildAirbyteCloudSource(req)
	}

	// For builtin sources, always use native implementation
	if importer.IsBuiltinSource(req.From) {
		return buildBuiltinSource(req)
	}

	// For network sources: prefer Airbyte Docker, then Cloud, then legacy
	if req.Via != "builtin" {
		if importer.DockerAvailable() {
			cfg := req.AirbyteConfig
			if cfg == nil {
				cfg = legacyToAirbyteConfig(req)
			}
			if cfg != nil {
				return buildAirbyteSource(req)
			}
		}
		// No Docker but have Cloud key?
		src, err := buildAirbyteCloudSource(req)
		if err == nil {
			return src, nil
		}
	}

	// Fallback to legacy built-in connectors
	return buildBuiltinSource(req)
}

func buildAirbyteCloudSource(req importRequest) (importer.Source, error) {
	apiKey := os.Getenv("AIRBYTE_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("neither Docker nor Airbyte Cloud API key available")
	}
	config := req.AirbyteConfig
	if config == nil {
		config = legacyToAirbyteConfig(req)
	}
	if config == nil {
		return nil, fmt.Errorf("airbyte_config is required")
	}
	workspaceID := os.Getenv("AIRBYTE_WORKSPACE_ID")
	return importer.NewAirbyteCloudSource(importer.AirbyteCloudSourceOpts{
		APIKey:      apiKey,
		SourceType:  req.From,
		Config:      config,
		Streams:     req.Streams,
		WorkspaceID: workspaceID,
		SourceName:  req.From,
	})
}

func buildAirbyteSource(req importRequest) (importer.Source, error) {
	image := req.AirbyteImage
	if image == "" {
		image = importer.LookupAirbyteImage(req.From)
	}
	if image == "" {
		return nil, fmt.Errorf("no Airbyte connector image found for %q", req.From)
	}

	config := req.AirbyteConfig
	if config == nil {
		// Try to build Airbyte config from legacy request fields
		config = legacyToAirbyteConfig(req)
	}
	if config == nil {
		return nil, fmt.Errorf("airbyte_config is required for Airbyte-based import")
	}

	return importer.NewAirbyteSource(importer.AirbyteSourceOpts{
		Image:      image,
		Config:     config,
		Streams:    req.Streams,
		SourceName: req.From,
	})
}

// legacyToAirbyteConfig translates traditional import request fields into
// Airbyte connector config format for backward compatibility.
func legacyToAirbyteConfig(req importRequest) map[string]any {
	switch req.From {
	case "postgres":
		if req.DSN == "" {
			return nil
		}
		return map[string]any{"host": req.DSN, "port": 5432, "database": req.Database}
	case "notion":
		if req.APIKey == "" {
			return nil
		}
		return map[string]any{"credentials": map[string]any{"auth_type": "token", "token": req.APIKey}}
	case "airtable":
		if req.APIKey == "" {
			return nil
		}
		return map[string]any{"credentials": map[string]any{"auth_method": "api_key", "api_key": req.APIKey}}
	case "firestore":
		if len(req.Credentials) == 0 {
			return nil
		}
		return map[string]any{"project_id": req.Project, "service_account_key_json": string(req.Credentials)}
	default:
		return nil
	}
}

func buildBuiltinSource(req importRequest) (importer.Source, error) {
	switch req.From {
	case "postgres":
		if req.DSN == "" {
			return nil, fmt.Errorf("dsn is required for postgres")
		}
		if req.Table == "" && req.Query == "" {
			return nil, fmt.Errorf("table or query is required for postgres")
		}
		return importer.NewPostgres(req.DSN, req.Table, req.Query, req.Columns)
	case "mysql":
		if req.DSN == "" {
			return nil, fmt.Errorf("dsn is required for mysql")
		}
		if req.Table == "" && req.Query == "" {
			return nil, fmt.Errorf("table or query is required for mysql")
		}
		return importer.NewMySQL(req.DSN, req.Table, req.Query, req.Columns)
	case "firestore":
		if req.Project == "" {
			return nil, fmt.Errorf("project is required for firestore")
		}
		if req.Collection == "" {
			return nil, fmt.Errorf("collection is required for firestore")
		}
		if len(req.Credentials) > 0 {
			return importer.NewFirestoreWithCredentials(req.Project, req.Collection, []byte(req.Credentials))
		}
		return importer.NewFirestore(req.Project, req.Collection)
	case "sqlite":
		if req.DB == "" {
			return nil, fmt.Errorf("db is required for sqlite")
		}
		if req.Table == "" && req.Query == "" {
			return nil, fmt.Errorf("table or query is required for sqlite")
		}
		return importer.NewSQLiteSource(req.DB, req.Table, req.Query)
	case "mongodb":
		uri := req.URI
		if uri == "" {
			uri = req.DSN
		}
		if uri == "" {
			return nil, fmt.Errorf("uri is required for mongodb")
		}
		if req.Collection == "" {
			return nil, fmt.Errorf("collection is required for mongodb")
		}
		db := req.Database
		if db == "" {
			return nil, fmt.Errorf("database is required for mongodb")
		}
		return importer.NewMongoDB(uri, db, req.Collection)
	case "csv":
		if req.File == "" {
			return nil, fmt.Errorf("file is required for csv")
		}
		return importer.NewCSV(req.File, true)
	case "json", "jsonl":
		if req.File == "" {
			return nil, fmt.Errorf("file is required for json/jsonl")
		}
		return importer.NewJSON(req.File)
	case "notion":
		apiKey := req.APIKey
		if apiKey == "" {
			apiKey = os.Getenv("NOTION_API_KEY")
		}
		if req.DatabaseID == "" {
			return nil, fmt.Errorf("database_id is required for notion")
		}
		return importer.NewNotion(apiKey, req.DatabaseID)
	case "airtable":
		apiKey := req.APIKey
		if apiKey == "" {
			apiKey = os.Getenv("AIRTABLE_API_KEY")
		}
		if req.BaseID == "" {
			return nil, fmt.Errorf("base_id is required for airtable")
		}
		if req.TableID == "" {
			return nil, fmt.Errorf("table_id is required for airtable")
		}
		return importer.NewAirtable(apiKey, req.BaseID, req.TableID)
	case "markdown":
		if req.Path == "" {
			return nil, fmt.Errorf("path is required for markdown")
		}
		return importer.NewMarkdown(req.Path, importer.MarkdownOpts{})
	default:
		// Try Airbyte as final fallback for unknown source types
		if importer.DockerAvailable() {
			image := importer.LookupAirbyteImage(req.From)
			if image != "" && req.AirbyteConfig != nil {
				return importer.NewAirbyteSource(importer.AirbyteSourceOpts{
					Image:      image,
					Config:     req.AirbyteConfig,
					Streams:    req.Streams,
					SourceName: req.From,
				})
			}
		}
		supported := strings.Join([]string{"markdown", "postgres", "mysql", "firestore", "sqlite", "mongodb", "csv", "json", "jsonl", "notion", "airtable"}, ", ")
		return nil, fmt.Errorf("unknown source type %q (supported: %s). For Airbyte connectors, provide airbyte_config", req.From, supported)
	}
}

// --- Browse & Preview endpoints (Phase 2) ---

type browseRequest struct {
	From        string          `json:"from"`
	DSN         string          `json:"dsn"`
	URI         string          `json:"uri"`
	DB          string          `json:"db"`
	Project     string          `json:"project"`
	Database    string          `json:"database"`
	Credentials json.RawMessage `json:"credentials,omitempty" swaggertype:"object"`
	APIKey      string          `json:"api_key,omitempty"`
}

type browseResponse struct {
	Tables []importer.BrowseTable `json:"tables"`
}

// ImportBrowse godoc
//
//	@Summary		Browse data source tables/collections
//	@Description	Lists available tables or collections for a given database data source (Firestore, Postgres, MySQL, MongoDB).
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		browseRequest	true	"Browse request details"
//	@Success		200		{object}	browseResponse
//	@Failure		400		{object}	map[string]string	"Invalid request body or connection error"
//	@Router			/api/kiwi/import/browse [post]
func (h *Handlers) ImportBrowse(c echo.Context) error {
	var req browseRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.From == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from is required")
	}

	ctx := c.Request().Context()
	tables, err := browseSource(ctx, req)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusOK, browseResponse{Tables: tables})
}

func browseSource(ctx context.Context, req browseRequest) ([]importer.BrowseTable, error) {
	switch req.From {
	case "firestore":
		return browseFirestore(ctx, req)
	case "postgres":
		return browsePostgres(ctx, req)
	case "mysql":
		return browseMySQL(ctx, req)
	case "mongodb":
		return browseMongoDB(ctx, req)
	default:
		return nil, fmt.Errorf("browse not supported for source type %q", req.From)
	}
}

func browseFirestore(ctx context.Context, req browseRequest) ([]importer.BrowseTable, error) {
	if req.Project == "" {
		return nil, fmt.Errorf("project is required for firestore")
	}

	var src *importer.FirestoreSource
	var err error
	if len(req.Credentials) > 0 {
		src, err = importer.NewFirestoreWithCredentials(req.Project, "__browse__", []byte(req.Credentials))
	} else {
		src, err = importer.NewFirestore(req.Project, "__browse__")
	}
	if err != nil {
		return nil, err
	}
	defer src.Close()

	names, err := src.BrowseCollections(ctx)
	if err != nil {
		return nil, err
	}
	tables := make([]importer.BrowseTable, len(names))
	for i, name := range names {
		tables[i] = importer.BrowseTable{Name: name}
	}
	return tables, nil
}

func browsePostgres(ctx context.Context, req browseRequest) ([]importer.BrowseTable, error) {
	if req.DSN == "" {
		return nil, fmt.Errorf("dsn is required for postgres")
	}
	src, err := importer.NewPostgres(req.DSN, "", "SELECT 1", nil)
	if err != nil {
		return nil, err
	}
	defer src.Close()

	return importer.BrowsePostgresTables(ctx, src)
}

func browseMySQL(ctx context.Context, req browseRequest) ([]importer.BrowseTable, error) {
	if req.DSN == "" {
		return nil, fmt.Errorf("dsn is required for mysql")
	}
	src, err := importer.NewMySQL(req.DSN, "", "SELECT 1", nil)
	if err != nil {
		return nil, err
	}
	defer src.Close()

	return importer.BrowseMySQLTables(ctx, src)
}

func browseMongoDB(ctx context.Context, req browseRequest) ([]importer.BrowseTable, error) {
	uri := req.URI
	if uri == "" {
		uri = req.DSN
	}
	if uri == "" {
		return nil, fmt.Errorf("uri is required for mongodb")
	}
	db := req.Database
	if db == "" {
		return nil, fmt.Errorf("database is required for mongodb")
	}
	src, err := importer.NewMongoDB(uri, db, "__browse__")
	if err != nil {
		return nil, err
	}
	defer src.Close()

	return importer.BrowseMongoCollections(ctx, src)
}

// --- Preview ---

type previewRequest struct {
	From        string          `json:"from"`
	DSN         string          `json:"dsn"`
	URI         string          `json:"uri"`
	DB          string          `json:"db"`
	Table       string          `json:"table"`
	Collection  string          `json:"collection"`
	Database    string          `json:"database"`
	DatabaseID  string          `json:"database_id"`
	BaseID      string          `json:"base_id"`
	TableID     string          `json:"table_id"`
	Project     string          `json:"project"`
	Credentials json.RawMessage `json:"credentials,omitempty" swaggertype:"object"`
	APIKey      string          `json:"api_key,omitempty"`
	Prefix      string          `json:"prefix,omitempty"`
	IDColumn    string          `json:"id_column,omitempty"`
	Columns     []string        `json:"columns,omitempty"`
	FieldMappings []importer.FieldMapping `json:"field_mappings,omitempty"`
	Limit       int             `json:"limit"`

	AirbyteConfig map[string]any `json:"airbyte_config,omitempty"`
	AirbyteImage  string         `json:"airbyte_image,omitempty"`
	Streams       []string       `json:"streams,omitempty"`
	Via           string         `json:"via,omitempty"`
}

type previewRecord struct {
	Path        string         `json:"path"`
	Frontmatter map[string]any `json:"frontmatter"`
	BodyPreview string         `json:"body_preview"`
}

type previewResponse struct {
	Records []previewRecord `json:"records"`
}

// ImportPreview godoc
//
//	@Summary		Preview import records
//	@Description	Fetches sample records from a source and returns rendered markdown previews of the documents.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		previewRequest	true	"Preview request details"
//	@Success		200		{object}	previewResponse
//	@Failure		400		{object}	map[string]string	"Invalid request body or source configuration details"
//	@Failure		500		{object}	map[string]string	"Internal server or preview error"
//	@Router			/api/kiwi/import/preview [post]
func (h *Handlers) ImportPreview(c echo.Context) error {
	var req previewRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.From == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from is required")
	}

	limit := req.Limit
	if limit <= 0 || limit > 20 {
		limit = 5
	}

	ir := previewToImportRequest(req)
	ir.Prefix = req.Prefix
	ir.IDColumn = req.IDColumn
	ir.Columns = req.Columns
	ir.FieldMappings = req.FieldMappings
	ir.Limit = limit

	src, err := buildAPISource(ir)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	defer src.Close()

	previews, err := streamImportPreviews(c.Request().Context(), src, limit, recordPreviewOptsFromRequest(req))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, previewResponse{Records: previews})
}

type inferFieldsResponse struct {
	Fields []importer.InferredField `json:"fields"`
}

// ImportInferFields godoc
//
//	@Summary		Infer import field types
//	@Description	Samples records from a source and returns suggested field mappings with detected types.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		previewRequest	true	"Infer-fields request (same shape as preview)"
//	@Success		200		{object}	inferFieldsResponse
//	@Failure		400		{object}	map[string]string	"Invalid request body or source configuration details"
//	@Failure		500		{object}	map[string]string	"Internal server or sampling error"
//	@Router			/api/kiwi/import/infer-fields [post]
func (h *Handlers) ImportInferFields(c echo.Context) error {
	var req previewRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.From == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from is required")
	}

	ir := previewToImportRequest(req)
	src, err := buildAPISource(ir)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	defer src.Close()

	fields, err := inferFieldsFromSource(c.Request().Context(), src)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, inferFieldsResponse{Fields: fields})
}

func previewToImportRequest(req previewRequest) importRequest {
	return importRequest{
		From:          req.From,
		DSN:           req.DSN,
		URI:           req.URI,
		DB:            req.DB,
		Table:         req.Table,
		Collection:    req.Collection,
		Database:      req.Database,
		DatabaseID:    req.DatabaseID,
		BaseID:        req.BaseID,
		TableID:       req.TableID,
		Project:       req.Project,
		Credentials:   req.Credentials,
		APIKey:        req.APIKey,
		AirbyteConfig: req.AirbyteConfig,
		AirbyteImage:  req.AirbyteImage,
		Streams:       req.Streams,
		Via:           req.Via,
	}
}

func inferFieldsFromSource(ctx context.Context, src importer.Source) ([]importer.InferredField, error) {
	rows, err := importer.SampleSourceFields(ctx, src, 100)
	if err != nil {
		return nil, err
	}
	return importer.InferMappingFields(rows), nil
}

func recordPreviewOptsFromRequest(req previewRequest) importer.RecordPreviewOpts {
	return importer.RecordPreviewOpts{
		Prefix:        req.Prefix,
		IDColumn:      req.IDColumn,
		Columns:       req.Columns,
		FieldMappings: req.FieldMappings,
	}
}

func recordPreviewOptsFromImportRequest(req importRequest) importer.RecordPreviewOpts {
	return importer.RecordPreviewOpts{
		Prefix:        req.Prefix,
		IDColumn:      req.IDColumn,
		Columns:       req.Columns,
		FieldMappings: req.FieldMappings,
	}
}

func streamImportPreviews(ctx context.Context, src importer.Source, limit int, base importer.RecordPreviewOpts) ([]previewRecord, error) {
	base.SourceName = src.Name()
	records, errs := src.Stream(ctx)

	var previews []previewRecord
	count := 0
	for rec := range records {
		if count >= limit {
			break
		}
		item := importer.BuildPreviewItem(rec, base)
		previews = append(previews, previewRecord{
			Path:        item.Path,
			Frontmatter: item.Frontmatter,
			BodyPreview: item.BodyPreview,
		})
		count++
	}
	for err := range errs {
		if err != nil && len(previews) == 0 {
			return nil, err
		}
	}
	return previews, nil
}

// --- Connection CRUD endpoints (Phase 3) ---

// ListConnections godoc
//
//	@Summary		List saved connections
//	@Description	Returns a list of all saved import connections (metadata only, no credentials stored).
//	@Tags			import
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{array}		importer.ConnectionMeta
//	@Router			/api/kiwi/import/connections [get]
func (h *Handlers) ListConnections(c echo.Context) error {
	if h.connStore == nil {
		return c.JSON(http.StatusOK, []any{})
	}
	return c.JSON(http.StatusOK, h.connStore.List())
}

// SaveConnection godoc
//
//	@Summary		Save import connection
//	@Description	Saves or updates import connection metadata (without credentials).
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			connection	body		importer.ConnectionMeta	true	"Connection metadata to save"
//	@Success		200			{object}	importer.ConnectionMeta
//	@Failure		400			{object}	map[string]string		"Invalid request body or missing 'from' field"
//	@Failure		503			{object}	map[string]string		"Connection store not available"
//	@Failure		500			{object}	map[string]string		"Internal database error"
//	@Router			/api/kiwi/import/connections [post]
func (h *Handlers) SaveConnection(c echo.Context) error {
	if h.connStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "connection store not available")
	}

	var conn importer.ConnectionMeta
	if err := c.Bind(&conn); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if conn.From == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from is required")
	}
	if conn.Name == "" {
		conn.Name = conn.From
	}

	if err := h.connStore.Save(&conn); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, conn)
}

// DeleteConnection godoc
//
//	@Summary		Delete saved connection
//	@Description	Removes a saved import connection configuration.
//	@Tags			import
//	@Security		BearerAuth
//	@Param			id	path		string	true	"Connection ID"
//	@Success		204	"No Content"
//	@Failure		404	{object}	map[string]string	"Connection not found"
//	@Failure		503	{object}	map[string]string	"Connection store not available"
//	@Router			/api/kiwi/import/connections/{id} [delete]
func (h *Handlers) DeleteConnection(c echo.Context) error {
	if h.connStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "connection store not available")
	}

	id := c.Param("id")
	if err := h.connStore.Delete(id); err != nil {
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

// ToggleSync godoc
//
//	@Summary		Toggle or update connection sync
//	@Description	Pauses or resumes auto-sync for a connection, or changes its sync interval.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			id		path		string				true	"Connection ID"
//	@Param			request	body		toggleSyncRequest	true	"Sync toggle and interval options"
//	@Success		200		{object}	importer.ConnectionMeta
//	@Failure		400		{object}	map[string]string	"Invalid request body"
//	@Failure		404		{object}	map[string]string	"Connection not found"
//	@Failure		503		{object}	map[string]string	"Connection store not available"
//	@Failure		500		{object}	map[string]string	"Internal save error"
//	@Router			/api/kiwi/import/connections/{id}/sync [post]
func (h *Handlers) ToggleSync(c echo.Context) error {
	if h.connStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "connection store not available")
	}

	id := c.Param("id")
	conn, ok := h.connStore.Get(id)
	if !ok {
		return echo.NewHTTPError(http.StatusNotFound, "connection not found")
	}

	var req toggleSyncRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if req.Enabled != nil {
		conn.SyncEnabled = *req.Enabled
	}
	if req.Interval != "" {
		conn.SyncInterval = req.Interval
	}

	if conn.SyncEnabled {
		conn.SyncStatus = "idle"
		conn.NextSync = time.Now().UTC().Add(parseSyncInterval(conn.SyncInterval)).Format(time.RFC3339)
	} else {
		conn.SyncStatus = ""
		conn.NextSync = ""
		conn.SyncError = ""
	}

	if err := h.connStore.Save(conn); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, conn)
}

// SyncStatus godoc
//
//	@Summary		Get sync-enabled connections status
//	@Description	Returns a list of all connections that have auto-sync enabled, showing their current sync status and errors if any.
//	@Tags			import
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{array}		importer.ConnectionMeta
//	@Router			/api/kiwi/import/sync/status [get]
func (h *Handlers) SyncStatus(c echo.Context) error {
	if h.connStore == nil {
		return c.JSON(http.StatusOK, []any{})
	}
	return c.JSON(http.StatusOK, h.connStore.ListSyncEnabled())
}

// RunConnection godoc
//
//	@Summary		Run saved connection import
//	@Description	Triggers an import run using metadata from a saved connection. Connection credentials/API keys must be supplied in the request body as they are not stored.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			id		path		string					true	"Connection ID"
//	@Param			request	body		runConnectionRequest	true	"Runtime credentials or API key"
//	@Success		200		{object}	importResponse
//	@Failure		400		{object}	map[string]string		"Invalid request body or source configuration details"
//	@Failure		404		{object}	map[string]string		"Connection not found"
//	@Failure		503		{object}	map[string]string		"Connection store not available"
//	@Failure		500		{object}	map[string]string		"Internal import error"
//	@Router			/api/kiwi/import/connections/{id}/run [post]
func (h *Handlers) RunConnection(c echo.Context) error {
	if h.connStore == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "connection store not available")
	}

	id := c.Param("id")
	conn, ok := h.connStore.Get(id)
	if !ok {
		return echo.NewHTTPError(http.StatusNotFound, "connection not found")
	}

	// Parse runtime credentials from body
	var creds runConnectionRequest
	if err := c.Bind(&creds); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	// Build importRequest from saved connection + runtime creds
	ir := importRequest{
		From:        conn.From,
		DSN:         conn.DSN,
		URI:         conn.URI,
		Table:       conn.Table,
		Collection:  conn.Collection,
		Database:    conn.Database,
		DatabaseID:  conn.DatabaseID,
		BaseID:      conn.BaseID,
		TableID:     conn.TableID,
		Project:     conn.Project,
		Prefix:      conn.Prefix,
		IDColumn:    conn.IDColumn,
		Columns:     conn.Columns,
		Credentials: creds.Credentials,
		APIKey:      creds.APIKey,
	}

	src, err := buildAPISource(ir)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	defer src.Close()

	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = "api-import"
	}

	opts := importer.Options{
		Prefix:   conn.Prefix,
		IDColumn: conn.IDColumn,
		Columns:  conn.Columns,
		Actor:    actor,
	}

	ctx := c.Request().Context()
	stats, err := importer.Run(ctx, src, h.pipe, opts)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("import failed: %v", err))
	}

	// Update last_run on the connection
	connStats := &importer.ConnectionStats{
		Imported: stats.Imported,
		Skipped:  stats.Skipped,
		Errors:   stats.Errors,
	}
	_ = h.connStore.UpdateLastRun(id, connStats)

	return c.JSON(http.StatusOK, importResponse{
		Imported: stats.Imported,
		Skipped:  stats.Skipped,
		Archived: stats.Archived,
		Errors:   stats.Errors,
	})
}

func parseSyncInterval(interval string) time.Duration {
	if d, err := time.ParseDuration(interval); err == nil && d > 0 {
		return d
	}
	return 1 * time.Hour
}

// RunImport is used by the MCP tool to trigger an import programmatically.
func RunImport(ctx context.Context, req importRequest, pipe interface {
	Write(ctx context.Context, path string, content []byte, actor string) (interface{ ETag() string }, error)
}) (*importResponse, error) {
	return nil, fmt.Errorf("use the REST API for import")
}

// --- Airbyte endpoints (Phase 4) ---

type airbyteRequest struct {
	From         string         `json:"from"`
	AirbyteImage string         `json:"airbyte_image,omitempty"`
	Config       map[string]any `json:"config,omitempty"`
}

// ImportSources godoc
//
//	@Summary		List available import sources
//	@Description	Returns a list of all supported built-in and Airbyte import sources, as well as server capabilities (whether Docker is available and if an Airbyte Cloud API key is configured).
//	@Tags			import
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{object}	map[string]any	"JSON map listing builtin/airbyte sources and capabilities"
//	@Router			/api/kiwi/import/sources [get]
func (h *Handlers) ImportSources(c echo.Context) error {
	dockerOK := importer.DockerAvailable()
	cloudKey := h.cfg.Import.AirbyteAPIKey
	if cloudKey == "" {
		cloudKey = os.Getenv("AIRBYTE_API_KEY")
	}
	airbyteAvailable := dockerOK || cloudKey != ""
	sources := importer.ListAvailableSources(airbyteAvailable)
	return c.JSON(http.StatusOK, map[string]any{
		"builtin":           sources["builtin"],
		"airbyte":           sources["airbyte"],
		"docker_available":  dockerOK,
		"cloud_key_present": cloudKey != "",
	})
}

// ImportAirbyteSpec godoc
//
//	@Summary		Get Airbyte connector specification
//	@Description	Retrieves the configuration specification schema for a local Docker-based Airbyte connector.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		airbyteRequest	true	"Airbyte request details (source type/image)"
//	@Success		200		{object}	map[string]any	"Connector JSON schema specification"
//	@Failure		400		{object}	map[string]string	"Invalid request body or missing connector image"
//	@Failure		503		{object}	map[string]string	"Docker not available or Airbyte key missing"
//	@Failure		500		{object}	map[string]string	"Docker/specification retrieval error"
//	@Router			/api/kiwi/import/airbyte/spec [post]
func (h *Handlers) ImportAirbyteSpec(c echo.Context) error {
	var req airbyteRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	image := req.AirbyteImage
	if image == "" {
		image = importer.LookupAirbyteImage(req.From)
	}
	if image == "" {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("no Airbyte connector for %q", req.From))
	}

	// Prefer Docker if available
	if importer.DockerAvailable() {
		src, err := importer.NewAirbyteSource(importer.AirbyteSourceOpts{
			Image:  image,
			Config: map[string]any{},
		})
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		ctx := c.Request().Context()
		spec, err := src.Spec(ctx)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		return c.JSON(http.StatusOK, spec)
	}

	// No Docker — check for Airbyte Cloud API key
	apiKey := h.cfg.Import.AirbyteAPIKey
	if apiKey == "" {
		apiKey = os.Getenv("AIRBYTE_API_KEY")
	}
	if apiKey != "" {
		return c.JSON(http.StatusOK, map[string]any{
			"mode": "cloud",
			"message": "Connector spec not available without Docker. " +
				"Airbyte Cloud key is configured — use the connection wizard to configure and sync.",
		})
	}

	return echo.NewHTTPError(http.StatusServiceUnavailable,
		"Docker is not available and no Airbyte Cloud API key is configured. "+
			"Either start Docker or set AIRBYTE_API_KEY in your config/environment.")
}

// ImportAirbyteCheck godoc
//
//	@Summary		Check Airbyte connector connection
//	@Description	Validates the connection configuration against a local Docker-based Airbyte connector.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		airbyteRequest	true	"Airbyte connector configuration details"
//	@Success		200		{object}	map[string]any	"Connection verification result"
//	@Failure		400		{object}	map[string]string	"Invalid request body or missing config/image"
//	@Failure		503		{object}	map[string]string	"Docker not available"
//	@Failure		500		{object}	map[string]string	"Internal execution error"
//	@Router			/api/kiwi/import/airbyte/check [post]
func (h *Handlers) ImportAirbyteCheck(c echo.Context) error {
	var req airbyteRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Config == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "config is required")
	}

	image := req.AirbyteImage
	if image == "" {
		image = importer.LookupAirbyteImage(req.From)
	}
	if image == "" {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("no Airbyte connector for %q", req.From))
	}

	if !importer.DockerAvailable() {
		return h.airbyteUnavailableError(c)
	}

	src, err := importer.NewAirbyteSource(importer.AirbyteSourceOpts{
		Image:  image,
		Config: req.Config,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	ctx := c.Request().Context()
	status, err := src.Check(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, status)
}

// ImportAirbyteDiscover godoc
//
//	@Summary		Discover Airbyte connector streams
//	@Description	Discovers and returns schema definitions (streams) available from a local Docker-based Airbyte connector.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		airbyteRequest	true	"Airbyte connector configuration details"
//	@Success		200		{object}	map[string]any	"Connector catalog and streams schema"
//	@Failure		400		{object}	map[string]string	"Invalid request body or missing config/image"
//	@Failure		503		{object}	map[string]string	"Docker not available"
//	@Failure		500		{object}	map[string]string	"Internal schema discovery error"
//	@Router			/api/kiwi/import/airbyte/discover [post]
func (h *Handlers) ImportAirbyteDiscover(c echo.Context) error {
	var req airbyteRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Config == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "config is required")
	}

	image := req.AirbyteImage
	if image == "" {
		image = importer.LookupAirbyteImage(req.From)
	}
	if image == "" {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("no Airbyte connector for %q", req.From))
	}

	if !importer.DockerAvailable() {
		return h.airbyteUnavailableError(c)
	}

	src, err := importer.NewAirbyteSource(importer.AirbyteSourceOpts{
		Image:  image,
		Config: req.Config,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	ctx := c.Request().Context()
	catalog, err := src.Discover(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, catalog)
}

// airbyteUnavailableError returns a structured error when Docker is missing.
// If an Airbyte Cloud key is configured, hints at that path instead.
func (h *Handlers) airbyteUnavailableError(c echo.Context) error {
	apiKey := h.cfg.Import.AirbyteAPIKey
	if apiKey == "" {
		apiKey = os.Getenv("AIRBYTE_API_KEY")
	}
	if apiKey != "" {
		return echo.NewHTTPError(http.StatusServiceUnavailable,
			"Docker is not available. Airbyte Cloud API key is configured — "+
				"use via=airbyte-cloud or configure your connection through the Cloud dashboard.")
	}
	return echo.NewHTTPError(http.StatusServiceUnavailable,
		"Docker is not available and no Airbyte Cloud API key is configured. "+
			"Either start Docker or set AIRBYTE_API_KEY in your config/environment.")
}

// --- Airbyte Cloud handlers ---

// getAirbyteCloudClient returns a configured Airbyte Cloud client or an error.
func (h *Handlers) getAirbyteCloudClient() (*importer.AirbyteCloudClient, error) {
	apiKey := h.cfg.Import.AirbyteAPIKey
	if apiKey == "" {
		apiKey = os.Getenv("AIRBYTE_API_KEY")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("no Airbyte Cloud API key configured (set airbyte_api_key in config or AIRBYTE_API_KEY env)")
	}
	return importer.NewAirbyteCloudClient(apiKey), nil
}

func (h *Handlers) getAirbyteWorkspaceID() string {
	ws := h.cfg.Import.AirbyteWorkspaceID
	if ws == "" {
		ws = os.Getenv("AIRBYTE_WORKSPACE_ID")
	}
	return ws
}

// ImportAirbyteCloudCheck godoc
//
//	@Summary		Check Airbyte Cloud connection
//	@Description	Validates the connection configuration by creating a temporary source on Airbyte Cloud.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		airbyteCloudCheckRequest	true	"Airbyte Cloud connector configuration details"
//	@Success		200		{object}	map[string]any				"Verification status (includes status, message, and temporary source_id)"
//	@Failure		400		{object}	map[string]string			"Invalid request body, config, or workspace details"
//	@Failure		503		{object}	map[string]string			"Airbyte Cloud key is not configured"
//	@Failure		502		{object}	map[string]string			"Airbyte Cloud API integration gateway error"
//	@Router			/api/kiwi/import/airbyte-cloud/check [post]
func (h *Handlers) ImportAirbyteCloudCheck(c echo.Context) error {
	client, err := h.getAirbyteCloudClient()
	if err != nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	}

	var req airbyteCloudCheckRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Config == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "config is required")
	}

	wsID := h.getAirbyteWorkspaceID()
	if wsID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "airbyte_workspace_id not configured")
	}

	defID := importer.LookupAirbyteDefinitionID(req.From)
	if defID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("no Airbyte Cloud definition for %q", req.From))
	}

	ctx := c.Request().Context()

	sourceID, err := client.CreateSource(ctx, wsID, "kiwifs-check-"+req.From, defID, req.Config)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("Airbyte Cloud create source: %v", err))
	}

	result, err := client.CheckSourceConnection(ctx, sourceID)
	if err != nil {
		return c.JSON(http.StatusOK, map[string]any{
			"status":    "failed",
			"message":   err.Error(),
			"source_id": sourceID,
		})
	}
	result["source_id"] = sourceID
	return c.JSON(http.StatusOK, result)
}

// ImportAirbyteCloudDiscover godoc
//
//	@Summary		Discover Airbyte Cloud streams
//	@Description	Discovers schema streams available for a specified source ID using the Airbyte Cloud API.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		airbyteCloudDiscoverRequest	true	"Airbyte Cloud source identifier"
//	@Success		200		{object}	map[string]any				"Discovered streams and fields schemas"
//	@Failure		400		{object}	map[string]string			"Invalid request body or missing source_id"
//	@Failure		503		{object}	map[string]string			"Airbyte Cloud key is not configured"
//	@Failure		502		{object}	map[string]string			"Airbyte Cloud API integration gateway error"
//	@Router			/api/kiwi/import/airbyte-cloud/discover [post]
func (h *Handlers) ImportAirbyteCloudDiscover(c echo.Context) error {
	client, err := h.getAirbyteCloudClient()
	if err != nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	}

	var req airbyteCloudDiscoverRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.SourceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "source_id is required")
	}

	ctx := c.Request().Context()
	streams, err := client.DiscoverSourceSchema(ctx, req.SourceID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("Airbyte Cloud discover: %v", err))
	}
	return c.JSON(http.StatusOK, map[string]any{"streams": streams})
}

// ImportAirbyteCloudConnections godoc
//
//	@Summary		List Airbyte Cloud connections
//	@Description	Returns a list of all configured connections on the active Airbyte Cloud workspace.
//	@Tags			import
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{object}	map[string]any		"List of connection configurations"
//	@Failure		503		{object}	map[string]string	"Airbyte Cloud key is not configured"
//	@Failure		502		{object}	map[string]string	"Airbyte Cloud API integration gateway error"
//	@Router			/api/kiwi/import/airbyte-cloud/connections [get]
func (h *Handlers) ImportAirbyteCloudConnections(c echo.Context) error {
	client, err := h.getAirbyteCloudClient()
	if err != nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	}

	wsID := h.getAirbyteWorkspaceID()
	var wsIDs []string
	if wsID != "" {
		wsIDs = []string{wsID}
	}

	ctx := c.Request().Context()
	conns, err := client.ListConnections(ctx, wsIDs)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("Airbyte Cloud: %v", err))
	}
	return c.JSON(http.StatusOK, map[string]any{"connections": conns})
}

// ImportAirbyteCloudSync godoc
//
//	@Summary		Trigger Airbyte Cloud sync
//	@Description	Manually triggers a sync job for an existing connection configured on Airbyte Cloud.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			request	body		airbyteCloudSyncRequest	true	"Airbyte Cloud connection identifier"
//	@Success		200		{object}	map[string]any			"Triggered sync job details (job ID, status, timestamps)"
//	@Failure		400		{object}	map[string]string		"Invalid request body or missing connection_id"
//	@Failure		503		{object}	map[string]string		"Airbyte Cloud key is not configured"
//	@Failure		502		{object}	map[string]string		"Airbyte Cloud API integration gateway error"
//	@Router			/api/kiwi/import/airbyte-cloud/sync [post]
func (h *Handlers) ImportAirbyteCloudSync(c echo.Context) error {
	client, err := h.getAirbyteCloudClient()
	if err != nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
	}

	var req airbyteCloudSyncRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.ConnectionID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "connection_id is required")
	}

	ctx := c.Request().Context()
	job, err := client.TriggerSync(ctx, req.ConnectionID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, fmt.Sprintf("Airbyte Cloud sync: %v", err))
	}
	return c.JSON(http.StatusOK, job)
}

// --- File upload import endpoint ---

const maxImportUploadSize = 256 << 20 // 256 MB

// ImportUpload godoc
//
//	@Summary		Upload and import/preview file
//	@Description	Accepts a multipart file upload (CSV, JSON, JSONL, YAML, Excel, SQLite) and runs the import or preview pipeline on it.
//	@Tags			import
//	@Security		BearerAuth
//	@Accept			multipart/form-data
//	@Produce		json
//	@Param			file		formData	file	true	"The data file to upload"
//	@Param			from		formData	string	true	"Data source type ('csv', 'json', 'jsonl', 'yaml', 'excel', 'sqlite')"
//	@Param			prefix		formData	string	false	"Target directory prefix in wiki"
//	@Param			id_column	formData	string	false	"Column/field name to use as primary key"
//	@Param			table		formData	string	false	"Table name (for sqlite)"
//	@Param			query		formData	string	false	"SQL query to run (for sqlite)"
//	@Param			mode		formData	string	false	"Run mode ('import' to import files, 'preview' to return first 5 records)"
//	@Success		200			{object}	importResponse		"On successful import mode (returns stats)"
//	@Failure		400			{object}	map[string]string	"Invalid file, missing source type, or configuration error"
//	@Failure		413			{object}	map[string]string	"File exceeds size limit"
//	@Failure		500			{object}	map[string]string	"Failed to copy file or run import"
//	@Router			/api/kiwi/import/upload [post]
func (h *Handlers) ImportUpload(c echo.Context) error {
	from := c.FormValue("from")
	if from == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "from is required")
	}
	supported := map[string]bool{"csv": true, "json": true, "jsonl": true, "yaml": true, "excel": true, "sqlite": true}
	if !supported[from] {
		return echo.NewHTTPError(http.StatusBadRequest,
			fmt.Sprintf("file upload not supported for %q — use the path-based import", from))
	}

	file, err := c.FormFile("file")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "file field is required")
	}
	if file.Size > maxImportUploadSize {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", maxImportUploadSize>>20))
	}

	src, err := file.Open()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to open upload")
	}
	defer src.Close()

	// Write to temp file so the importer can read it
	ext := filepath.Ext(file.Filename)
	if ext == "" {
		switch from {
		case "csv":
			ext = ".csv"
		case "json":
			ext = ".json"
		case "jsonl":
			ext = ".jsonl"
		case "yaml":
			ext = ".yaml"
		case "excel":
			ext = ".xlsx"
		case "sqlite":
			ext = ".db"
		}
	}
	tmp, err := os.CreateTemp("", "kiwifs-import-*"+ext)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create temp file")
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to write temp file")
	}
	tmp.Close()

	// Parse optional form fields
	prefix := c.FormValue("prefix")
	idColumn := c.FormValue("id_column")
	table := c.FormValue("table") // for sqlite
	query := c.FormValue("query") // for sqlite
	var fieldMappings []importer.FieldMapping
	if raw := c.FormValue("field_mappings"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &fieldMappings); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid field_mappings JSON")
		}
	}

	// Determine what to call the data if no prefix given
	if prefix == "" {
		prefix = strings.TrimSuffix(filepath.Base(file.Filename), ext)
	}

	// Run the preview (dry_run) or actual import
	mode := c.FormValue("mode") // "preview" or "import" (default: import)

	var ir importRequest
	ir.From = from
	ir.Prefix = prefix
	ir.IDColumn = idColumn
	ir.Table = table
	ir.Query = query
	ir.FieldMappings = fieldMappings

	switch from {
	case "csv", "json", "jsonl", "yaml", "excel":
		ir.File = tmpPath
	case "sqlite":
		ir.DB = tmpPath
		if ir.Table == "" && ir.Query == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "table or query is required for sqlite")
		}
	}

	if mode == "preview" {
		apiSrc, err := buildAPISource(ir)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		defer apiSrc.Close()

		previews, err := streamImportPreviews(c.Request().Context(), apiSrc, 5, recordPreviewOptsFromImportRequest(ir))
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		return c.JSON(http.StatusOK, previewResponse{Records: previews})
	}

	if mode == "infer-fields" {
		apiSrc, err := buildAPISource(ir)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		defer apiSrc.Close()

		fields, err := inferFieldsFromSource(c.Request().Context(), apiSrc)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
		return c.JSON(http.StatusOK, inferFieldsResponse{Fields: fields})
	}

	// Run actual import
	apiSrc, err := buildAPISource(ir)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	defer apiSrc.Close()

	actor := sanitizeActor(c.Request().Header.Get("X-Actor"))
	if actor == "anonymous" {
		actor = "api-import"
	}

	opts := importer.Options{
		Prefix:        ir.Prefix,
		IDColumn:      ir.IDColumn,
		FieldMappings: ir.FieldMappings,
		Actor:         actor,
		Limit:    ir.Limit,
	}

	ctx := c.Request().Context()
	stats, err := importer.Run(ctx, apiSrc, h.pipe, opts)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("import failed: %v", err))
	}

	return c.JSON(http.StatusOK, importResponse{
		Imported: stats.Imported,
		Skipped:  stats.Skipped,
		Archived: stats.Archived,
		Errors:   stats.Errors,
	})
}
