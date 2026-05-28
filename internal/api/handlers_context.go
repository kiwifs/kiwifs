package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/labstack/echo/v4"
)

type contextResponse struct {
	Playbook string `json:"playbook" example:"# Playbook content..."`
	Schema   string `json:"schema" example:"# Schema content..."`
	Index    string `json:"index" example:"# Index content..."`
	Rules    string `json:"rules" example:"# Rules content..."`
}

// Context godoc
//
//	@Summary		Get workspace context files
//	@Description	Reads and returns the contents of key workspace context markdown files: playbook.md, SCHEMA.md, index.md, and rules.md. If a file does not exist, an empty string is returned for its field.
//	@Tags			context
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{object}	contextResponse
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/context [get]
func (h *Handlers) Context(c echo.Context) error {
	read := func(rel string) string {
		data, err := os.ReadFile(filepath.Join(h.root, rel))
		if err != nil {
			return ""
		}
		return string(data)
	}

	return c.JSON(http.StatusOK, contextResponse{
		Playbook: read(filepath.Join(".kiwi", "playbook.md")),
		Schema:   read("SCHEMA.md"),
		Index:    read("index.md"),
		Rules:    read(filepath.Join(".kiwi", "rules.md")),
	})
}
