package api

import (
	"net/http"

	"github.com/kiwifs/kiwifs/internal/slashcommands"
	"github.com/labstack/echo/v4"
)

// GetEditorSlashCommands godoc
//
//	@Summary		Get configurable editor slash commands
//	@Description	Returns custom slash commands merged from [[ui.editor.slash_commands]] in config.toml and the space's .kiwi/slash-commands.toml (later ids win). Templates are resolved server-side, so each command's insert field holds the text to insert; {{cursor}} marks the caret. hide lists built-in command ids to remove from the menu, and warnings describes entries that were skipped. The file is read on every request.
//	@Tags			editor
//	@Security		BearerAuth
//	@Success		200	{object}	slashcommands.Resolved
//	@Router			/api/kiwi/editor/slash-commands [get]
func (h *Handlers) GetEditorSlashCommands(c echo.Context) error {
	res := slashcommands.Resolve(slashcommands.Options{
		Root:           h.root,
		File:           h.ui.Editor.SlashCommandsFile,
		ConfigCommands: h.ui.Editor.SlashCommands,
	})
	return c.JSON(http.StatusOK, res)
}
