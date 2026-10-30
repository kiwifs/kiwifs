import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, userEvent, within } from "storybook/test";
import { KiwiKanban } from "./KiwiKanban";
import { MockApiProvider, type MockOverrides } from "./__mocks__/apiMock";
import { KanbanDragProvider } from "./kanban/KanbanDragProvider";
import type { WorkflowColumn, WorkflowDef } from "@kw/lib/api";

const contentWorkflow: WorkflowDef = {
  name: "content-pipeline",
  states: [
    { name: "Draft", color: "#3b82f6", wip_limit: 3 },
    { name: "Review", color: "#f59e0b", wip_limit: 2 },
    { name: "Published", color: "#22c55e" },
  ],
  transitions: [
    { from: "Draft", to: "Review" },
    { from: "Review", to: "Draft" },
    { from: "Review", to: "Published" },
    { from: "Published", to: "Review" },
  ],
};

const engineeringWorkflow: WorkflowDef = {
  name: "engineering",
  states: [
    { name: "Backlog", color: "#64748b" },
    { name: "Building", color: "#8b5cf6", wip_limit: 1 },
    { name: "Done", color: "#14b8a6" },
  ],
  transitions: [
    { from: "Backlog", to: "Building" },
    { from: "Building", to: "Backlog" },
    { from: "Building", to: "Done" },
    { from: "Done", to: "Building" },
  ],
};

const contentColumns: WorkflowColumn[] = [
  {
    state: "Draft",
    color: "#3b82f6",
    wip_limit: 3,
    pages: [
      {
        path: "content/launch-note.md",
        title: "Draft launch note",
        tags: ["release", "writing"],
        priority: "high",
        author: "Mina",
        ordinal: 1000,
      },
      {
        path: "content/editor-guide.md",
        title: "Refresh editor onboarding guide",
        tags: ["docs"],
        due: "2026-05-24",
        ordinal: 2000,
      },
    ],
  },
  {
    state: "Review",
    color: "#f59e0b",
    wip_limit: 2,
    pages: [
      {
        path: "content/security-copy.md",
        title: "Review security landing copy",
        tags: ["security", "marketing"],
        blocked: true,
        block_reason: "Waiting on legal wording",
        ordinal: 1000,
      },
      {
        path: "content/api-reference.md",
        title: "Validate API reference examples",
        tags: ["api", "docs"],
        ordinal: 2000,
      },
    ],
  },
  {
    state: "Published",
    color: "#22c55e",
    pages: [
      {
        path: "content/quickstart.md",
        title: "Publish quickstart refresh",
        tags: ["docs", "done"],
        modified: "2026-05-16T09:30:00Z",
        ordinal: 1000,
      },
    ],
  },
];

const engineeringColumns: WorkflowColumn[] = [
  {
    state: "Backlog",
    color: "#64748b",
    pages: [
      {
        path: "engineering/cache-store.md",
        title: "Choose cache storage boundary",
        tags: ["architecture"],
      },
    ],
  },
  {
    state: "Building",
    color: "#8b5cf6",
    wip_limit: 1,
    pages: [
      {
        path: "engineering/kanban-store.md",
        title: "Finish feature-scoped Kanban store",
        tags: ["frontend", "zustand"],
        priority: "high",
      },
      {
        path: "engineering/storybook.md",
        title: "Add stateful Storybook coverage",
        tags: ["storybook"],
        priority: "medium",
      },
    ],
  },
  { state: "Done", color: "#14b8a6", pages: [] },
];

const populatedBoard: MockOverrides = {
  workflows: [contentWorkflow, engineeringWorkflow],
  workflowBoards: {
    [contentWorkflow.name]: {
      columns: contentColumns,
      unmatchedPages: [
        {
          path: "content/stale-state.md",
          title: "Card still points at Archived",
        },
      ],
    },
    [engineeringWorkflow.name]: { columns: engineeringColumns },
  },
  workflowErrors: [".kiwi/workflows/archive.json: invalid transition target"],
};

const emptyWorkspace: MockOverrides = {
  workflows: [],
  workflowBoards: {},
};

const emptyBoard: MockOverrides = {
  workflows: [contentWorkflow],
  workflowBoards: {
    [contentWorkflow.name]: {
      columns: contentWorkflow.states.map((state) => ({
        state: state.name,
        color: state.color,
        wip_limit: state.wip_limit,
        pages: [],
      })),
    },
  },
};

const meta: Meta<typeof KiwiKanban> = {
  title: "Kanban/KiwiKanban",
  component: KiwiKanban,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof KiwiKanban>;

function renderKanban(overrides: MockOverrides) {
  return (
    <MockApiProvider overrides={overrides}>
      <KanbanDragProvider>
        <div className="h-screen bg-background text-foreground">
          <KiwiKanban onClose={action("close-kanban")} onNavigate={action("navigate")} />
        </div>
      </KanbanDragProvider>
    </MockApiProvider>
  );
}

export const PopulatedBoard: Story = {
  render: () => renderKanban(populatedBoard),
};

export const EmptyWorkspace: Story = {
  render: () => renderKanban(emptyWorkspace),
};

export const EmptyBoard: Story = {
  render: () => renderKanban(emptyBoard),
};

export const AddCardDialog: Story = {
  render: () => renderKanban(populatedBoard),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const addDraftCard = await canvas.findByRole("button", { name: "Add card to Draft" });
    await userEvent.click(addDraftCard);

    const dialog = within(document.body);
    await expect(dialog.getByRole("dialog", { name: "Add card to Draft" })).toBeInTheDocument();
    await expect(dialog.getByLabelText("Title")).toBeInTheDocument();
    await expect(dialog.getByLabelText("Path")).toHaveValue("");
  },
};
