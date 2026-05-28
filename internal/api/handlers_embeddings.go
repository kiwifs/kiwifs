package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/vectorstore"
	"github.com/labstack/echo/v4"
)

type chunkResp struct {
	ChunkIdx int       `json:"chunk_idx" example:"0"`
	Text     string    `json:"text" example:"This is the first sentence..."`
	Vector   []float32 `json:"vector" example:"0.1,-0.2,0.4"`
}

type embeddingsResponse struct {
	Path       string      `json:"path" example:"/docs/getting-started.md"`
	Dimensions int         `json:"dimensions" example:"1536"`
	Chunks     []chunkResp `json:"chunks"`
}

// Embeddings godoc
//
//	@Summary		Get embeddings for a file
//	@Description	Returns the stored vector embeddings and text chunks for a specified file path.
//	@Tags			embeddings
//	@Security		BearerAuth
//	@Produce		json
//	@Param			path	query		string	true	"File path to get embeddings for"
//	@Success		200		{object}	embeddingsResponse
//	@Failure		400		{object}	map[string]string	"Path parameter is required"
//	@Failure		404		{object}	map[string]string	"No embeddings found for path"
//	@Failure		500		{object}	map[string]string	"Internal vector database query error"
//	@Failure		503		{object}	map[string]string	"Vector search service is disabled"
//	@Router			/api/kiwi/embeddings [get]
func (h *Handlers) Embeddings(c echo.Context) error {
	path := c.QueryParam("path")
	if path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	if h.vectors == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, vectorstore.ErrDisabled.Error())
	}

	ctx := c.Request().Context()
	chunks, err := h.vectors.GetVectors(ctx, path)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if len(chunks) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "no embeddings found for path")
	}

	out := make([]chunkResp, len(chunks))
	dims := 0
	for i, ch := range chunks {
		out[i] = chunkResp{
			ChunkIdx: ch.ChunkIdx,
			Text:     ch.Text,
			Vector:   ch.Vector,
		}
		if i == 0 && len(ch.Vector) > 0 {
			dims = len(ch.Vector)
		}
	}

	return c.JSON(http.StatusOK, embeddingsResponse{
		Path:       path,
		Dimensions: dims,
		Chunks:     out,
	})
}
