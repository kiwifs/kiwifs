package config

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kiwifs/kiwifs/internal/links"
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

func TestVectorChunkContextTOML(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[search.vector.chunk]
context_template = "{{ .Title }} > {{ .Headings }}"
context_hook_url = "http://127.0.0.1:8099/context"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got, want := cfg.Search.Vector.Chunk.ContextTemplate, "{{ .Title }} > {{ .Headings }}"; got != want {
		t.Fatalf("context_template = %q, want %q", got, want)
	}
	if got, want := cfg.Search.Vector.Chunk.ContextHookURL, "http://127.0.0.1:8099/context"; got != want {
		t.Fatalf("context_hook_url = %q, want %q", got, want)
	}
	// Unset must stay empty so the vectorstore falls back to its own default
	// rather than config baking a duplicate copy of the template string.
	if (VectorChunkConfig{}).ContextTemplate != "" {
		t.Fatal("zero-value ContextTemplate should be empty")
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

func TestLoadSequencesConfig(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[sequences]
directories = ["events/", "audit/"]
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(cfg.Sequences.Directories) != 2 {
		t.Fatalf("directories = %v", cfg.Sequences.Directories)
	}
	if cfg.Sequences.Directories[0] != "events/" || cfg.Sequences.Directories[1] != "audit/" {
		t.Fatalf("directories = %v", cfg.Sequences.Directories)
	}
}

func TestLoadFormatHooksAutoSequence(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[format_hooks.auto_sequence]
directory = "decisions/"
field = "adr_number"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.FormatHooks.AutoSequence.Directory != "decisions/" {
		t.Fatalf("directory = %q", cfg.FormatHooks.AutoSequence.Directory)
	}
	if cfg.FormatHooks.AutoSequence.Field != "adr_number" {
		t.Fatalf("field = %q", cfg.FormatHooks.AutoSequence.Field)
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

func TestUIConfigSidebar(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui.sidebar]
pinned = ["index.md", "team/handbook.md"]
hidden = [".kiwi", "templates", "_archive"]

[[ui.sidebar.sections]]
label = "Core"
paths = ["architecture/", "api/"]

[[ui.sidebar.sections]]
label = "Team"
paths = ["team/", "onboarding/"]
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(cfg.UI.Sidebar.Pinned) != 2 {
		t.Fatalf("pinned = %+v", cfg.UI.Sidebar.Pinned)
	}
	if len(cfg.UI.Sidebar.Hidden) != 3 {
		t.Fatalf("hidden = %+v", cfg.UI.Sidebar.Hidden)
	}
	sections := cfg.UI.Sidebar.ResolvedSections()
	if len(sections) != 2 || sections[0].Label != "Core" {
		t.Fatalf("sections = %+v", sections)
	}
}

func TestUIConfigSidebarResolvedSectionsSkipsEmptyLabels(t *testing.T) {
	cfg := UISidebarConfig{
		Sections: []UISidebarSectionConfig{
			{Label: "Core", Paths: []string{"architecture/"}},
			{Label: "  ", Paths: []string{"skip/"}},
			{Label: "", Paths: []string{"also-skip/"}},
		},
	}
	sections := cfg.ResolvedSections()
	if len(sections) != 1 || sections[0].Label != "Core" {
		t.Fatalf("sections = %+v", sections)
	}
}

func TestUIToolbarViewsTOML(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui.toolbar]
views = ["kanban", "graph", "bases"]
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	want := []string{"kanban", "graph", "bases"}
	if len(cfg.UI.Toolbar.Views) != len(want) {
		t.Fatalf("views = %v, want %v", cfg.UI.Toolbar.Views, want)
	}
	for i, v := range want {
		if cfg.UI.Toolbar.Views[i] != v {
			t.Fatalf("views[%d] = %q, want %q", i, cfg.UI.Toolbar.Views[i], v)
		}
	}
}

func TestUIToolbarViewsUnset(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui]
theme_locked = true
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.UI.Toolbar.Views != nil {
		t.Fatalf("views should be nil when unset, got %v", cfg.UI.Toolbar.Views)
	}
}

func TestLoadUITags(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui.tags]
banner = ["difficulty", "tags", "companies"]
hide = ["freq"]

[ui.tags.colors]
easy = "emerald"
google = "#4285F4"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	got := cfg.UI.Tags.ResolvedBanner()
	want := []string{"difficulty", "tags", "companies"}
	if len(got) != len(want) {
		t.Fatalf("banner = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("banner = %v, want %v", got, want)
		}
	}
	if len(cfg.UI.Tags.Hide) != 1 || cfg.UI.Tags.Hide[0] != "freq" {
		t.Fatalf("hide = %v", cfg.UI.Tags.Hide)
	}
	if cfg.UI.Tags.Colors["easy"] != "emerald" || cfg.UI.Tags.Colors["google"] != "#4285F4" {
		t.Fatalf("colors = %v", cfg.UI.Tags.Colors)
	}
}

func TestUITagsResolvedBannerDefault(t *testing.T) {
	empty := UITagsConfig{}
	got := empty.ResolvedBanner()
	if len(got) != 1 || got[0] != "tags" {
		t.Fatalf("default banner = %v, want [tags]", got)
	}
	explicit := UITagsConfig{Banner: []string{}}
	if len(explicit.ResolvedBanner()) != 0 {
		t.Fatalf("empty banner should stay empty, got %v", explicit.ResolvedBanner())
	}
}

func TestLoadUIBranding(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[ui.branding]
name = "Acme Knowledge Base"
logo_url = ".kiwi/assets/logo.png"
favicon_url = ".kiwi/assets/favicon.svg"
welcome_title = "Welcome to Acme KB"
welcome_message = "Search or create a page to get started."
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	b := cfg.UI.Branding
	if b.Name != "Acme Knowledge Base" {
		t.Fatalf("name = %q", b.Name)
	}
	if b.LogoURL != ".kiwi/assets/logo.png" {
		t.Fatalf("logo_url = %q", b.LogoURL)
	}
	if b.FaviconURL != ".kiwi/assets/favicon.svg" {
		t.Fatalf("favicon_url = %q", b.FaviconURL)
	}
	if b.WelcomeTitle != "Welcome to Acme KB" {
		t.Fatalf("welcome_title = %q", b.WelcomeTitle)
	}
	if b.WelcomeMessage != "Search or create a page to get started." {
		t.Fatalf("welcome_message = %q", b.WelcomeMessage)
	}
}

func TestBrandingConfigResolved(t *testing.T) {
	custom := BrandingConfig{
		Name:           "Acme",
		LogoURL:        ".kiwi/assets/logo.png",
		FaviconURL:     "https://cdn.example/favicon.ico",
		WelcomeTitle:   "Hi",
		WelcomeMessage: "Go.",
	}
	if custom.ResolvedName() != "Acme" {
		t.Fatalf("ResolvedName = %q", custom.ResolvedName())
	}
	if custom.ResolvedLogoURL() != "/raw/.kiwi/assets/logo.png" {
		t.Fatalf("ResolvedLogoURL = %q", custom.ResolvedLogoURL())
	}
	if custom.ResolvedFaviconURL() != "https://cdn.example/favicon.ico" {
		t.Fatalf("ResolvedFaviconURL = %q", custom.ResolvedFaviconURL())
	}
	if custom.ResolvedWelcomeTitle() != "Hi" {
		t.Fatalf("ResolvedWelcomeTitle = %q", custom.ResolvedWelcomeTitle())
	}
	if custom.ResolvedWelcomeMessage() != "Go." {
		t.Fatalf("ResolvedWelcomeMessage = %q", custom.ResolvedWelcomeMessage())
	}
	if !custom.HasCustomLogo() {
		t.Fatal("expected HasCustomLogo")
	}

	empty := BrandingConfig{}
	if empty.ResolvedName() != DefaultBrandingName {
		t.Fatalf("default name = %q", empty.ResolvedName())
	}
	if empty.ResolvedLogoURL() != DefaultBrandingLogoURL {
		t.Fatalf("default logo = %q", empty.ResolvedLogoURL())
	}
	if empty.ResolvedFaviconURL() != DefaultBrandingFaviconURL {
		t.Fatalf("default favicon = %q", empty.ResolvedFaviconURL())
	}
	if empty.ResolvedWelcomeTitle() != DefaultBrandingWelcomeTitle {
		t.Fatalf("default welcome title = %q", empty.ResolvedWelcomeTitle())
	}
	if empty.ResolvedWelcomeMessage() != DefaultBrandingWelcomeMessage {
		t.Fatalf("default welcome message = %q", empty.ResolvedWelcomeMessage())
	}
	if empty.HasCustomLogo() {
		t.Fatal("expected no custom logo")
	}
}

func TestResolveBrandingAssetURL(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"/logo.png", "/logo.png"},
		{"https://cdn.example/logo.png", "https://cdn.example/logo.png"},
		{".kiwi/assets/logo.png", "/raw/.kiwi/assets/logo.png"},
		{"./pages/logo.png", "/raw/pages/logo.png"},
	}
	for _, tc := range cases {
		if got := ResolveBrandingAssetURL(tc.in); got != tc.want {
			t.Fatalf("ResolveBrandingAssetURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestLinksConfigTypedLinkFields(t *testing.T) {
	t.Parallel()
	wantDefault := links.DefaultTypedLinkFields()
	if got := (LinksConfig{}).TypedLinkFields(); !reflect.DeepEqual(got, wantDefault) {
		t.Fatalf("default: got %+v want %+v", got, wantDefault)
	}
	cfg := LinksConfig{TypedFields: []string{"cites", "extends"}}
	if got := cfg.TypedLinkFields(); len(got) != 2 || got[0] != "cites" || got[1] != "extends" {
		t.Fatalf("configured: %+v", got)
	}
	cfg = LinksConfig{TypedFields: []string{"cites", "bad;DROP", "extends"}}
	if got := cfg.TypedLinkFields(); len(got) != 2 || got[0] != "cites" || got[1] != "extends" {
		t.Fatalf("sanitized: %+v", got)
	}
}

func TestLoadLinksTypedFields(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[links]
typed_fields = ["supersedes", "cites"]
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	want := []string{"supersedes", "cites"}
	if len(cfg.Links.TypedFields) != len(want) {
		t.Fatalf("got %+v want %+v", cfg.Links.TypedFields, want)
	}
	for i := range want {
		if cfg.Links.TypedFields[i] != want[i] {
			t.Fatalf("got %+v want %+v", cfg.Links.TypedFields, want)
		}
	}
}

func TestUIConfigEditorSlashCommands(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[[ui.editor.slash_commands]]
id = "adr"
label = "ADR"
icon = "FileCheck"
description = "Insert ADR template"
template = "templates/adr.md"

[[ui.editor.slash_commands]]
id = "runbook"
label = "Runbook Step"
icon = "Zap"
description = "Insert runbook step block"
template = "templates/runbook-step.md"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(cfg.UI.Editor.SlashCommands) != 2 {
		t.Fatalf("slash_commands = %+v", cfg.UI.Editor.SlashCommands)
	}
	if cfg.UI.Editor.SlashCommands[0].ID != "adr" || cfg.UI.Editor.SlashCommands[0].Template != "templates/adr.md" {
		t.Fatalf("first command = %+v", cfg.UI.Editor.SlashCommands[0])
	}
	if cfg.UI.Editor.SlashCommands[1].Icon != "Zap" {
		t.Fatalf("second command = %+v", cfg.UI.Editor.SlashCommands[1])
	}
}

func TestLoadJanitorExecutionStaleness(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	body := `
[janitor.execution_staleness]
directory = "runbooks/"
date_field = "last_executed"
max_age_days = 90

[janitor.execution_staleness.flag_values]
last_outcome = "failure"
`
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(body), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	es := cfg.Janitor.ExecutionStaleness
	if !es.Enabled() {
		t.Fatal("expected execution staleness enabled")
	}
	if es.Directory != "runbooks/" || es.DateField != "last_executed" || es.MaxAgeDays != 90 {
		t.Fatalf("unexpected config: %+v", es)
	}
	if es.FlagValues["last_outcome"] != "failure" {
		t.Fatalf("flag_values = %+v", es.FlagValues)
	}
}

func TestLoadJanitorExecutionStalenessDisabledByDefault(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, ".kiwi")
	_ = os.MkdirAll(cfgDir, 0755)
	_ = os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte("[janitor]\nstale_days = 90\n"), 0644)
	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Janitor.ExecutionStaleness.Enabled() {
		t.Fatal("expected execution staleness disabled when section omitted")
	}
}
