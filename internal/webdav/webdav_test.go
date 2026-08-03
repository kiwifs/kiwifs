package webdav

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/events"
	"github.com/kiwifs/kiwifs/internal/pipeline"
	"github.com/kiwifs/kiwifs/internal/search"
	"github.com/kiwifs/kiwifs/internal/storage"
	"github.com/kiwifs/kiwifs/internal/versioning"
)

func newWebDAVTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()

	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	pipe := pipeline.New(store, versioning.NewNoop(), search.NewGrep(root), nil, events.NewHub(), nil, root)
	srv := httptest.NewServer(New(root, pipe, "test", "").Handler("/dav"))
	t.Cleanup(srv.Close)
	return srv, root
}

func doWebDAV(t *testing.T, srv *httptest.Server, method, path, body string, headers map[string]string) (int, string, http.Header) {
	t.Helper()

	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s body: %v", method, path, err)
	}
	return resp.StatusCode, string(data), resp.Header
}

func assertStatus(t *testing.T, method, path string, got int, wants ...int) {
	t.Helper()
	for _, want := range wants {
		if got == want {
			return
		}
	}
	t.Fatalf("%s %s: status %d, want one of %v", method, path, got, wants)
}

type propfindResponse struct {
	Href string `xml:"href"`
}

type propfindMultistatus struct {
	Responses []propfindResponse `xml:"response"`
}

func propfindHrefs(t *testing.T, body string) []string {
	t.Helper()

	var out propfindMultistatus
	if err := xml.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("PROPFIND XML: %v\n%s", err, body)
	}
	hrefs := make([]string, 0, len(out.Responses))
	for _, resp := range out.Responses {
		hrefs = append(hrefs, resp.Href)
	}
	return hrefs
}

func assertHasHref(t *testing.T, hrefs []string, suffix string) {
	t.Helper()
	for _, href := range hrefs {
		if strings.HasSuffix(href, suffix) {
			return
		}
	}
	t.Fatalf("missing href ending in %q from %v", suffix, hrefs)
}

func TestRequestActorContext(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	hub := events.NewHub()
	pipe := pipeline.New(store, versioning.NewNoop(), search.NewGrep(root), nil, hub, nil, root)
	fs := New(root, pipe, "webdav", "")
	messages, err := hub.Subscribe()
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer hub.Unsubscribe(messages)

	assertActor := func(want string) {
		t.Helper()
		msg := <-messages
		var event events.Event
		if err := json.Unmarshal(msg.Data, &event); err != nil {
			t.Fatalf("decode event: %v", err)
		}
		if event.Actor != want {
			t.Fatalf("actor = %q, want %q", event.Actor, want)
		}
	}

	ctx := context.WithValue(context.Background(), actorContextKey{}, "writer")
	file, err := fs.OpenFile(ctx, "note.md", os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := file.Write([]byte("hello")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	assertActor("writer")

	ctx = context.WithValue(context.Background(), actorContextKey{}, "")
	if err := fs.RemoveAll(ctx, "note.md"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	assertActor("webdav")
}

func TestWithActorAddsActorToContext(t *testing.T) {
	t.Run("header present", func(t *testing.T) {
		fs := &FS{}
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			actor, ok := r.Context().Value(actorContextKey{}).(string)
			if !ok || actor != "writer" {
				t.Fatalf("actor context = %q, %v; want %q, true", actor, ok, "writer")
			}
			w.WriteHeader(http.StatusNoContent)
		})
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Actor", "writer")
		rec := httptest.NewRecorder()
		fs.withActor(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
	})

	t.Run("header absent", func(t *testing.T) {
		fs := &FS{}
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := r.Context().Value(actorContextKey{}).(string); ok {
				t.Fatal("actor context should be unset when X-Actor is absent")
			}
			w.WriteHeader(http.StatusNoContent)
		})
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		fs.withActor(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
	})
}

func TestWebDAVPROPFINDListsRootEntries(t *testing.T) {
	srv, root := newWebDAVTestServer(t)
	if err := os.Mkdir(filepath.Join(root, "docs"), 0755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "readme.md"), []byte("# Readme\n"), 0644); err != nil {
		t.Fatalf("write readme: %v", err)
	}

	status, body, _ := doWebDAV(t, srv, "PROPFIND", "/dav/", `<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>`, map[string]string{
		"Depth":        "1",
		"Content-Type": `application/xml; charset="utf-8"`,
	})

	assertStatus(t, "PROPFIND", "/dav/", status, http.StatusMultiStatus)
	hrefs := propfindHrefs(t, body)
	assertHasHref(t, hrefs, "/dav/docs/")
	assertHasHref(t, hrefs, "/dav/readme.md")
}

func TestWebDAVPUTWritesFile(t *testing.T) {
	srv, root := newWebDAVTestServer(t)
	if err := os.Mkdir(filepath.Join(root, "notes"), 0755); err != nil {
		t.Fatalf("mkdir notes: %v", err)
	}

	status, _, _ := doWebDAV(t, srv, http.MethodPut, "/dav/notes/first.md", "hello from webdav\n", nil)

	assertStatus(t, http.MethodPut, "/dav/notes/first.md", status, http.StatusCreated, http.StatusNoContent)
	data, err := os.ReadFile(filepath.Join(root, "notes", "first.md"))
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if string(data) != "hello from webdav\n" {
		t.Fatalf("file content = %q", data)
	}
}

func TestWebDAVGETReadsFile(t *testing.T) {
	srv, root := newWebDAVTestServer(t)
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("stored content\n"), 0644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	status, body, _ := doWebDAV(t, srv, http.MethodGet, "/dav/note.md", "", nil)

	assertStatus(t, http.MethodGet, "/dav/note.md", status, http.StatusOK)
	if body != "stored content\n" {
		t.Fatalf("GET body = %q", body)
	}
}

func TestWebDAVMKCOLCreatesDirectory(t *testing.T) {
	srv, root := newWebDAVTestServer(t)

	status, _, _ := doWebDAV(t, srv, "MKCOL", "/dav/projects", "", nil)

	assertStatus(t, "MKCOL", "/dav/projects", status, http.StatusCreated)
	info, err := os.Stat(filepath.Join(root, "projects"))
	if err != nil {
		t.Fatalf("stat created directory: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("created path is not a directory")
	}
}

func TestWebDAVDELETERemovesFile(t *testing.T) {
	srv, root := newWebDAVTestServer(t)
	path := filepath.Join(root, "old.md")
	if err := os.WriteFile(path, []byte("remove me\n"), 0644); err != nil {
		t.Fatalf("write old file: %v", err)
	}

	status, _, _ := doWebDAV(t, srv, http.MethodDelete, "/dav/old.md", "", nil)

	assertStatus(t, http.MethodDelete, "/dav/old.md", status, http.StatusNoContent, http.StatusOK)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("deleted file still exists, stat err=%v", err)
	}
}
