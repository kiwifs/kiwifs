import type { Meta, StoryObj } from "@storybook/react";
import { KiwiKanbanBlock } from "./KiwiKanbanBlock";

const meta: Meta<typeof KiwiKanbanBlock> = {
  title: "Blocks/KiwiKanbanBlock",
  component: KiwiKanbanBlock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-5xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiKanbanBlock>;

export const SprintPlanning: Story = {
  args: {
    source: `title: Sprint Planning
columns:
  - name: Now
    color: "#22c55e"
    cards:
      - id: auth
        title: Fix auth token refresh
        tags: [backend, critical]
        priority: high
        assignee: alice
      - id: onboard
        title: Redesign onboarding flow
        tags: [frontend, design]
        assignee: diana
      - id: cache
        title: Implement Redis caching layer
        tags: [backend, performance]
        priority: medium
  - name: Next
    color: "#3b82f6"
    cards:
      - id: search
        title: Add semantic search
        tags: [backend, feature]
        description: Integrate vector embeddings for semantic search across all pages
      - id: notifications
        title: Build notification system
        tags: [fullstack, feature]
        assignee: bob
      - id: mobile
        title: Mobile responsive fixes
        tags: [frontend, bug]
  - name: Later
    color: "#a855f7"
    cards:
      - id: perf
        title: Performance audit
        tags: [devops]
      - id: docs
        title: API documentation overhaul
        tags: [docs]
        assignee: charlie
  - name: Done
    color: "#6b7280"
    cards:
      - id: ci
        title: Setup CI/CD pipeline
        tags: [devops]
      - id: tests
        title: Add integration test suite
        tags: [testing]
export:
  format: markdown
  copyLabel: Copy Sprint Board`,
  },
};

export const EmptyBoard: Story = {
  args: {
    source: `title: Empty Project Board
columns:
  - name: Backlog
    color: "#94a3b8"
    cards: []
  - name: In Progress
    color: "#3b82f6"
    cards: []
  - name: Review
    color: "#f59e0b"
    cards: []
  - name: Done
    color: "#22c55e"
    cards: []`,
  },
};

export const WithTagsAndPriorities: Story = {
  args: {
    source: `title: Bug Triage
columns:
  - name: Critical
    color: "#ef4444"
    cards:
      - id: crash
        title: App crashes on login with SSO
        tags: [auth, crash, P0]
        priority: critical
        assignee: alice
      - id: data-loss
        title: Data loss on concurrent edits
        tags: [editor, P0]
        priority: critical
  - name: High
    color: "#f59e0b"
    cards:
      - id: perf
        title: Page load takes 8s on large wikis
        tags: [performance, P1]
        priority: high
        assignee: bob
      - id: search
        title: Search returns stale results
        tags: [search, P1]
        priority: high
  - name: Medium
    color: "#3b82f6"
    cards:
      - id: ui
        title: Dark mode colors incorrect on sidebar
        tags: [ui, P2]
        priority: medium
      - id: mobile
        title: Kanban columns overflow on mobile
        tags: [responsive, P2]
        priority: medium
  - name: Low
    color: "#6b7280"
    cards:
      - id: typo
        title: Typo in settings page header
        tags: [ui, P3]
        priority: low
export:
  format: json
  copyLabel: Export Bug List`,
  },
};

export const MinimalTwoColumns: Story = {
  args: {
    source: `title: Quick Decisions
columns:
  - name: Yes
    color: "#22c55e"
    cards:
      - id: a
        title: Ship the new editor
      - id: b
        title: Upgrade to React 19
  - name: No
    color: "#ef4444"
    cards:
      - id: c
        title: Rewrite in Rust
      - id: d
        title: Drop mobile support`,
  },
};

export const ErrorState: Story = {
  args: {
    source: "this is not valid kanban config at all {{{",
  },
};
