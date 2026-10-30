import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { KanbanBoardView } from "./KanbanBoardView";
import { KanbanStoreProvider, useKanbanStore } from "./kanbanStore";
import { KanbanDragProvider } from "./KanbanDragProvider";
import { MockApiProvider } from "@kw/components/__mocks__/apiMock";
import type { WorkflowDef, WorkflowColumn, WorkflowPage } from "@kw/lib/api";

const sampleWorkflows: WorkflowDef[] = [
  {
    name: "sprint board",
    states: [
      { name: "To Do", color: "#3b82f6" },
      { name: "In Progress", color: "#f59e0b", wip_limit: 3 },
      { name: "Review", color: "#8b5cf6" },
      { name: "Done", color: "#22c55e" },
    ],
    transitions: [
      { from: "To Do", to: "In Progress" },
      { from: "In Progress", to: "To Do" },
      { from: "In Progress", to: "Review" },
      { from: "Review", to: "In Progress" },
      { from: "Review", to: "Done" },
      { from: "Done", to: "Review" },
    ],
  },
];

const sampleBoard: { columns: WorkflowColumn[]; unmatchedPages?: WorkflowPage[] } = {
  columns: [
    {
      state: "To Do",
      color: "#3b82f6",
      pages: [
        {
          path: "tasks/setup-ci.md",
          title: "Setup CI/CD pipeline",
          tags: ["devops"],
          priority: "high",
        },
        {
          path: "tasks/write-tests.md",
          title: "Write unit tests for auth module",
          tags: ["testing"],
          author: "Alice Chen",
          modified: "2026-05-14T10:00:00Z",
        },
        {
          path: "tasks/design-landing.md",
          title: "Design new landing page",
          tags: ["design", "marketing"],
          due: "2026-05-22",
        },
      ],
    },
    {
      state: "In Progress",
      color: "#f59e0b",
      wip_limit: 3,
      pages: [
        {
          path: "tasks/api-docs.md",
          title: "Complete API documentation",
          due: "2026-05-20",
          author: "Bob Smith",
          tags: ["docs"],
          description: "Add OpenAPI docs for all endpoints",
        },
        {
          path: "tasks/search-filter.md",
          title: "Implement search filtering",
          priority: "critical",
          tags: ["backend", "feature"],
          depends_on: ["tasks/setup-ci.md"],
        },
      ],
    },
    {
      state: "Review",
      color: "#8b5cf6",
      pages: [
        {
          path: "tasks/dark-mode.md",
          title: "Add dark mode support",
          tags: ["frontend", "ui"],
          author: "Diana UX",
        },
      ],
    },
    {
      state: "Done",
      color: "#22c55e",
      pages: [
        {
          path: "tasks/env-setup.md",
          title: "Dev environment setup guide",
          tags: ["docs"],
          modified: "2026-05-10T08:00:00Z",
        },
      ],
    },
  ],
};

/** Loads workflows and board from mock API. */
function BoardLoader({ children }: { children: ReactNode }) {
  const loadWorkflows = useKanbanStore((s) => s.loadWorkflows);
  const loadBoard = useKanbanStore((s) => s.loadBoard);
  const activeWorkflow = useKanbanStore((s) => s.activeWorkflow);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (activeWorkflow) void loadBoard(activeWorkflow);
  }, [activeWorkflow, loadBoard]);

  return <>{children}</>;
}

const meta: Meta<typeof KanbanBoardView> = {
  title: "Kanban/KanbanBoardView",
  component: KanbanBoardView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "sprint board": sampleBoard },
        }}
      >
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground overflow-x-auto">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KanbanBoardView>;

export const Default: Story = {
  args: { onNavigate: action("navigate") },
};

const emptyBoard: { columns: WorkflowColumn[] } = {
  columns: [
    { state: "To Do", color: "#3b82f6", pages: [] },
    { state: "In Progress", color: "#f59e0b", wip_limit: 3, pages: [] },
    { state: "Done", color: "#22c55e", pages: [] },
  ],
};

export const EmptyColumns: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "sprint board": emptyBoard },
        }}
      >
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground overflow-x-auto">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};
