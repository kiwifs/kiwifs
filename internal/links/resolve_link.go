package links

import (
	"regexp"
	"sort"
	"strings"
)

// This file implements directory-aware wiki-link resolution, matching the
// TypeScript resolver in ui/src/lib/wikiLinks.ts. Rendering (frontend),
// backlinks, and the graph must agree on where a [[link]] points, so the two
// implementations share one algorithm and one test fixture (see
// resolve_link_test.go and wikiLinks.test.ts).
//
// Resolution takes the *source* page (fromPath) so links resolve relative to
// where they were written, mirroring Obsidian's getFirstLinkpathDest:
//
//	[[./sibling]] / [[../up/note]] → explicit-relative to the source dir
//	[[/folder/note]]               → vault-absolute (leading slash)
//	[[folder/note]]                → absolute-from-root, then relative to the
//	                                 source dir, then a unique path suffix
//	[[note]]                       → unique basename; on collision prefer the
//	                                 source dir, then the shortest path, then
//	                                 lexicographically first
//
// A bare name matches only an exact (normalized) basename — there is no
// stem-prefix fuzzing.

var linkSepRe = regexp.MustCompile(`[-_\s]+`)

// normalizeLinkPath lowercases, drops a trailing .md, and collapses runs of
// -, _, and whitespace to a single hyphen. Slashes are preserved so path
// structure survives. Applied identically to file paths and link targets.
func normalizeLinkPath(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(s, ".md")
	s = linkSepRe.ReplaceAllString(s, "-")
	return s
}

func linkDir(p string) string {
	p = strings.TrimSuffix(p, "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return ""
}

func linkBase(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

// cleanRelPath resolves "." and ".." segments and drops empty ones, matching
// the UI's normalizePath helper (".." at the root is dropped, not preserved).
func cleanRelPath(p string) string {
	parts := strings.Split(p, "/")
	out := make([]string, 0, len(parts))
	for _, seg := range parts {
		switch seg {
		case "", ".":
			continue
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
		default:
			out = append(out, seg)
		}
	}
	return strings.Join(out, "/")
}

func joinPath(dir, p string) string {
	if dir == "" {
		return p
	}
	return dir + "/" + p
}

func segCount(p string) int {
	return strings.Count(p, "/") + 1
}

// PathIndex is an immutable lookup over every file path in the workspace,
// used by ResolveLink. Build it once per resolution batch with BuildPathIndex.
type PathIndex struct {
	byNormPath map[string]string   // normalizeLinkPath(path) → canonical path
	byStem     map[string][]string // normalizeLinkPath(basename) → canonical paths
	paths      []string            // all canonical paths, sorted
}

// BuildPathIndex indexes the given file paths for directory-aware resolution.
func BuildPathIndex(paths []string) *PathIndex {
	sorted := make([]string, len(paths))
	copy(sorted, paths)
	sort.Strings(sorted)

	idx := &PathIndex{
		byNormPath: make(map[string]string, len(sorted)),
		byStem:     make(map[string][]string),
		paths:      sorted,
	}
	for _, p := range sorted {
		np := normalizeLinkPath(p)
		if _, ok := idx.byNormPath[np]; !ok {
			idx.byNormPath[np] = p
		}
		stem := normalizeLinkPath(linkBase(p))
		idx.byStem[stem] = append(idx.byStem[stem], p)
	}
	return idx
}

func (idx *PathIndex) lookupExact(p string) string {
	return idx.byNormPath[normalizeLinkPath(p)]
}

// tieBreak picks deterministically among ambiguous candidates: a candidate in
// the source directory wins; otherwise the shortest path; otherwise the
// lexicographically smallest. Matches the UI's tieBreak.
func tieBreak(candidates []string, fromDir string) string {
	pool := candidates
	var inDir []string
	for _, p := range candidates {
		if linkDir(p) == fromDir {
			inDir = append(inDir, p)
		}
	}
	if len(inDir) > 0 {
		pool = inDir
	}
	best := pool[0]
	bestSeg := segCount(best)
	for _, p := range pool[1:] {
		s := segCount(p)
		if s < bestSeg || (s == bestSeg && p < best) {
			best, bestSeg = p, s
		}
	}
	return best
}

func (idx *PathIndex) resolveSuffix(page, fromDir string) string {
	key := "/" + normalizeLinkPath(page)
	var matches []string
	for _, p := range idx.paths {
		if strings.HasSuffix(normalizeLinkPath(p), key) {
			matches = append(matches, p)
		}
	}
	switch len(matches) {
	case 0:
		return ""
	case 1:
		return matches[0]
	default:
		return tieBreak(matches, fromDir)
	}
}

// ResolveLink resolves a raw wiki-link target (the string inside [[...]],
// optionally with a #heading suffix) to a canonical file path, or "" if no
// file matches. fromPath is the page the link was written on; pass "" to
// resolve from the vault root only.
func (idx *PathIndex) ResolveLink(target, fromPath string) string {
	page := strings.TrimSpace(target)
	if page == "" {
		return ""
	}
	// A #heading anchor does not affect which file the link points to.
	if i := strings.IndexByte(page, '#'); i >= 0 {
		page = page[:i]
	}
	page = strings.TrimSpace(page)
	if page == "" {
		return ""
	}

	fromDir := linkDir(fromPath)

	switch {
	case strings.HasPrefix(page, "./") || strings.HasPrefix(page, "../"):
		return idx.lookupExact(cleanRelPath(joinPath(fromDir, page)))

	case strings.HasPrefix(page, "/"):
		return idx.lookupExact(strings.TrimLeft(page, "/"))

	case strings.Contains(page, "/"):
		if hit := idx.lookupExact(page); hit != "" {
			return hit
		}
		if fromDir != "" {
			if hit := idx.lookupExact(cleanRelPath(joinPath(fromDir, page))); hit != "" {
				return hit
			}
		}
		return idx.resolveSuffix(page, fromDir)

	default:
		cands := idx.byStem[normalizeLinkPath(page)]
		switch len(cands) {
		case 0:
			return ""
		case 1:
			return cands[0]
		default:
			return tieBreak(cands, fromDir)
		}
	}
}
