package spaces

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/config"
)

func minimalCfg() *config.Config {
	return &config.Config{
		Versioning: config.VersioningConfig{Strategy: "none"},
		Search:     config.SearchConfig{Engine: "grep"},
	}
}

func TestAddSpaceAndList(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()

	if err := m.AddSpace("alpha", dir, minimalCfg()); err != nil {
		t.Fatalf("AddSpace(alpha): %v", err)
	}
	dir2 := t.TempDir()
	if err := m.AddSpace("beta", dir2, minimalCfg()); err != nil {
		t.Fatalf("AddSpace(beta): %v", err)
	}
	defer m.Close()

	names := m.ListSpaces()
	if len(names) != 2 || names[0] != "alpha" || names[1] != "beta" {
		t.Fatalf("ListSpaces = %v, want [alpha beta]", names)
	}
}

func TestAddSpaceDuplicateRejects(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()

	if err := m.AddSpace("dup", dir, minimalCfg()); err != nil {
		t.Fatalf("first AddSpace: %v", err)
	}
	defer m.Close()

	if err := m.AddSpace("dup", dir, minimalCfg()); err == nil {
		t.Fatal("duplicate AddSpace should fail")
	}
}

func TestGetSpace(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()
	if err := m.AddSpace("one", dir, minimalCfg()); err != nil {
		t.Fatalf("AddSpace: %v", err)
	}
	defer m.Close()

	if sp, ok := m.GetSpace("one"); !ok || sp == nil {
		t.Fatal("GetSpace(one) should succeed")
	}
	if _, ok := m.GetSpace("nonexistent"); ok {
		t.Fatal("GetSpace(nonexistent) should fail")
	}
}

func TestResolveSpaceDefaultsToFirst(t *testing.T) {
	m := NewManager(nil)
	dir1 := t.TempDir()
	dir2 := t.TempDir()
	m.AddSpace("first", dir1, minimalCfg())
	m.AddSpace("second", dir2, minimalCfg())
	defer m.Close()

	r := &http.Request{URL: &url.URL{Path: "/api/kiwi/tree"}}
	sp := m.resolveSpace(r)
	if sp == nil || sp.Name != "first" {
		t.Fatalf("resolveSpace default = %v, want first", sp)
	}
}

func TestResolveSpaceByName(t *testing.T) {
	m := NewManager(nil)
	dir1 := t.TempDir()
	dir2 := t.TempDir()
	m.AddSpace("alpha", dir1, minimalCfg())
	m.AddSpace("beta", dir2, minimalCfg())
	defer m.Close()

	r := &http.Request{URL: &url.URL{Path: "/api/kiwi/beta/tree"}}
	sp := m.resolveSpace(r)
	if sp == nil || sp.Name != "beta" {
		t.Fatalf("resolveSpace(beta) = %v, want beta", sp)
	}
	if r.URL.Path != "/api/kiwi/tree" {
		t.Fatalf("path rewrite = %s, want /api/kiwi/tree", r.URL.Path)
	}
}

func TestResolveSpaceByHeader(t *testing.T) {
	m := NewManager(nil)
	dir1 := t.TempDir()
	dir2 := t.TempDir()
	m.AddSpace("alpha", dir1, minimalCfg())
	m.AddSpace("beta", dir2, minimalCfg())
	defer m.Close()

	r := &http.Request{
		Header: http.Header{"X-Kiwi-Space": []string{"beta"}},
		URL:    &url.URL{Path: "/api/kiwi/tree"},
	}
	sp := m.resolveSpace(r)
	if sp == nil || sp.Name != "beta" {
		t.Fatalf("resolveSpace(X-Kiwi-Space: beta) = %v, want beta", sp)
	}
	if r.URL.Path != "/api/kiwi/tree" {
		t.Fatalf("header dispatch should not rewrite path, got %s", r.URL.Path)
	}
}

func TestResolveSpaceHeaderTakesPrecedence(t *testing.T) {
	m := NewManager(nil)
	dir1 := t.TempDir()
	dir2 := t.TempDir()
	m.AddSpace("alpha", dir1, minimalCfg())
	m.AddSpace("beta", dir2, minimalCfg())
	defer m.Close()

	// Path says "alpha" but header says "beta" — header wins.
	r := &http.Request{
		Header: http.Header{"X-Kiwi-Space": []string{"beta"}},
		URL:    &url.URL{Path: "/api/kiwi/alpha/tree"},
	}
	sp := m.resolveSpace(r)
	if sp == nil || sp.Name != "beta" {
		t.Fatalf("header should take precedence over path, got %v", sp)
	}
}

func TestResolveSpaceHeaderUnknownReturnsNil(t *testing.T) {
	m := NewManager(nil)
	dir1 := t.TempDir()
	dir2 := t.TempDir()
	m.AddSpace("alpha", dir1, minimalCfg())
	m.AddSpace("beta", dir2, minimalCfg())
	defer m.Close()

	r := &http.Request{
		Header: http.Header{"X-Kiwi-Space": []string{"nonexistent"}},
		URL:    &url.URL{Path: "/api/kiwi/beta/tree"},
	}
	sp := m.resolveSpace(r)
	if sp != nil {
		t.Fatalf("unknown X-Kiwi-Space header should return nil, got %q", sp.Name)
	}
}

func TestResolveSpaceTrailingSlash(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()
	m.AddSpace("docs", dir, minimalCfg())
	defer m.Close()

	r := &http.Request{URL: &url.URL{Path: "/api/kiwi/docs"}}
	sp := m.resolveSpace(r)
	if sp == nil || sp.Name != "docs" {
		t.Fatalf("resolveSpace(docs no trailing slash) = %v, want docs", sp)
	}
}

func TestResolveSpaceEmpty(t *testing.T) {
	m := NewManager(nil)
	r := &http.Request{URL: &url.URL{Path: "/api/kiwi/tree"}}
	sp := m.resolveSpace(r)
	if sp != nil {
		t.Fatal("resolveSpace on empty manager should return nil")
	}
}

func TestHandlerHealthEndpoint(t *testing.T) {
	m := NewManager(nil)
	h := m.Handler()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("/health status = %d, want 200", rec.Code)
	}
}

func TestHandlerSpacesEndpoint(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()
	m.AddSpace("wiki", dir, minimalCfg())
	defer m.Close()

	h := m.Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/spaces", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("/api/spaces status = %d, want 200", rec.Code)
	}
}

func TestCloseSkipsRegisterServerSpaces(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()

	if err := m.AddSpace("built", dir, minimalCfg()); err != nil {
		t.Fatalf("AddSpace: %v", err)
	}
	m.RegisterServer("prebuilt", dir, nil)

	if err := m.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestListSpacesPreservesOrder(t *testing.T) {
	m := NewManager(nil)
	names := []string{"charlie", "alpha", "bravo"}
	for _, name := range names {
		dir := t.TempDir()
		m.AddSpace(name, dir, minimalCfg())
	}
	defer m.Close()

	got := m.ListSpaces()
	for i, want := range names {
		if got[i] != want {
			t.Fatalf("ListSpaces[%d] = %s, want %s", i, got[i], want)
		}
	}
}

// ─── HTTP handler tests for space CRUD ──────────────────────────────────────

func TestHTTPListInitTemplates(t *testing.T) {
	m := NewManager(nil)
	defer m.Close()
	h := m.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/init-templates", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/init-templates status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Templates []struct {
			ID          string `json:"id"`
			Label       string `json:"label"`
			Description string `json:"description"`
		} `json:"templates"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Templates) == 0 {
		t.Fatal("expected at least one init template")
	}
	foundMemory := false
	for _, tpl := range resp.Templates {
		if tpl.ID == "memory" {
			foundMemory = true
			if tpl.Label == "" {
				t.Fatal("memory template missing label")
			}
		}
	}
	if !foundMemory {
		t.Fatalf("memory template not found in %v", resp.Templates)
	}
}

func TestHTTPCreateSpaceWithTemplate(t *testing.T) {
	baseCfg := minimalCfg()
	baseCfg.Storage.Root = t.TempDir()
	m := NewManager(baseCfg)
	dir := t.TempDir()
	m.AddSpace("seed", dir, minimalCfg())
	defer m.Close()

	h := m.Handler()

	body := `{"name":"wikispace","template":"wiki"}`
	req := httptest.NewRequest(http.MethodPost, "/api/spaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/spaces status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, ".spaces", "wikispace", "welcome.md")); err != nil {
		t.Fatalf("wiki template should create welcome.md: %v", err)
	}
}

func TestHTTPCreateSpaceRejectsRoot(t *testing.T) {
	m := NewManager(minimalCfg())
	m.AddSpace("seed", t.TempDir(), minimalCfg())
	defer m.Close()

	target := t.TempDir()
	body := `{"name":"elsewhere","root":"` + target + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/spaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST with root status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(target, ".kiwi")); !os.IsNotExist(err) {
		t.Fatalf("POST with root must not initialise %s (stat .kiwi: %v)", target, err)
	}
}

func TestHTTPCreateSpace(t *testing.T) {
	baseCfg := minimalCfg()
	baseCfg.Storage.Root = t.TempDir()
	m := NewManager(baseCfg)
	dir := t.TempDir()
	m.AddSpace("seed", dir, minimalCfg())
	defer m.Close()

	h := m.Handler()

	body := `{"name":"newspace"}`
	req := httptest.NewRequest(http.MethodPost, "/api/spaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/spaces status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}

	var meta SpaceMeta
	if err := json.NewDecoder(rec.Body).Decode(&meta); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if meta.Name != "newspace" {
		t.Fatalf("created space name = %q, want %q", meta.Name, "newspace")
	}

	names := m.ListSpaces()
	found := false
	for _, n := range names {
		if n == "newspace" {
			found = true
		}
	}
	if !found {
		t.Fatalf("newspace not found in ListSpaces: %v", names)
	}
}

func TestHTTPCreateSpaceDuplicate(t *testing.T) {
	m := NewManager(minimalCfg())
	dir := t.TempDir()
	m.AddSpace("existing", dir, minimalCfg())
	defer m.Close()

	h := m.Handler()

	body := `{"name":"existing"}`
	req := httptest.NewRequest(http.MethodPost, "/api/spaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("POST duplicate status = %d, want 409; body: %s", rec.Code, rec.Body.String())
	}
}

func TestHTTPGetSpace(t *testing.T) {
	m := NewManager(nil)
	dir := t.TempDir()
	m.AddSpace("docs", dir, minimalCfg())
	defer m.Close()

	h := m.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/spaces/docs", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/spaces/docs status = %d, want 200", rec.Code)
	}

	var meta SpaceMeta
	if err := json.NewDecoder(rec.Body).Decode(&meta); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if meta.Name != "docs" {
		t.Fatalf("space name = %q, want %q", meta.Name, "docs")
	}
}

func TestHTTPGetSpaceNotFound(t *testing.T) {
	m := NewManager(nil)
	m.AddSpace("seed", t.TempDir(), minimalCfg())
	defer m.Close()
	h := m.Handler()

	req := httptest.NewRequest(http.MethodGet, "/api/spaces/nonexistent", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET nonexistent space status = %d, want 404", rec.Code)
	}
}

func TestHTTPDeleteSpace(t *testing.T) {
	m := NewManager(minimalCfg())
	m.AddSpace("seed", t.TempDir(), minimalCfg())
	defer m.Close()

	h := m.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/spaces", strings.NewReader(`{"name":"ephemeral"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/spaces status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/spaces/ephemeral", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE /api/spaces/ephemeral status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}

	if _, ok := m.GetSpace("ephemeral"); ok {
		t.Fatal("space should be removed after DELETE")
	}
}

func TestHTTPDeleteSpaceRefusesConfiguredSpaces(t *testing.T) {
	m := NewManager(nil)
	primary, configured := t.TempDir(), t.TempDir()
	m.AddSpace("primary", primary, minimalCfg())
	m.AddSpace("configured", configured, minimalCfg())
	defer m.Close()

	h := m.Handler()
	for _, name := range []string{"primary", "configured"} {
		req := httptest.NewRequest(http.MethodDelete, "/api/spaces/"+name, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("DELETE /api/spaces/%s status = %d, want 403; body: %s", name, rec.Code, rec.Body.String())
		}
		if _, ok := m.GetSpace(name); !ok {
			t.Fatalf("space %q should survive a refused DELETE", name)
		}
	}
	for _, dir := range []string{primary, configured} {
		if _, err := os.Stat(dir); err != nil {
			t.Fatalf("refused DELETE must leave %s in place: %v", dir, err)
		}
	}
}

func TestHTTPDeleteSpaceNotFound(t *testing.T) {
	m := NewManager(nil)
	m.AddSpace("seed", t.TempDir(), minimalCfg())
	defer m.Close()
	h := m.Handler()

	req := httptest.NewRequest(http.MethodDelete, "/api/spaces/ghost", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("DELETE nonexistent space status = %d, want 404", rec.Code)
	}
}

func TestHTTPSpacesRefuseWithoutAnySpace(t *testing.T) {
	h := NewManager(nil).Handler()
	for _, tc := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/spaces", ""},
		{http.MethodPost, "/api/spaces", `{"name":"x"}`},
		{http.MethodDelete, "/api/spaces/x", ""},
	} {
		req := httptest.NewRequest(tc.method, tc.target, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s with no space = %d, want 503", tc.method, tc.target, rec.Code)
		}
	}
}

func TestHTTPSpacesEnforcePrimaryAuth(t *testing.T) {
	perspace := minimalCfg()
	perspace.Auth = config.AuthConfig{Type: "perspace", APIKeys: []config.APIKeyEntry{
		{Key: "admin-key"},
		{Key: "write-key", Scope: "write"},
		{Key: "read-key", Scope: "read"},
		{Key: "prefix-key", Prefix: "public/"},
	}}
	apikey := minimalCfg()
	apikey.Auth = config.AuthConfig{Type: "apikey", APIKey: "k"}
	oidc := minimalCfg()
	oidc.Auth = config.AuthConfig{Type: "oidc"}

	type step struct {
		method, target, body, bearer string
		want                         int
	}
	cases := []struct {
		name  string
		cfg   *config.Config
		steps []step
	}{
		{"perspace", perspace, []step{
			{http.MethodGet, "/api/spaces", "", "", http.StatusUnauthorized},
			{http.MethodGet, "/api/spaces/primary", "", "", http.StatusUnauthorized},
			{http.MethodPost, "/api/spaces", `{"name":"anon"}`, "", http.StatusUnauthorized},
			{http.MethodDelete, "/api/spaces/primary", "", "", http.StatusUnauthorized},
			{http.MethodGet, "/api/spaces", "", "read-key", http.StatusOK},
			{http.MethodGet, "/api/spaces", "", "prefix-key", http.StatusOK},
			{http.MethodPost, "/api/spaces", `{"name":"ro"}`, "read-key", http.StatusForbidden},
			{http.MethodPost, "/api/spaces", `{"name":"scoped"}`, "prefix-key", http.StatusForbidden},
			{http.MethodPost, "/api/spaces", `{"name":"made"}`, "write-key", http.StatusCreated},
			{http.MethodDelete, "/api/spaces/made", "", "prefix-key", http.StatusForbidden},
			{http.MethodDelete, "/api/spaces/made", "", "admin-key", http.StatusOK},
		}},
		{"apikey", apikey, []step{
			{http.MethodGet, "/api/spaces", "", "", http.StatusUnauthorized},
			{http.MethodPost, "/api/spaces", `{"name":"anon"}`, "", http.StatusUnauthorized},
			{http.MethodPost, "/api/spaces", `{"name":"made"}`, "k", http.StatusCreated},
		}},
		{"oidc without issuer", oidc, []step{
			{http.MethodGet, "/api/spaces", "", "", http.StatusServiceUnavailable},
			{http.MethodPost, "/api/spaces", `{"name":"anon"}`, "", http.StatusServiceUnavailable},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := NewManager(tc.cfg)
			if err := m.AddSpace("primary", t.TempDir(), tc.cfg); err != nil {
				t.Fatal(err)
			}
			defer m.Close()
			h := m.Handler()
			for _, s := range tc.steps {
				req := httptest.NewRequest(s.method, s.target, strings.NewReader(s.body))
				req.Header.Set("Content-Type", "application/json")
				if s.bearer != "" {
					req.Header.Set("Authorization", "Bearer "+s.bearer)
				}
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)
				if rec.Code != s.want {
					t.Fatalf("%s %s as %q = %d, want %d; body: %s", s.method, s.target, s.bearer, rec.Code, s.want, rec.Body.String())
				}
				if strings.Contains(rec.Body.String(), `"root"`) {
					t.Fatalf("%s %s leaked a server path: %s", s.method, s.target, rec.Body.String())
				}
			}
		})
	}
}

func TestHTTPListSpacesReturnsAll(t *testing.T) {
	m := NewManager(nil)
	for _, name := range []string{"alpha", "beta", "gamma"} {
		m.AddSpace(name, t.TempDir(), minimalCfg())
	}
	defer m.Close()

	h := m.Handler()
	req := httptest.NewRequest(http.MethodGet, "/api/spaces", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/spaces status = %d, want 200", rec.Code)
	}

	var resp struct {
		Spaces []SpaceMeta `json:"spaces"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Spaces) != 3 {
		t.Fatalf("expected 3 spaces, got %d", len(resp.Spaces))
	}
	names := make([]string, len(resp.Spaces))
	for i, s := range resp.Spaces {
		names[i] = s.Name
	}
	want := []string{"alpha", "beta", "gamma"}
	for i, w := range want {
		if names[i] != w {
			t.Fatalf("space[%d] = %q, want %q", i, names[i], w)
		}
	}
}

func TestSignedRawURLIsScopedToItsSpace(t *testing.T) {
	cfg := minimalCfg()
	cfg.Auth = config.AuthConfig{Type: "apikey", APIKey: "k"}
	m := NewManager(nil)
	alphaDir, betaDir := t.TempDir(), t.TempDir()
	for dir, body := range map[string]string{alphaDir: "alpha-img", betaDir: "beta-img"} {
		if err := os.WriteFile(filepath.Join(dir, "img.png"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.AddSpace("alpha", alphaDir, cfg); err != nil {
		t.Fatal(err)
	}
	if err := m.AddSpace("beta", betaDir, cfg); err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	h := m.Handler()

	get := func(target, bearer string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := get("/api/kiwi/beta/raw-sign?path=img.png", "k")
	if rec.Code != http.StatusOK {
		t.Fatalf("raw-sign = %d: %s", rec.Code, rec.Body.String())
	}
	var signed struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &signed); err != nil {
		t.Fatal(err)
	}
	query := signed.URL[strings.Index(signed.URL, "?"):]

	if rec := get("/api/kiwi/beta/raw/img.png"+query, ""); rec.Code != http.StatusOK || rec.Body.String() != "beta-img" {
		t.Fatalf("beta signed GET = %d %q, want beta-img", rec.Code, rec.Body.String())
	}
	if rec := get("/api/kiwi/alpha/raw/img.png"+query, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("beta signature used on alpha = %d %q, want 403", rec.Code, rec.Body.String())
	}
	if rec := get("/api/kiwi/beta/raw/img.png", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned beta GET = %d, want 401", rec.Code)
	}
}

func TestResolveRoot(t *testing.T) {
	primary := "/data/problems"
	if got := ResolveRoot(primary, "/abs/other"); got != "/abs/other" {
		t.Fatalf("abs = %q", got)
	}
	if got := ResolveRoot(primary, ""); got != "" {
		t.Fatalf("empty = %q", got)
	}
	got := ResolveRoot(primary, "../system-design")
	want := "/data/system-design"
	if got != want {
		t.Fatalf("relative = %q, want %q", got, want)
	}
}

func TestFilterKeysForSpaceKeepsScopeAndPrefix(t *testing.T) {
	cfg := minimalCfg()
	cfg.Auth.Type = "perspace"
	cfg.Auth.APIKeys = []config.APIKeyEntry{
		{Key: "a-read", Space: "a", Actor: "alice", Scope: "read", Prefix: "docs/"},
		{Key: "b-admin", Space: "b"},
		{Key: "global", Scope: "write"},
	}
	got := FilterKeysForSpace(cfg, "a").Auth.APIKeys
	want := []config.APIKeyEntry{
		{Key: "a-read", Actor: "alice", Scope: "read", Prefix: "docs/"},
		{Key: "global", Scope: "write"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("key %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}
