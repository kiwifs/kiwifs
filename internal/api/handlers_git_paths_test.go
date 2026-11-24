package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kiwifs/kiwifs/internal/versioning"
)

func TestTimelineAndVelocity_NonASCIIPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not in PATH")
	}
	s, root := buildTestServerWithRoot(t)
	g, err := versioning.NewGit(root)
	if err != nil {
		t.Fatal(err)
	}
	const path = "日本/café.md"
	if err := os.MkdirAll(filepath.Join(root, "日本"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, path), []byte("body\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := g.Commit(context.Background(), path, "alice", "add page"); err != nil {
		t.Fatal(err)
	}

	get := func(endpoint string, out any) {
		t.Helper()
		target := "/api/kiwi/" + endpoint + "?path_prefix=" + url.QueryEscape("日本/")
		rec := httptest.NewRecorder()
		s.echo.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d: %s", endpoint, rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatal(err)
		}
	}

	var timeline timelineResponse
	get("timeline", &timeline)
	if len(timeline.Events) != 1 || timeline.Events[0].Path != path {
		t.Errorf("timeline events = %+v, want %s", timeline.Events, path)
	}

	var velocity struct {
		HotSpots  []velocityHotSpot  `json:"hot_spots"`
		ColdSpots []velocityColdSpot `json:"cold_spots"`
	}
	get("velocity", &velocity)
	if len(velocity.HotSpots) != 1 || velocity.HotSpots[0].Path != path {
		t.Errorf("hot spots = %+v, want %s", velocity.HotSpots, path)
	}
	if len(velocity.ColdSpots) != 0 {
		t.Errorf("cold spots = %+v, want none", velocity.ColdSpots)
	}
}
