package janitor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kiwifs/kiwifs/internal/storage"
)

// buildStore creates a temp local storage seeded with the provided files.
func buildStore(t *testing.T, files map[string]string) (storage.Storage, string) {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		abs := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}
	s, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("NewLocal: %v", err)
	}
	return s, root
}

func issuesByKind(issues []Issue) map[string][]Issue {
	out := map[string][]Issue{}
	for _, is := range issues {
		out[is.Kind] = append(out[is.Kind], is)
	}
	return out
}

func TestScan_FlagsMissingMetadataAndEmptyPages(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"index.md": "# Index\n\nThis index has plenty of real content to stay above the empty-page threshold, and links to [[empty]] and [[ghost]].\n",
		// no frontmatter, short body — missing-owner/status + empty-page
		"empty.md": "x",
	})

	sc := New(root, store, nil, 90)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}

	byKind := issuesByKind(res.Issues)
	if len(byKind[IssueEmptyPage]) != 1 || byKind[IssueEmptyPage][0].Path != "empty.md" {
		t.Fatalf("expected exactly empty.md flagged empty, got %+v", byKind[IssueEmptyPage])
	}
	if len(byKind[IssueMissingOwner]) < 1 {
		t.Fatalf("expected at least 1 missing-owner, got %+v", byKind[IssueMissingOwner])
	}
	if len(byKind[IssueBrokenLink]) != 1 {
		t.Fatalf("expected 1 broken-link (ghost), got %+v", byKind[IssueBrokenLink])
	}
}

func TestScan_DetectsStalePage(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"old.md": `---
title: Old
owner: alice
next-review: 2020-01-01
---

Some content here that is long enough to not be empty and pass the 50 char threshold for the test to behave nicely.
`,
	})
	sc := New(root, store, nil, 30)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueStale]) == 0 {
		t.Fatalf("expected stale issue, got %+v", res.Issues)
	}
	if !strings.Contains(by[IssueStale][0].Message, "2020-01-01") {
		t.Fatalf("stale message should reference the date, got %q", by[IssueStale][0].Message)
	}
}

func TestScan_DetectsDuplicateTitles(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"a/auth.md": `---
title: Auth
owner: alice
status: verified
reviewed: 2030-01-01
next-review: 2040-01-01
---

Content long enough to avoid empty-page flag and cover the minimum threshold.
`,
		"b/auth.md": `---
title: Auth
owner: bob
status: verified
reviewed: 2030-01-01
next-review: 2040-01-01
---

Another doc with the same title, long enough to avoid the empty-page flag.
`,
	})
	sc := New(root, store, nil, 90)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueDuplicate]) == 0 {
		t.Fatalf("expected duplicate, got %+v", res.Issues)
	}
}

func TestScan_DetectsContradictionBetweenSoTPages(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"a.md": `---
title: Billing A
owner: alice
status: verified
source-of-truth: true
tags: [billing, payments]
reviewed: 2030-01-01
next-review: 2040-01-01
---

Content long enough to avoid empty-page flag and hit fifty chars of body text here.
`,
		"b.md": `---
title: Billing B
owner: bob
status: verified
source-of-truth: true
tags: [billing, payments]
reviewed: 2030-01-01
next-review: 2040-01-01
---

Conflicting source of truth content, long enough to avoid the empty-page threshold.
`,
	})
	sc := New(root, store, nil, 90)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueContradiction]) == 0 {
		t.Fatalf("expected contradiction, got %+v", res.Issues)
	}
}

func TestScan_FlagsExpiredMemory(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"expired.md": `---
title: Expired
owner: alice
status: verified
expires_at: 2020-01-01T00:00:00Z
reviewed: 2030-01-01
next-review: 2040-01-01
---

Content long enough to avoid empty-page flag and hit fifty chars of body text here.
`,
		"fresh.md": `---
title: Fresh
owner: alice
status: verified
expires_at: 2099-01-01T00:00:00Z
reviewed: 2030-01-01
next-review: 2040-01-01
---

Another page with enough content to avoid the empty-page threshold easily.
`,
	})
	sc := New(root, store, nil, 90)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExpiredMemory]) != 1 {
		t.Fatalf("expected 1 expired-memory, got %+v", by[IssueExpiredMemory])
	}
	if by[IssueExpiredMemory][0].Path != "expired.md" {
		t.Fatalf("expected expired.md, got %s", by[IssueExpiredMemory][0].Path)
	}
}

func TestScan_FlagsTTLExpiredMemory(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"ttl-expired.md": `---
title: TTL expired
owner: alice
status: verified
created: 2020-01-01T00:00:00Z
ttl: 1h
reviewed: 2030-01-01
next-review: 2040-01-01
---

Content long enough to avoid empty-page flag and hit fifty chars of body text here.
`,
	})
	sc := New(root, store, nil, 90)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExpiredMemory]) != 1 || by[IssueExpiredMemory][0].Path != "ttl-expired.md" {
		t.Fatalf("expected ttl-expired.md flagged, got %+v", by[IssueExpiredMemory])
	}
}

func TestScan_HealthyCount(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"index.md": `---
title: Index
owner: alice
status: verified
reviewed: 2030-01-01
next-review: 2040-01-01
---

This content is long enough to avoid being flagged as an empty page entirely.
`,
	})
	sc := New(root, store, nil, 90)
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if res.Scanned != 1 {
		t.Fatalf("expected 1 scanned, got %d", res.Scanned)
	}
	if res.Healthy != 1 {
		t.Fatalf("expected 1 healthy (index.md is exempt from orphan check), got %d; issues=%+v", res.Healthy, res.Issues)
	}
}

const runbookBody = `
Content long enough to avoid empty-page flag and hit fifty chars of body text here.
`

func TestScan_ExecutionStalenessFlagsStaleRunbook(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/stale.md": `---
title: Stale deploy
owner: alice
status: active
last_executed: 2020-01-01
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExecutionStale]) != 1 {
		t.Fatalf("expected 1 execution-stale, got %+v", by[IssueExecutionStale])
	}
	if by[IssueExecutionStale][0].Path != "runbooks/stale.md" {
		t.Fatalf("expected runbooks/stale.md, got %s", by[IssueExecutionStale][0].Path)
	}
	if !strings.Contains(by[IssueExecutionStale][0].Message, "last_executed") {
		t.Fatalf("expected staleness message, got %q", by[IssueExecutionStale][0].Message)
	}
}

func TestScan_ExecutionStalenessFreshRunbookNotFlagged(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/fresh.md": `---
title: Fresh deploy
owner: alice
status: active
last_executed: 2099-01-01
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExecutionStale]) != 0 {
		t.Fatalf("expected no execution-stale, got %+v", by[IssueExecutionStale])
	}
}

func TestScan_ExecutionStalenessFlagsFailureRegardlessOfAge(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/failed.md": `---
title: Failed deploy
owner: alice
status: active
last_executed: 2099-01-01
last_outcome: failure
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExecutionStale]) != 1 {
		t.Fatalf("expected 1 execution-stale for failure, got %+v", by[IssueExecutionStale])
	}
	if !strings.Contains(by[IssueExecutionStale][0].Message, `last_outcome is "failure"`) {
		t.Fatalf("expected failure message, got %q", by[IssueExecutionStale][0].Message)
	}
}

func TestScan_ExecutionStalenessIgnoresOtherDirectories(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"pages/stale.md": `---
title: Other stale
owner: alice
status: active
last_executed: 2020-01-01
last_outcome: failure
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExecutionStale]) != 0 {
		t.Fatalf("expected no execution-stale outside runbooks/, got %+v", by[IssueExecutionStale])
	}
}

func TestOptionsFromExecutionStaleness_DisabledWhenDirectoryEmpty(t *testing.T) {
	if opts := OptionsFromExecutionStaleness("", "last_executed", 90, nil); opts != nil {
		t.Fatalf("expected nil opts for empty directory, got %v", opts)
	}
	if opts := OptionsFromExecutionStaleness("   ", "last_executed", 90, nil); opts != nil {
		t.Fatalf("expected nil opts for whitespace directory, got %v", opts)
	}
}

func TestExecutionStalenessRule_Enabled(t *testing.T) {
	enabled := ExecutionStalenessRule{Directory: "runbooks/"}
	if !enabled.Enabled() {
		t.Fatal("expected enabled for non-empty directory")
	}
	disabled := ExecutionStalenessRule{Directory: ""}
	if disabled.Enabled() {
		t.Fatal("expected disabled for empty directory")
	}
}

func TestScan_ExecutionStalenessMultipleFlagValues(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/blocked.md": `---
title: Blocked runbook
owner: alice
status: blocked
last_executed: 2099-01-01
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{
			"last_outcome": "failure",
			"status":       "blocked",
		},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExecutionStale]) != 1 {
		t.Fatalf("expected 1 execution-stale for status=blocked, got %+v", by[IssueExecutionStale])
	}
	if !strings.Contains(by[IssueExecutionStale][0].Message, `status is "blocked"`) {
		t.Fatalf("expected blocked flag message, got %q", by[IssueExecutionStale][0].Message)
	}
}

func TestScan_ExecutionStalenessCustomDateField(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/custom-date.md": `---
title: Custom date field
owner: alice
status: active
last_verified: 2020-01-01
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_verified",
		MaxAgeDays: 90,
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	by := issuesByKind(res.Issues)
	if len(by[IssueExecutionStale]) != 1 {
		t.Fatalf("expected 1 execution-stale for custom date field, got %+v", by[IssueExecutionStale])
	}
	if !strings.Contains(by[IssueExecutionStale][0].Message, "last_verified") {
		t.Fatalf("expected last_verified in message, got %q", by[IssueExecutionStale][0].Message)
	}
}

func TestScan_ExecutionStalenessMissingDateFieldNotFlaggedByAge(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/no-date.md": `---
title: No execution date
owner: alice
status: active
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(issuesByKind(res.Issues)[IssueExecutionStale]) != 0 {
		t.Fatalf("expected no execution-stale without date or failure flag, got %+v", res.Issues)
	}
}

func TestScan_ExecutionStalenessStaleAndFailureBothFlag(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/stale-failed.md": `---
title: Stale and failed
owner: alice
status: active
last_executed: 2020-01-01
last_outcome: failure
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	staleIssues := issuesByKind(res.Issues)[IssueExecutionStale]
	if len(staleIssues) != 2 {
		t.Fatalf("expected 2 execution-stale issues (age + failure), got %+v", staleIssues)
	}
}

func TestScan_ExecutionStalenessDefaultMaxAgeFromStaleDays(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/old.md": `---
title: Uses scanner stale days
owner: alice
status: active
last_executed: 2020-01-01
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 30, WithExecutionStaleness(ExecutionStalenessRule{
		Directory: "runbooks/",
		DateField: "last_executed",
		// MaxAgeDays 0 → fall back to scanner staleDays (30)
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(issuesByKind(res.Issues)[IssueExecutionStale]) != 1 {
		t.Fatalf("expected execution-stale using staleDays fallback, got %+v", res.Issues)
	}
}

func TestScan_ExecutionStalenessRFC3339Date(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/rfc3339.md": `---
title: RFC3339 date
owner: alice
status: active
last_executed: 2020-01-01T00:00:00Z
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(issuesByKind(res.Issues)[IssueExecutionStale]) != 1 {
		t.Fatalf("expected execution-stale for RFC3339 date, got %+v", res.Issues)
	}
}

func TestScan_ExecutionStalenessInvalidDateIgnored(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/bad-date.md": `---
title: Bad date
owner: alice
status: active
last_executed: not-a-date
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		DateField:  "last_executed",
		MaxAgeDays: 90,
		FlagValues: map[string]string{"last_outcome": "failure"},
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(issuesByKind(res.Issues)[IssueExecutionStale]) != 0 {
		t.Fatalf("expected no execution-stale for unparseable date without flag match, got %+v", res.Issues)
	}
}

func TestScan_ExecutionStalenessDefaultDateField(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"runbooks/default-field.md": `---
title: Default date field
owner: alice
status: active
last_executed: 2020-01-01
last_outcome: success
reviewed: 2030-01-01
next-review: 2040-01-01
---` + runbookBody,
	})
	sc := New(root, store, nil, 90, WithExecutionStaleness(ExecutionStalenessRule{
		Directory:  "runbooks/",
		MaxAgeDays: 90,
		// DateField empty → last_executed
	}))
	res, err := sc.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(issuesByKind(res.Issues)[IssueExecutionStale]) != 1 {
		t.Fatalf("expected execution-stale with default date_field, got %+v", res.Issues)
	}
}

func TestScan_FlagsBrokenKiwiAppSrc(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"guides/queue.md": "# Queue\n\n" +
			"```kiwi-app src=apps/lease.html\n```\n\n" +
			"```kiwi-app src=\"apps/gone.html\"\nfallback\n```\n\n" +
			"```kiwi-app src=/shared/retry.html\n```\n",
		"guides/apps/lease.html": "<div></div>\n",
		"shared/retry.html":      "<div></div>\n",
	})

	res, err := New(root, store, nil, 90).Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	broken := issuesByKind(res.Issues)[IssueBrokenAppSrc]
	if len(broken) != 1 || broken[0].Path != "guides/queue.md" || broken[0].Related[0] != "guides/apps/gone.html" {
		t.Fatalf("expected only guides/apps/gone.html flagged, got %+v", broken)
	}
}

func TestScan_KiwiAppSrcClimbingAboveRoot(t *testing.T) {
	store, root := buildStore(t, map[string]string{
		"q.md": "# Q\n\n" +
			"```kiwi-app src=../escape.html\n```\n\n" +
			"```kiwi-app src=/../escape.html\n```\n\n" +
			"```kiwi-app src=..foo.html\n```\n\n" +
			"```kiwi-app src=.\n```\n\n" +
			"```kiwi-app src=guides/../shared/ok.html\n```\n",
		"shared/ok.html": "<div></div>\n",
	})

	res, err := New(root, store, nil, 90).Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	broken := issuesByKind(res.Issues)[IssueBrokenAppSrc]
	var climbing, rootDir, missing int
	for _, is := range broken {
		switch {
		case strings.Contains(is.Message, "climbs above the workspace root"):
			climbing++
			if len(is.Related) != 0 {
				t.Errorf("Related should be empty without a target, got %q", is.Related)
			}
		case strings.Contains(is.Message, "workspace root, not a file"):
			rootDir++
			if len(is.Related) != 0 {
				t.Errorf("Related should be empty without a target, got %q", is.Related)
			}
		case strings.Contains(is.Message, "src=..foo.html doesn't resolve"):
			// A name starting with ".." is a file in the folder, not a climb.
			missing++
			if len(is.Related) != 1 || is.Related[0] != "..foo.html" {
				t.Errorf("Related = %q, want [..foo.html]", is.Related)
			}
		default:
			t.Errorf("unexpected issue %+v", is)
		}
	}
	if len(broken) != 4 || climbing != 2 || rootDir != 1 || missing != 1 {
		t.Fatalf("want two climbing, one root and one missing issue, got %+v", broken)
	}
}
