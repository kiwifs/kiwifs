// Package protoauth authorizes requests on the whole-tree protocol servers
// (S3, WebDAV) against the same [auth] config the REST API enforces.
//
// Those protocols address the knowledge tree as a single mount, so they can
// only honour credentials that grant the whole tree. Keys restricted to a
// path (per-space keys with a `space` path or a `prefix`) are rejected rather
// than silently widened, and OIDC is refused outright because S3 and WebDAV
// clients cannot complete an OIDC login.
package protoauth

import (
	"crypto/subtle"
	"fmt"
	"sync/atomic"

	"github.com/kiwifs/kiwifs/internal/config"
)

type state struct {
	open   bool
	global string
	keys   []config.APIKeyEntry
}

// Checker is safe for concurrent use. A nil Checker denies every request.
type Checker struct {
	st atomic.Pointer[state]
}

// None returns a Checker that allows every request, for auth.type = "none".
func None() *Checker {
	c := &Checker{}
	c.st.Store(&state{open: true})
	return c
}

// New builds a Checker for auth. It fails for auth types the protocol
// servers cannot enforce, so callers refuse to start instead of serving the
// tree unauthenticated.
func New(auth config.AuthConfig) (*Checker, error) {
	st, err := build(auth)
	if err != nil {
		return nil, err
	}
	c := &Checker{}
	c.st.Store(st)
	return c, nil
}

// Reload swaps in a new auth config. If the new config cannot be enforced,
// the Checker denies every request until a valid config is reloaded.
func (c *Checker) Reload(auth config.AuthConfig) error {
	st, err := build(auth)
	if err != nil {
		c.st.Store(&state{})
		return err
	}
	c.st.Store(st)
	return nil
}

// IsOpen reports whether requests are accepted without credentials.
func (c *Checker) IsOpen() bool {
	if c == nil {
		return false
	}
	return c.st.Load().open
}

// Allow reports whether token may perform a read (write=false) or a
// mutation (write=true).
func (c *Checker) Allow(token string, write bool) bool {
	if c == nil {
		return false
	}
	st := c.st.Load()
	if st.open {
		return true
	}
	if token == "" {
		return false
	}
	if st.global != "" {
		return subtle.ConstantTimeCompare([]byte(token), []byte(st.global)) == 1
	}
	ok := false
	for _, k := range st.keys {
		if k.Key == "" || k.Space != "" || k.Prefix != "" {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(token), []byte(k.Key)) == 1 {
			ok = !write || k.Scope != "read"
		}
	}
	return ok
}

func build(auth config.AuthConfig) (*state, error) {
	switch auth.Type {
	case "", "none":
		return &state{open: true}, nil
	case "apikey":
		// Mirrors the REST API, which also runs open when no key is set.
		return &state{open: auth.APIKey == "", global: auth.APIKey}, nil
	case "perspace":
		return &state{open: len(auth.APIKeys) == 0, keys: auth.APIKeys}, nil
	case "oidc":
		return nil, fmt.Errorf("auth.type = \"oidc\" cannot be enforced on S3 or WebDAV; their clients cannot complete an OIDC login")
	default:
		return nil, fmt.Errorf("unknown auth.type %q", auth.Type)
	}
}
