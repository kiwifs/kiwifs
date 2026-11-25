package versioning

import (
	"strconv"
	"strings"
)

// UnquotePath returns the real path for a path field printed by git without
// -z. Git wraps a name that has non-ASCII bytes, quotes, backslashes or
// control characters in double quotes and escapes those bytes C-style
// ("caf\303\251.md"); Go string literals use the same escapes.
func UnquotePath(field string) string {
	if !strings.HasPrefix(field, `"`) {
		return field
	}
	if path, err := strconv.Unquote(field); err == nil {
		return path
	}
	return field
}
