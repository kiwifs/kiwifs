package api

import (
	"net/http"
	"path/filepath"

	"github.com/kiwifs/kiwifs/internal/importer"
	"github.com/labstack/echo/v4"
)

type ingestRequest struct {
	File             string `json:"file" example:"/tmp/report.pdf"`
	SplitMode        string `json:"split_mode" example:"heading"`
	Prefix           string `json:"prefix" example:"imports/report/"`
	ExtractKeywords  bool   `json:"extract_keywords" example:"true"`
	MaxKeywords      int    `json:"max_keywords" example:"5"`
	ConvertCrossRefs bool   `json:"convert_crossrefs" example:"true"`
	Actor            string `json:"actor" example:"admin"`
}

// Ingest godoc
//
//	@Summary		Ingest a document
//	@Description	Ingests an external file (PDF, DOCX, XLSX, PPTX, JPG, PNG, etc.) using MarkItDown, processes it (splitting, keyword extraction, etc.), and writes it to the knowledge base.
//	@Tags			importer
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			body	body		ingestRequest	true	"Ingestion options and file path"
//	@Success		200		{object}	importer.IngestResult
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/ingest [post]
func (h *Handlers) Ingest(c echo.Context) error {
	var req ingestRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.File == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "file is required")
	}

	ext := filepath.Ext(req.File)
	if !importer.IsMarkItDownFormat(ext) {
		return echo.NewHTTPError(http.StatusBadRequest, "unsupported file format: "+ext)
	}

	if req.SplitMode == "" {
		req.SplitMode = "single"
	}

	opts := importer.IngestOptions{
		SplitMode:        req.SplitMode,
		Prefix:           req.Prefix,
		ExtractKeywords:  req.ExtractKeywords,
		MaxKeywords:      req.MaxKeywords,
		ConvertCrossRefs: req.ConvertCrossRefs,
		Actor:            req.Actor,
	}

	result, err := importer.Ingest(c.Request().Context(), req.File, h.pipe, opts)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, result)
}
