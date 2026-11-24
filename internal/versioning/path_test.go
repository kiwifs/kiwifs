package versioning

import "testing"

func TestUnquotePath(t *testing.T) {
	for _, tt := range []struct{ field, want string }{
		{"pages/a.md", "pages/a.md"},
		{"with space.md", "with space.md"},
		{`"caf\303\251.md"`, "café.md"},
		{`"\346\227\245\346\234\254/\350\252\236.md"`, "日本/語.md"},
		{`"say \"hi\".md"`, `say "hi".md`},
		{`"tab\there.md"`, "tab\there.md"},
		{`"back\\slash.md"`, `back\slash.md`},
		{`"not closed`, `"not closed`},
		{"", ""},
	} {
		if got := UnquotePath(tt.field); got != tt.want {
			t.Errorf("UnquotePath(%s) = %q, want %q", tt.field, got, tt.want)
		}
	}
}
