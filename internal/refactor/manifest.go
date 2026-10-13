// Package refactor restructures a workspace in one reviewable step: move
// pages and folders, merge pages, and drop the folders that end up empty,
// while every reference to a moved page keeps pointing at it.
//
// A Manifest says what should move. BuildPlan turns it into a Plan without
// touching the disk: the new content of every affected file, the comment
// and personal-state files to migrate, and a check that every link which
// resolved before still resolves to the same page afterwards. Applying the
// plan is the pipeline's job (pipeline.ApplyRefactor), so writes, commits
// and reindexing go through the same path as any other edit.
package refactor

import (
	"bytes"
	"fmt"
	"path"
	"strings"

	"gopkg.in/yaml.v3"
)

// Manifest is the requested restructuring, usually written as YAML:
//
//	moves:
//	  - from: guides/old-name.md          # one file
//	    to:   guides/new-name.md
//	  - from: drafts/                     # a folder and everything in it
//	    to:   archive/drafts/
//	  - from: notes/*-meeting.md          # a glob, into a folder
//	    to:   meetings/
//	merges:
//	  - from: faq/duplicate.md            # deleted; its links, comments and
//	    into: faq/canonical.md            # state now belong to the target
//	delete_empty_dirs: true
type Manifest struct {
	Moves           []Move  `json:"moves,omitempty" yaml:"moves"`
	Merges          []Merge `json:"merges,omitempty" yaml:"merges"`
	DeleteEmptyDirs bool    `json:"delete_empty_dirs,omitempty" yaml:"delete_empty_dirs"`
}

// Move relocates a file, a folder, or the files matching a glob. A To that
// ends in "/" names a destination folder that keeps each file's name.
type Move struct {
	From string `json:"from" yaml:"from"`
	To   string `json:"to" yaml:"to"`
}

// Merge deletes From and sends everything that pointed at it to Into.
// Combining the two bodies is an editorial decision, so Into's content is
// left as it is: write the merged page first, then run the merge. Into may
// name a page by its current path or by the path a move in the same
// manifest gives it.
type Merge struct {
	From string `json:"from" yaml:"from"`
	Into string `json:"into" yaml:"into"`
}

// ParseManifest reads a manifest from YAML or JSON. Unknown keys are an
// error, so a typo cannot silently drop part of a restructuring.
func ParseManifest(data []byte) (*Manifest, error) {
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	if len(m.Moves) == 0 && len(m.Merges) == 0 {
		return nil, fmt.Errorf("manifest has no moves or merges")
	}
	return &m, nil
}

// cleanPath normalizes a workspace-relative path from a manifest. dir keeps
// a trailing slash, which marks a destination folder.
func cleanPath(p string) (clean string, dir bool, err error) {
	raw := strings.TrimSpace(p)
	if raw == "" {
		return "", false, fmt.Errorf("empty path")
	}
	dir = strings.HasSuffix(raw, "/")
	raw = strings.TrimLeft(raw, "/")
	for _, seg := range strings.Split(strings.TrimSuffix(raw, "/"), "/") {
		if seg == ".." {
			return "", false, fmt.Errorf("%q leaves the workspace", p)
		}
		if strings.HasPrefix(seg, ".") && seg != "." {
			return "", false, fmt.Errorf("%q is inside a hidden folder", p)
		}
	}
	clean = path.Clean(raw)
	if clean == "." {
		return "", dir, nil
	}
	return clean, dir, nil
}
