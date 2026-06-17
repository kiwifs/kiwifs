package webui

import (
	"bytes"
	"strings"

	"github.com/kiwifs/kiwifs/internal/config"
)

var branding config.BrandingConfig

// SetBranding wires workspace branding for index.html injection at serve time.
func SetBranding(b config.BrandingConfig) {
	branding = b
}

func injectBranding(html []byte) []byte {
	name := htmlEscape(branding.ResolvedName())
	favicon := htmlEscape(branding.ResolvedFaviconURL())

	out := bytes.Replace(html, []byte("<title>KiwiFS</title>"), []byte("<title>"+name+"</title>"), 1)

	defaultLink := `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`
	customLink := faviconLinkTag(favicon)
	out = bytes.Replace(out, []byte(defaultLink), []byte(customLink), 1)

	return out
}

func faviconLinkTag(href string) string {
	ctype := "image/png"
	lower := strings.ToLower(href)
	switch {
	case strings.HasSuffix(lower, ".svg"):
		ctype = "image/svg+xml"
	case strings.HasSuffix(lower, ".ico"):
		ctype = "image/x-icon"
	}
	return `<link rel="icon" type="` + ctype + `" href="` + href + `" />`
}
