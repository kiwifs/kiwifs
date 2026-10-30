import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { KanbanBoardSection } from "./KanbanBoardSection";
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
      { name: "Done", color: "#22c55e" },
    ],
    transitions: [
      { from: "To Do", to: "In Progress" },
      { from: "In Progress", to: "To Do" },
      { from: "In Progress", to: "Done" },
      { from: "Done", to: "In Progress" },
    ],
  },
];

const populatedBoard: { columns: WorkflowColumn[]; unmatchedPages?: WorkflowPage[] } = {
  columns: [
    {
      state: "To Do",
      color: "#3b82f6",
      pages: [
        { path: "tasks/setup-ci.md", title: "Setup CI/CD pipeline", tags: ["devops"], priority: "high" },
        { path: "tasks/write-tests.md", title: "Write unit tests", tags: ["testing"], author: "Alice" },
      ],
    },
    {
      state: "In Progress",
      color: "#f59e0b",
      wip_limit: 3,
      pages: [
        { path: "tasks/api-docs.md", title: "API documentation", due: "2026-05-20", author: "Bob" },
      ],
    },
    {
      state: "Done",
      color: "#22c55e",
      pages: [
        { path: "tasks/env-setup.md", title: "Dev environment setup", modified: "2026-05-10T08:00:00Z" },
      ],
    },
  ],
};

const boardWithUnmatched: { columns: WorkflowColumn[]; unmatchedPages: WorkflowPage[] } = {
  ...populatedBoard,
  unmatchedPages: [
    { path: "tasks/orphan-1.md", title: "Orphaned task one" },
    { path: "tasks/orphan-2.md", title: "Orphaned task two" },
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

const meta: Meta<typeof KanbanBoardSection> = {
  title: "Kanban/KanbanBoardSection",
  component: KanbanBoardSection,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof KanbanBoardSection>;

export const WithCards: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "sprint board": populatedBoard },
        }}
      >
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground h-[600px] flex flex-col">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export const Loading: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ workflows: sampleWorkflows, delay: 60000 }}>
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground h-[600px] flex flex-col">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export const Empty: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ workflows: [] }}>
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground h-[600px] flex flex-col">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export const WithUnmatchedPages: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "sprint board": boardWithUnmatched },
        }}
      >
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground h-[600px] flex flex-col">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export const WithLoadErrors: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "sprint board": populatedBoard },
          workflowErrors: ["broken-workflow.json: invalid JSON syntax"],
        }}
      >
        <KanbanStoreProvider>
          <KanbanDragProvider>
            <BoardLoader>
              <div className="bg-background text-foreground h-[600px] flex flex-col">
                <Story />
              </div>
            </BoardLoader>
          </KanbanDragProvider>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};
