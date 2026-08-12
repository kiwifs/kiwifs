package cmd

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// runReindex used to build the index without consulting config.toml, so a
// rebuild silently dropped every typed link the running server would have
// indexed — including the defaults.
func TestRunReindex_IndexesConfiguredTypedLinks(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "source.md"), `---
title: Source
related-notes: [target]
---

# Source
`)
	mustWrite(t, filepath.Join(root, "target.md"), "---\ntitle: Target\n---\n\n# Target\n")

	if err := os.MkdirAll(filepath.Join(root, ".kiwi"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, ".kiwi", "config.toml"), `[storage]
root = "."

[search]
engine = "sqlite"

[links]
typed_fields = ["related-notes"]
`)

	relations := reindexAndReadRelations(t, root)
	if relations["related-notes"] != 1 {
		t.Fatalf("expected the configured typed link to be indexed, got relations %v", relations)
	}
}

func TestRunReindex_IndexesDefaultTypedLinksWithoutConfig(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "source.md"), `---
title: Source
contradicts: [target]
---

# Source
`)
	mustWrite(t, filepath.Join(root, "target.md"), "---\ntitle: Target\n---\n\n# Target\n")

	relations := reindexAndReadRelations(t, root)
	if relations["contradicts"] != 1 {
		t.Fatalf("expected the default typed link to be indexed, got relations %v", relations)
	}
}

func reindexAndReadRelations(t *testing.T, root string) map[string]int {
	t.Helper()

	args := []string{"--root", root}
	reindexCmd.SetContext(context.Background())
	reindexCmd.SetArgs(args)
	if err := reindexCmd.ParseFlags(args); err != nil {
		t.Fatalf("parse flags: %v", err)
	}
	if err := runReindex(reindexCmd, nil); err != nil {
		t.Fatalf("reindex: %v", err)
	}

	db, err := sql.Open("sqlite", filepath.Join(root, ".kiwi", "state", "search.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	rows, err := db.Query(`SELECT relation, COUNT(*) FROM links GROUP BY relation`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	out := map[string]int{}
	for rows.Next() {
		var relation string
		var n int
		if err := rows.Scan(&relation, &n); err != nil {
			t.Fatal(err)
		}
		out[relation] = n
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
