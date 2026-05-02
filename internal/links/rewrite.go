package links

import (
	"strings"
)

// RewriteLinks replaces wiki-link targets in content that resolve to oldTarget
// with newTarget. Returns the modified content and whether any changes were made.
// Links inside fenced code blocks (```) are not rewritten.
func RewriteLinks(content string, oldTarget string, newTarget string) (string, bool) {
	if oldTarget == "" || newTarget == "" {
		return content, false
	}

	oldForms := targetFormsLower(oldTarget)
	lines := strings.Split(content, "\n")
	changed := false
	inCodeBlock := false

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inCodeBlock = !inCodeBlock
			continue
		}
		if inCodeBlock {
			continue
		}
		newLine := rewriteLinksInLine(line, oldForms, newTarget)
		if newLine != line {
			lines[i] = newLine
			changed = true
		}
	}

	if !changed {
		return content, false
	}
	return strings.Join(lines, "\n"), true
}

func rewriteLinksInLine(line string, oldForms map[string]bool, newTarget string) string {
	return wikiLinkFullRe.ReplaceAllStringFunc(line, func(match string) string {
		sub := wikiLinkFullRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		target := strings.TrimSpace(sub[1])
		if !matchesTarget(target, oldForms) {
			return match
		}
		if len(sub) >= 3 && sub[2] != "" {
			return "[[" + newTarget + "|" + sub[2] + "]]"
		}
		return "[[" + newTarget + "]]"
	})
}

func matchesTarget(target string, forms map[string]bool) bool {
	return forms[strings.ToLower(target)]
}

func targetFormsLower(path string) map[string]bool {
	forms := TargetForms(path)
	m := make(map[string]bool, len(forms))
	for _, f := range forms {
		m[strings.ToLower(f)] = true
	}
	return m
}
