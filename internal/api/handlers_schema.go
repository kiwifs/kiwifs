package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/labstack/echo/v4"
)

var validTypeName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ListSchemas godoc
//
//	@Summary		List JSON schemas
//	@Description	Lists all JSON schemas stored in the .kiwi/schemas directory by their type names.
//	@Tags			schemas
//	@Security		BearerAuth
//	@Produce		json
//	@Success		200		{array}		string
//	@Router			/api/kiwi/schemas [get]
func (h *Handlers) ListSchemas(c echo.Context) error {
	dir := filepath.Join(h.root, ".kiwi", "schemas")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return c.JSON(http.StatusOK, []string{})
	}
	var schemas []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			schemas = append(schemas, e.Name()[:len(e.Name())-5])
		}
	}
	if schemas == nil {
		schemas = []string{}
	}
	return c.JSON(http.StatusOK, schemas)
}

// GetSchema godoc
//
//	@Summary		Get JSON schema by type
//	@Description	Retrieves the JSON schema definition for a specific type name.
//	@Tags			schemas
//	@Security		BearerAuth
//	@Produce		json
//	@Param			type	path		string	true	"Schema type name"
//	@Success		200		{object}	map[string]any
//	@Failure		400		{object}	map[string]string
//	@Failure		404		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/schemas/{type} [get]
func (h *Handlers) GetSchema(c echo.Context) error {
	typeName := c.Param("type")
	if typeName == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "type is required")
	}
	if !validTypeName.MatchString(typeName) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid type name")
	}

	path := filepath.Join(h.root, ".kiwi", "schemas", typeName+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "schema not found")
	}
	var raw json.RawMessage
	if json.Unmarshal(data, &raw) != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "invalid schema")
	}
	return c.JSON(http.StatusOK, raw)
}

type putSchemaResponse struct {
	Status string `json:"status" example:"ok"`
	Type   string `json:"type" example:"task"`
}

// PutSchema godoc
//
//	@Summary		Create or update JSON schema
//	@Description	Creates or updates the JSON schema definition for a specific type name.
//	@Tags			schemas
//	@Security		BearerAuth
//	@Accept			json
//	@Produce		json
//	@Param			type	path		string			true	"Schema type name"
//	@Param			body	body		map[string]any	true	"JSON Schema definition"
//	@Success		200		{object}	putSchemaResponse
//	@Failure		400		{object}	map[string]string
//	@Failure		500		{object}	map[string]string
//	@Router			/api/kiwi/schemas/{type} [put]
func (h *Handlers) PutSchema(c echo.Context) error {
	typeName := c.Param("type")
	if typeName == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "type is required")
	}
	if !validTypeName.MatchString(typeName) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid type name")
	}

	var raw json.RawMessage
	if err := c.Bind(&raw); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid JSON schema")
	}

	dir := filepath.Join(h.root, ".kiwi", "schemas")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	path := filepath.Join(dir, typeName+".json")
	if err := os.WriteFile(path, raw, 0644); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if h.schemaReload != nil {
		h.schemaReload()
	}

	return c.JSON(http.StatusOK, putSchemaResponse{Status: "ok", Type: typeName})
}
