package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	pathpkg "path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/kiwifs/kiwifs/internal/config"
	"github.com/kiwifs/kiwifs/internal/rbac"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/labstack/echo/v4"
)

// rawSignWindow sets signed /raw/ URL lifetime: expiry is rounded up to the
// next window boundary plus one window, so a URL is valid for 30-60 minutes
// and every render inside a window reuses the same URL (and browser cache).
const rawSignWindow = 30 * time.Minute

const rawPrivateCtxKey = "kiwi.rawPrivate"

// rawSigner mints HMAC signatures for /raw/ URLs. Browsers load those URLs
// from <img>, <video> and <iframe> tags, which cannot send a bearer header.
// The key lives only in memory: a restart invalidates outstanding URLs, and
// each space's server has its own key, so a signature never crosses spaces.
type rawSigner struct {
	key []byte
}

func newRawSigner() *rawSigner {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic("raw signer: " + err.Error())
	}
	return &rawSigner{key: key}
}

func (s *rawSigner) mac(p string, exp int64) []byte {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(p))
	m.Write([]byte{0})
	m.Write([]byte(strconv.FormatInt(exp, 10)))
	return m.Sum(nil)
}

func (s *rawSigner) sign(p string, now time.Time) (exp int64, sig string) {
	win := int64(rawSignWindow / time.Second)
	exp = (now.Unix()/win + 2) * win
	return exp, base64.RawURLEncoding.EncodeToString(s.mac(p, exp))
}

func (s *rawSigner) verify(p, expStr, sig string, now time.Time) bool {
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || now.Unix() >= exp {
		return false
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return false
	}
	return hmac.Equal(got, s.mac(p, exp))
}

func cleanRawPath(p string) string {
	return strings.TrimPrefix(pathpkg.Clean("/"+strings.ReplaceAll(p, "\\", "/")), "/")
}

// rawParamPath is the single source of the /raw/ path for both the access
// check and the handler, so the path that was authorized is the path served.
// Echo routes on URL.RawPath when it is set, leaving the param escaped.
func rawParamPath(c echo.Context) string {
	p := c.Param("*")
	if c.Request().URL.RawPath != "" {
		if u, err := url.PathUnescape(p); err == nil {
			p = u
		}
	}
	return cleanRawPath(p)
}

func escapeRawPath(p string) string {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return strings.Join(segs, "/")
}

// authEnforced mirrors authMiddleware: a mode without credentials configured
// (or OIDC whose provider failed to load) lets every request through.
func (s *Server) authEnforced() bool {
	la := s.auth.Load()
	if la == nil {
		return false
	}
	switch la.typ {
	case "apikey":
		return la.global != ""
	case "perspace":
		return len(la.keys) > 0
	case "oidc":
		return la.oidcMW != nil
	}
	return false
}

// rawAccess gates /raw/*. With auth enforced a request needs one of: a valid
// signature from GET /api/kiwi/raw-sign, API credentials, or a target that is
// already public (a branding asset, or content served by /p/*).
func (s *Server) rawAccess(h *Handlers, authMW echo.MiddlewareFunc) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !s.authEnforced() {
				return next(c)
			}
			switch s.cfg.Space.Visibility {
			case "public", "unlisted":
				// Both modes already open direct file reads by path.
				return next(c)
			}
			p := rawParamPath(c)
			q := c.QueryParams()
			if sig := q.Get("sig"); sig != "" {
				if !s.rawSigner.verify(p, q.Get("exp"), sig, time.Now()) {
					return echo.NewHTTPError(http.StatusForbidden, "invalid or expired signature")
				}
				c.Set(rawPrivateCtxKey, true)
				return next(c)
			}
			// The public check walks sibling pages, so only pay for it on
			// requests that did not bring credentials.
			if c.Request().Header.Get("Authorization") == "" && h.rawIsPublic(c.Request().Context(), p) {
				return next(c)
			}
			// Key space/prefix scopes are enforced against ?path=.
			q.Set("path", p)
			c.Set(rawPrivateCtxKey, true)
			return authMW(next)(c)
		}
	}
}

func (h *Handlers) rawIsPublic(ctx context.Context, p string) bool {
	for _, u := range []string{h.ui.Branding.LogoURL, h.ui.Branding.FaviconURL} {
		if rel, ok := strings.CutPrefix(config.ResolveBrandingAssetURL(u), "/raw/"); ok && cleanRawPath(rel) == p {
			return true
		}
	}
	switch strings.ToLower(filepath.Ext(p)) {
	case ".md", ".markdown":
		content, err := h.store.Read(ctx, p)
		return err == nil && (rbac.PageVisibility(content) == rbac.VisibilityPublic || rbac.PagePublished(content))
	}
	return h.hasPublicSibling(ctx, p)
}

type rawSignResponse struct {
	Path    string    `json:"path"`
	URL     string    `json:"url"`
	Expires time.Time `json:"expires"`
}

// SignRawURL godoc
//
//	@Summary		Sign a raw file URL
//	@Description	Returns a short-lived signed /raw/ URL for a file, for clients such as <img> tags that cannot send an Authorization header. The URL is valid for 30-60 minutes.
//	@Tags			files
//	@Produce		json
//	@Param			path	query		string	true	"File path"
//	@Success		200		{object}	rawSignResponse
//	@Failure		400		{object}	map[string]string
//	@Router			/api/kiwi/raw-sign [get]
func (h *Handlers) SignRawURL(c echo.Context) error {
	raw := c.QueryParam("path")
	if raw == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "path is required")
	}
	if _, err := storage.GuardPath(h.root, raw); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	p := cleanRawPath(raw)
	exp, sig := h.rawSigner.sign(p, time.Now())
	q := url.Values{"exp": {strconv.FormatInt(exp, 10)}, "sig": {sig}}
	return c.JSON(http.StatusOK, rawSignResponse{
		Path:    p,
		URL:     "/raw/" + escapeRawPath(p) + "?" + q.Encode(),
		Expires: time.Unix(exp, 0).UTC(),
	})
}
