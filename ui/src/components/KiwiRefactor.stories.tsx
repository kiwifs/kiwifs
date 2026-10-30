import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import type { RefactorPending, RefactorPlan } from "@kw/lib/api";
import { KiwiRefactor } from "./KiwiRefactor";

const plan: RefactorPlan = {
  digest: "4f1c2a9be07d55a1",
  moves: [
    { from: "drafts/onboarding.md", to: "handbook/onboarding.md" },
    { from: "drafts/oncall.md", to: "handbook/oncall.md" },
  ],
  merges: [{ from: "faq/install-old.md", to: "faq/install.md" }],
  edits: [
    {
      path: "index.md",
      links: [
        { line: 4, old: "drafts/onboarding", new: "handbook/onboarding" },
        { line: 5, old: "faq/install-old", new: "faq/install" },
      ],
    },
  ],
  content_edits: [{ path: "handbook/oncall.md", from: "drafts/oncall.md", changes: ["set status", "+tag runbook"] }],
  warnings: ['tag "runbook" already exists on 3 pages; renaming "rb" merges into it'],
  stats: { pages: 42, links: 310, rewritten: 2, unresolved: 1 },
  integrity: { unresolved: 1, orphaned: [], complete: true },
  diffs: [
    {
      path: "index.md",
      diff: "--- a/index.md\n+++ b/index.md\n@@ -3,3 +3,3 @@\n # Home\n-- [[drafts/onboarding]]\n-- [[faq/install-old]]\n+- [[handbook/onboarding]]\n+- [[faq/install]]\n",
    },
  ],
};

const pending: RefactorPending[] = [
  {
    digest: plan.digest,
    manifest: { moves: [{ from: "drafts/", to: "handbook/" }], merges: [{ from: "faq/install-old.md", into: "faq/install.md" }] },
    actor: "claude-code",
    client: "mcp/claude-code",
    reason: "62 files (limit 50)",
    at: "2026-10-13T10:00:00Z",
  },
];

function mockRefactorApi({ withInbox }: { withInbox: boolean }) {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/refactor/pending")) return json({ pending: withInbox ? pending : [] });
    if (url.includes("/refactor/raw-moves"))
      return json(
        withInbox
          ? {
              moves: [{ from: "notes/old.md", to: "notes/archive/old.md", actor: "webdav", at: "2026-10-13T09:00:00Z", via: "rename" }],
              manifest: { relinks: [{ from: "notes/old.md", to: "notes/archive/old.md" }] },
            }
          : { moves: [], manifest: null },
      );
    if (url.includes("/refactor/plan")) return json(plan);
    if (url.includes("/refactor/apply")) return json({ applied: { written: 4, deleted: 3, side_files: 1, removed_dirs: 1, commit: "9d8e7f6a5b4c3d2e" }, plan });
    return json({});
  }) as typeof window.fetch;
}

const meta: Meta<typeof KiwiRefactor> = {
  title: "Content/KiwiRefactor",
  component: KiwiRefactor,
  parameters: { layout: "fullscreen" },
  args: { onClose: action("close"), onApplied: action("applied") },
};

export default meta;
type Story = StoryObj<typeof KiwiRefactor>;

function WithApi({ withInbox, children }: { withInbox: boolean; children: React.ReactNode }) {
  useState(() => mockRefactorApi({ withInbox }));
  return <div className="h-screen bg-background text-foreground">{children}</div>;
}

export const Planned: Story = {
  args: { initialManifest: "moves:\n  - from: drafts/\n    to: handbook/\nmerges:\n  - from: faq/install-old.md\n    into: faq/install.md\n" },
  decorators: [(Story) => <WithApi withInbox={false}><Story /></WithApi>],
};

export const AgentWaitingForApproval: Story = {
  decorators: [(Story) => <WithApi withInbox><Story /></WithApi>],
};
