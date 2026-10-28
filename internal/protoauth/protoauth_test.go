package protoauth

import (
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
)

func TestNewRejectsOIDCAndUnknownTypes(t *testing.T) {
	for _, typ := range []string{"oidc", "ldap"} {
		if _, err := New(config.AuthConfig{Type: typ}); err == nil {
			t.Fatalf("auth.type=%q: want error, got a checker", typ)
		}
	}
}

func TestNilCheckerDeniesEverything(t *testing.T) {
	var c *Checker
	if c.IsOpen() || c.Allow("anything", false) {
		t.Fatal("nil checker must deny")
	}
}

func TestAllow(t *testing.T) {
	perspace := config.AuthConfig{Type: "perspace", APIKeys: []config.APIKeyEntry{
		{Key: "admin-key"},
		{Key: "read-key", Scope: "read"},
		{Key: "write-key", Scope: "write"},
		{Key: "folder-key", Space: "team-a"},
		{Key: "prefix-key", Prefix: "drafts/"},
		{Key: ""},
	}}
	cases := []struct {
		name  string
		auth  config.AuthConfig
		token string
		write bool
		want  bool
	}{
		{"none allows anonymous", config.AuthConfig{Type: "none"}, "", true, true},
		{"empty type allows anonymous", config.AuthConfig{}, "", true, true},
		{"apikey without key stays open like REST", config.AuthConfig{Type: "apikey"}, "", true, true},
		{"apikey match", config.AuthConfig{Type: "apikey", APIKey: "k"}, "k", true, true},
		{"apikey mismatch", config.AuthConfig{Type: "apikey", APIKey: "k"}, "k2", false, false},
		{"apikey anonymous", config.AuthConfig{Type: "apikey", APIKey: "k"}, "", false, false},
		{"perspace without keys stays open like REST", config.AuthConfig{Type: "perspace"}, "", true, true},
		{"perspace anonymous read", perspace, "", false, false},
		{"perspace anonymous write", perspace, "", true, false},
		{"perspace unknown key", perspace, "nope", false, false},
		{"perspace admin write", perspace, "admin-key", true, true},
		{"perspace read key reads", perspace, "read-key", false, true},
		{"perspace read key cannot write", perspace, "read-key", true, false},
		{"perspace write key writes", perspace, "write-key", true, true},
		{"folder-scoped key rejected", perspace, "folder-key", false, false},
		{"prefix-scoped key rejected", perspace, "prefix-key", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, err := New(tc.auth)
			if err != nil {
				t.Fatal(err)
			}
			if got := c.Allow(tc.token, tc.write); got != tc.want {
				t.Fatalf("Allow(%q, write=%v) = %v, want %v", tc.token, tc.write, got, tc.want)
			}
		})
	}
}

func TestReload(t *testing.T) {
	c, err := New(config.AuthConfig{Type: "apikey", APIKey: "old"})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Reload(config.AuthConfig{Type: "apikey", APIKey: "new"}); err != nil {
		t.Fatal(err)
	}
	if c.Allow("old", false) || !c.Allow("new", false) {
		t.Fatal("reload must rotate the key")
	}
	if err := c.Reload(config.AuthConfig{Type: "oidc"}); err == nil {
		t.Fatal("reload to oidc: want error")
	}
	if c.IsOpen() || c.Allow("new", false) || c.Allow("", false) {
		t.Fatal("a failed reload must deny everything, not keep or open access")
	}
}
