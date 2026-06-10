package embed

import (
	"os"
	"strings"
)

// expandUserPath replaces a leading ~/ with the user's home directory.
func expandUserPath(path string) string {
	if path == "" || !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return strings.Replace(path, "~", home, 1)
}
