package markdown

import "testing"

func TestResolveAppSrc(t *testing.T) {
	for _, c := range []struct {
		page, src, want string
		ok              bool
	}{
		{"guides/q.md", "apps/a.html", "guides/apps/a.html", true},
		{"guides/q.md", "../shared/a.html", "shared/a.html", true},
		{"guides/q.md", "/apps/a.html", "apps/a.html", true},
		{"guides/q.md", "./a.html", "guides/a.html", true},
		{"q.md", "..foo.html", "..foo.html", true},
		{"q.md", "a/../..foo.html", "..foo.html", true},
		{"q.md", ".", "", true},
		{"q.md", "../escape.html", "", false},
		{"guides/q.md", "../../escape.html", "", false},
		{"guides/q.md", "/../escape.html", "", false},
		{"q.md", "..", "", false},
	} {
		got, ok := ResolveAppSrc(c.page, c.src)
		if got != c.want || ok != c.ok {
			t.Errorf("ResolveAppSrc(%q, %q) = %q, %v; want %q, %v", c.page, c.src, got, ok, c.want, c.ok)
		}
	}
}

func TestFenceMetaValue(t *testing.T) {
	for _, c := range []struct {
		meta, value, raw string
		quote            byte
		ok               bool
	}{
		{meta: "id=a src=apps/a.html chrome=full", value: "apps/a.html", raw: "apps/a.html", ok: true},
		{meta: `src="my apps/a b.html" kit=off`, value: "my apps/a b.html", raw: `"my apps/a b.html"`, quote: '"', ok: true},
		{meta: `src='it"s.html'`, value: `it"s.html`, raw: `'it"s.html'`, quote: '\'', ok: true},
		{meta: "id=a\tsrc=apps/a.html", value: "apps/a.html", raw: "apps/a.html", ok: true},
		{meta: `title="see src=x.html" chrome=full`},
		{meta: `title="see src=x.html" src=real.html`, value: "real.html", raw: "real.html", ok: true},
		// A bare value beats a quoted one, as in the UI.
		{meta: `src=bare.html src="quoted.html"`, value: "bare.html", raw: "bare.html", ok: true},
		{meta: `src="a.html" src="b.html"`, value: "b.html", raw: `"b.html"`, quote: '"', ok: true},
		{meta: `src=a"b c".html`},
		{meta: "srcset=x.html"},
	} {
		v, ok := FenceMetaValue(c.meta, "src")
		if ok != c.ok {
			t.Errorf("FenceMetaValue(%q) ok = %v, want %v", c.meta, ok, c.ok)
			continue
		}
		if !ok {
			continue
		}
		if v.Value != c.value || c.meta[v.Start:v.End] != c.raw || v.Quote != c.quote {
			t.Errorf("FenceMetaValue(%q) = %+v (raw %q), want value %q raw %q quote %q", c.meta, v, c.meta[v.Start:v.End], c.value, c.raw, c.quote)
		}
		if want := parseFenceMeta(c.meta)["src"]; want != v.Value {
			t.Errorf("FenceMetaValue(%q) = %q, parseFenceMeta says %q", c.meta, v.Value, want)
		}
	}
}
