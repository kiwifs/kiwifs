package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadExpandsEnv(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[search.vector.embedder]
api_key = "${KIWI_TEST_KEY}"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	t.Setenv("KIWI_TEST_KEY", "secret")

	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Search.Vector.Embedder.APIKey != "secret" {
		t.Fatalf("expansion failed: %q", cfg.Search.Vector.Embedder.APIKey)
	}
}

func TestLoadExpandsEnvInAuthAndOIDC(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[auth]
type = "apikey"
api_key = "${KIWI_AUTH_KEY}"

[auth.oidc]
issuer = "${KIWI_OIDC_ISSUER}"
client_id = "${KIWI_OIDC_CLIENT}"

[[auth.api_keys]]
key = "${KIWI_TEAM_KEY}"
space = "team"
actor = "team-bot"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	t.Setenv("KIWI_AUTH_KEY", "topsecret")
	t.Setenv("KIWI_OIDC_ISSUER", "https://idp.example/")
	t.Setenv("KIWI_OIDC_CLIENT", "kiwi-app")
	t.Setenv("KIWI_TEAM_KEY", "perspace-secret")

	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Auth.APIKey != "topsecret" {
		t.Fatalf("auth.api_key not expanded: %q", cfg.Auth.APIKey)
	}
	if cfg.Auth.OIDC.Issuer != "https://idp.example/" {
		t.Fatalf("auth.oidc.issuer not expanded: %q", cfg.Auth.OIDC.Issuer)
	}
	if cfg.Auth.OIDC.ClientID != "kiwi-app" {
		t.Fatalf("auth.oidc.client_id not expanded: %q", cfg.Auth.OIDC.ClientID)
	}
	if len(cfg.Auth.APIKeys) != 1 || cfg.Auth.APIKeys[0].Key != "perspace-secret" {
		t.Fatalf("per-space key not expanded: %+v", cfg.Auth.APIKeys)
	}
}

func TestPublicURLFromTOML(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[server]
public_url = "https://wiki.mycompany.com"
host = "0.0.0.0"
port = 3333
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.ResolvedPublicURL(); got != "https://wiki.mycompany.com" {
		t.Fatalf("want explicit public_url, got %q", got)
	}
}

func TestPublicURLFromEnv(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[server]
host = "0.0.0.0"
port = 3333
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	t.Setenv("KIWI_PUBLIC_URL", "https://env.example.com/")
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.ResolvedPublicURL(); got != "https://env.example.com" {
		t.Fatalf("want env override (trailing slash trimmed), got %q", got)
	}
}

func TestPublicURLDefaultsToEmpty(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[server]
host = "10.0.0.1"
port = 8080
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.ResolvedPublicURL(); got != "" {
		t.Fatalf("want empty when no public_url configured, got %q", got)
	}
}

func TestPermalink(t *testing.T) {
	cases := []struct {
		publicURL, path, want string
	}{
		{"https://wiki.co", "concepts/auth.md", "https://wiki.co/page/concepts/auth.md"},
		{"https://wiki.co", "/concepts/auth.md", "https://wiki.co/page/concepts/auth.md"},
		{"", "concepts/auth.md", ""},
		{"https://wiki.co", "my notes/auth flow.md", "https://wiki.co/page/my%20notes/auth%20flow.md"},
		{"https://wiki.co", "日本語/ノート.md", "https://wiki.co/page/%E6%97%A5%E6%9C%AC%E8%AA%9E/%E3%83%8E%E3%83%BC%E3%83%88.md"},
		{"https://wiki.co", "file#2.md", "https://wiki.co/page/file%232.md"},
		{"https://wiki.co", "100%.md", "https://wiki.co/page/100%25.md"},
	}
	for _, tc := range cases {
		got := Permalink(tc.publicURL, tc.path)
		if got != tc.want {
			t.Errorf("Permalink(%q, %q) = %q, want %q", tc.publicURL, tc.path, got, tc.want)
		}
	}
}

func TestBackupRebaseBeforePushDefaultsTrue(t *testing.T) {
	cfg := BackupConfig{}
	if !cfg.IsRebaseBeforePush() {
		t.Fatal("backup rebase_before_push should default to true")
	}
}

func TestBackupRebaseBeforePushFromEnv(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[backup]
rebase_before_push = true
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	t.Setenv("KIWI_BACKUP_REBASE_BEFORE_PUSH", "false")
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Backup.IsRebaseBeforePush() {
		t.Fatal("env should override backup.rebase_before_push to false")
	}
}

func TestVersioningMaxVersionsTOML(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[versioning]
strategy = "cow"
max_versions = 25
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Versioning.MaxVersions != 25 {
		t.Fatalf("want 25, got %d", cfg.Versioning.MaxVersions)
	}
}

func TestVectorTuningTOML(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[search.vector]
enabled = true
worker_count = 1

[search.vector.embedder]
provider = "ollama"
timeout = "120s"

[search.vector.chunk]
size = 800
overlap = 80
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Search.Vector.WorkerCount != 1 {
		t.Fatalf("worker_count = %d, want 1", cfg.Search.Vector.WorkerCount)
	}
	if cfg.Search.Vector.Embedder.Timeout != "120s" {
		t.Fatalf("embedder timeout = %q, want 120s", cfg.Search.Vector.Embedder.Timeout)
	}
	if cfg.Search.Vector.Chunk.Size != 800 || cfg.Search.Vector.Chunk.Overlap != 80 {
		t.Fatalf("chunk = %d/%d, want 800/80", cfg.Search.Vector.Chunk.Size, cfg.Search.Vector.Chunk.Overlap)
	}
}

func TestEmbedderConfigResolvedProvider(t *testing.T) {
	if got := (EmbedderConfig{Provider: "openai"}).ResolvedProvider(); got != "openai" {
		t.Fatalf("provider wins: got %q", got)
	}
	if got := (EmbedderConfig{Provider: "openai", Type: "onnx"}).ResolvedProvider(); got != "openai" {
		t.Fatalf("provider wins over type: got %q", got)
	}
	if got := (EmbedderConfig{Type: "onnx"}).ResolvedProvider(); got != "onnx" {
		t.Fatalf("type alias: got %q", got)
	}
	if got := (EmbedderConfig{}).ResolvedProvider(); got != "" {
		t.Fatalf("empty: got %q", got)
	}
}

func TestEmbedderProviderWinsOverTypeOnLoad(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[search.vector.embedder]
provider = "openai"
type = "onnx"
model = "text-embedding-3-small"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.Search.Vector.Embedder.Provider; got != "openai" {
		t.Fatalf("provider = %q, want openai (provider wins over type alias)", got)
	}
}

func TestONNXEmbedderTypeAlias(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[search.vector.embedder]
type = "onnx"
model_path = "/models/all-MiniLM-L6-v2/onnx/model.onnx"
tokenizer_path = "/models/all-MiniLM-L6-v2/tokenizer.json"
dimensions = 384
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Search.Vector.Embedder.Provider != "onnx" {
		t.Fatalf("provider = %q, want onnx", cfg.Search.Vector.Embedder.Provider)
	}
}

func TestONNXEmbedderTypeAliasIssue102Minimal(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	// Matches issue #102 acceptance config (type alias, model_path only).
	body := `
[search.vector.embedder]
type = "onnx"
model_path = "~/.kiwi/models/all-MiniLM-L6-v2/onnx/model.onnx"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	emb := cfg.Search.Vector.Embedder
	if emb.Provider != "onnx" {
		t.Fatalf("provider = %q, want onnx from type alias", emb.Provider)
	}
	if emb.ModelPath != "~/.kiwi/models/all-MiniLM-L6-v2/onnx/model.onnx" {
		t.Fatalf("model_path = %q", emb.ModelPath)
	}
	if emb.TokenizerPath != "" {
		t.Fatalf("tokenizer_path should be empty in config, got %q", emb.TokenizerPath)
	}
}

func TestONNXEmbedderTOML(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[search.vector.embedder]
provider = "onnx"
model_path = "/models/multilingual-e5-small/onnx/model.onnx"
tokenizer_path = "/models/multilingual-e5-small/onnx/tokenizer.json"
runtime_path = "/opt/onnxruntime/lib/libonnxruntime.so.1.25.0"
dimensions = 384
max_tokens = 512
pooling = "mean"
normalize = true
query_prefix = "query: "
passage_prefix = "passage: "
input_ids_name = "input_ids"
attention_name = "attention_mask"
output_name = "last_hidden_state"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	emb := cfg.Search.Vector.Embedder
	if emb.Provider != "onnx" || emb.ModelPath == "" || emb.TokenizerPath == "" {
		t.Fatalf("onnx paths not loaded: %+v", emb)
	}
	if emb.RuntimePath == "" || emb.Dimensions != 384 || emb.MaxTokens != 512 {
		t.Fatalf("onnx runtime/dimension fields not loaded: %+v", emb)
	}
	if emb.Normalize == nil || !*emb.Normalize {
		t.Fatalf("normalize = %v, want true", emb.Normalize)
	}
	if emb.QueryPrefix != "query: " || emb.PassagePrefix != "passage: " {
		t.Fatalf("prefixes = %q/%q", emb.QueryPrefix, emb.PassagePrefix)
	}
}

func TestLoadValidateWriteRules(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[[validate_write]]
name = "append-only"
match = { frontmatter = "append_only", value = "true" }
reject = "overwrite"
message = "This file is append-only."

[[validate_write]]
name = "immutable-after-status"
match = { frontmatter = "status", values = ["accepted", "deprecated"] }
reject = "body_change"
message = "Accepted decisions cannot be edited."
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(cfg.ValidateWriteRules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(cfg.ValidateWriteRules))
	}
	if cfg.ValidateWriteRules[0].Name != "append-only" || cfg.ValidateWriteRules[0].Reject != "overwrite" {
		t.Fatalf("first rule: %+v", cfg.ValidateWriteRules[0])
	}
	if cfg.ValidateWriteRules[1].Match.Values[0] != "accepted" {
		t.Fatalf("second rule values: %+v", cfg.ValidateWriteRules[1].Match)
	}
}

func TestUIConfigCustomCSS(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui]
custom_css = ".kiwi/brand.css"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.UI.CustomCSS != ".kiwi/brand.css" {
		t.Fatalf("want custom_css path, got %q", cfg.UI.CustomCSS)
	}
}

func TestUIConfigStartPage(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui]
start_page = "recent"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.UI.StartPage != "recent" {
		t.Fatalf("start_page = %q", cfg.UI.StartPage)
	}
	if cfg.UI.ResolvedStartPage() != "recent" {
		t.Fatalf("resolved = %q", cfg.UI.ResolvedStartPage())
	}

	empty := UIConfig{}
	if empty.ResolvedStartPage() != "welcome" {
		t.Fatalf("empty should default to welcome, got %q", empty.ResolvedStartPage())
	}
}

func TestUIConfigKeybindings(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui]
keybindings_file = ".kiwi/keys.json"

[ui.keybindings]
search = "Ctrl+J"
new_page = "Ctrl+Shift+N"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.UI.KeybindingsFile != ".kiwi/keys.json" {
		t.Fatalf("want keybindings_file path, got %q", cfg.UI.KeybindingsFile)
	}
	if cfg.UI.Keybindings["search"] != "Ctrl+J" {
		t.Fatalf("search binding = %q", cfg.UI.Keybindings["search"])
	}
}
