package docexport

import (
	"strings"
	"testing"
)

const widgetPage = "# Two Sum\n\n" +
	"```array id=two-sum\n" +
	"values: [2, 7, 11]\n" +
	"caption: Two pointers meet\n" +
	"activeIndices: [0]\n" +
	"steps:\n" +
	"  - note: lo moves right\n" +
	"  - note: they cross\n" +
	"```\n\n" +
	"Closing prose.\n"

func TestRewriteWidgetFencesKeepsTheProse(t *testing.T) {
	got := string(RewriteWidgetFences([]byte(widgetPage)))

	for _, want := range []string{
		"# Two Sum",
		"> Two pointers meet",
		"> lo moves right",
		"> they cross",
		"Interactive array widget",
		"Closing prose.",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected %q in:\n%s", want, got)
		}
	}
}

func TestRewriteWidgetFencesKeepsTheDataAsYAML(t *testing.T) {
	got := string(RewriteWidgetFences([]byte(widgetPage)))
	if !strings.Contains(got, "```yaml") {
		t.Errorf("the data should still be readable:\n%s", got)
	}
	if !strings.Contains(got, "values: [2, 7, 11]") {
		t.Errorf("expected the original body to survive:\n%s", got)
	}
	// And no longer as a fence pandoc would try to highlight as `array`.
	if strings.Contains(got, "```array") {
		t.Errorf("the widget tag should be gone:\n%s", got)
	}
}

func TestRewriteWidgetFencesLeavesCodeFencesAlone(t *testing.T) {
	page := "```python\nvalues = [1]\n```\n"
	got := string(RewriteWidgetFences([]byte(page)))
	if got != page {
		t.Errorf("a code fence must pass through untouched:\n%s", got)
	}
}

func TestRewriteWidgetFencesLeavesADirectoryListingAlone(t *testing.T) {
	// A bare ```tree holding a directory listing is not a widget.
	page := "```tree\nsrc/\n  lib/\n```\n"
	got := string(RewriteWidgetFences([]byte(page)))
	if strings.Contains(got, "Interactive") {
		t.Errorf("a directory listing must not become a figure:\n%s", got)
	}
	if !strings.Contains(got, "src/") {
		t.Errorf("content lost:\n%s", got)
	}
}

func TestRewriteWidgetFencesHandlesAFenceWithNoProse(t *testing.T) {
	page := "```array\nvalues: [1, 2]\n```\n"
	got := string(RewriteWidgetFences([]byte(page)))
	if !strings.Contains(got, "Interactive array widget") {
		t.Errorf("expected the pointer back to KiwiFS:\n%s", got)
	}
	if !strings.Contains(got, "values: [1, 2]") {
		t.Errorf("expected the data:\n%s", got)
	}
}

func TestRewriteWidgetFencesOutlastsBackticksInTheBody(t *testing.T) {
	page := "````array\nvalues: [1]\ncode: |\n  ```python\n  x = 1\n  ```\n````\n"
	got := string(RewriteWidgetFences([]byte(page)))
	if !strings.Contains(got, "````yaml\n") {
		t.Fatalf("expected a four-backtick fence around a body holding three:\n%s", got)
	}
	if !strings.HasSuffix(strings.TrimRight(got, "\n"), "````") {
		t.Errorf("expected the YAML block to close with the same marker:\n%s", got)
	}
}

func TestRewriteWidgetFencesKeepsCodeOutOfTheProse(t *testing.T) {
	page := "```array\nvalues: [1]\ncaption: A sweep\ncode: \"lo, hi = 0, 1\"\n```\n"
	got := string(RewriteWidgetFences([]byte(page)))
	if strings.Contains(got, "> lo, hi") {
		t.Errorf("the code is in the YAML block; it must not be blockquoted too:\n%s", got)
	}
	if !strings.Contains(got, "> A sweep") || !strings.Contains(got, `code: "lo, hi = 0, 1"`) {
		t.Errorf("expected the caption quoted and the code kept as data:\n%s", got)
	}
}

func TestRewriteWidgetFencesStaysInsideAListItem(t *testing.T) {
	page := "- Step one\n\n  ```array\n  values: [1]\n  caption: Listed\n  ```\n\n- Step two\n"
	got := string(RewriteWidgetFences([]byte(page)))
	for _, want := range []string{"  > Listed", "  ```yaml", "  values: [1]", "- Step two"} {
		if !strings.Contains(got, want) {
			t.Errorf("expected %q in:\n%s", want, got)
		}
	}
	for _, line := range strings.Split(got, "\n") {
		if line != "" && !strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "- ") {
			t.Errorf("line escaped the list item: %q\n%s", line, got)
		}
	}
}

func TestRewriteWidgetFencesUsesTheOpeningLineCaption(t *testing.T) {
	page := "```array caption=\"From the fence line\"\nvalues: [1]\n```\n"
	got := string(RewriteWidgetFences([]byte(page)))
	if !strings.HasPrefix(got, "> From the fence line\n") {
		t.Errorf("expected the opening-line caption first:\n%s", got)
	}
}

func TestRewriteWidgetFencesReplacesKiwiApps(t *testing.T) {
	page := "# Leases\n\n" +
		"```kiwi-app id=lease title=\"Lease timeline\" caption=\"A paused worker outlives its lease\"\n" +
		"<div class=\"k-app\"><script>kiwi.steps({count: 4})</script></div>\n" +
		"```\n\n" +
		"```array\nvalues: [1, 2]\n```\n\n" +
		"After.\n"
	got := string(RewriteWidgetFences([]byte(page)))
	for _, want := range []string{
		"> **Lease timeline**",
		"> A paused worker outlives its lease",
		"Interactive app — open this page in KiwiFS to use it.",
		"Interactive array widget",
		"After.",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "kiwi.steps") || strings.Contains(got, "```kiwi-app") {
		t.Errorf("the app's HTML should not reach the export:\n%s", got)
	}
}

func TestRewriteWidgetFencesEscapesKiwiAppMeta(t *testing.T) {
	page := "```kiwi-app title=\"<img src=x onerror=alert(1)> **bold**\" caption=\"1. a [link](http://x) `code` _em_ & \\\\\"\n" +
		"<p>x</p>\n" +
		"```\n"
	got := string(RewriteWidgetFences([]byte(page)))
	for _, want := range []string{
		"> **&lt;img src=x onerror=alert(1)&gt; \\*\\*bold\\*\\***",
		"> 1\\. a \\[link\\](http://x) \\`code\\` \\_em\\_ &amp; \\\\",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "<img") {
		t.Errorf("raw HTML from the meta reached the export:\n%s", got)
	}
}

func TestEscapeInline(t *testing.T) {
	for in, want := range map[string]string{
		"A lease, outlived": "A lease, outlived",
		"- not a list":      `\- not a list`,
		"+ nor this":        `\+ nor this`,
		"12) nor this":      `12\) nor this`,
		"2026 report":       "2026 report",
		"a | b ~ c # $x$":   `a \| b \~ c \# \$x\$`,
		"two\nlines":        "two lines",
	} {
		if got := escapeInline(in); got != want {
			t.Errorf("escapeInline(%q) = %q, want %q", in, got, want)
		}
	}
}
