package config

import "testing"

func TestJanitorExternalLinkCheckDisabledByDefault(t *testing.T) {
	cfg := JanitorConfig{}
	if cfg.ExternalLinkCheckEnabled() {
		t.Fatal("external link check should be disabled by default")
	}
	if cfg.ExternalLinkCheckConfig().Enabled() {
		t.Fatal("ExternalLinkCheckConfig should be disabled by default")
	}
}

func TestJanitorExternalLinkCheckEnabled(t *testing.T) {
	on := true
	cfg := JanitorConfig{ExternalLinkCheck: &on}
	if !cfg.ExternalLinkCheckEnabled() {
		t.Fatal("expected external link check enabled")
	}
	linkCfg := cfg.ExternalLinkCheckConfig()
	if !linkCfg.Enabled() {
		t.Fatal("expected ExternalLinkCheckConfig enabled")
	}
	if len(linkCfg.IgnoreHosts) != 0 {
		t.Fatalf("expected empty ignore list by default, got %v", linkCfg.IgnoreHosts)
	}
}
