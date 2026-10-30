import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CreateWorkflowDialog,
  EditWorkflowDialog,
  DeleteWorkflowDialog,
} from "./KanbanWorkflowDialogs";
import { KanbanStoreProvider, useKanbanStore } from "./kanbanStore";
import { MockApiProvider } from "@kw/components/__mocks__/apiMock";
import type { WorkflowDef, WorkflowColumn, WorkflowPage } from "@kw/lib/api";

const sampleWorkflows: WorkflowDef[] = [
  {
    name: "content pipeline",
    states: [
      { name: "Draft", color: "#3b82f6" },
      { name: "Review", color: "#f59e0b" },
      { name: "Published", color: "#22c55e" },
    ],
    transitions: [
      { from: "Draft", to: "Review" },
      { from: "Review", to: "Draft" },
      { from: "Review", to: "Published" },
      { from: "Published", to: "Review" },
    ],
  },
];

const sampleBoard: { columns: WorkflowColumn[]; unmatchedPages?: WorkflowPage[] } = {
  columns: [
    { state: "Draft", color: "#3b82f6", pages: [{ path: "tasks/a.md", title: "Draft article" }] },
    { state: "Review", color: "#f59e0b", pages: [{ path: "tasks/b.md", title: "Review changes" }] },
    { state: "Published", color: "#22c55e", pages: [] },
  ],
};

// --- Create Workflow Dialog ---

function CreateDialogOpener({ children }: { children: ReactNode }) {
  const openCreateWorkflow = useKanbanStore((s) => s.openCreateWorkflow);
  useEffect(() => {
    openCreateWorkflow();
  }, [openCreateWorkflow]);
  return <>{children}</>;
}

const createMeta: Meta<typeof CreateWorkflowDialog> = {
  title: "Kanban/WorkflowDialogs",
  component: CreateWorkflowDialog,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ workflows: [] }}>
        <KanbanStoreProvider>
          <CreateDialogOpener>
            <div className="bg-background text-foreground min-h-[400px]">
              <Story />
            </div>
          </CreateDialogOpener>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export default createMeta;
type CreateStory = StoryObj<typeof CreateWorkflowDialog>;

export const CreateNew: CreateStory = {
  render: () => <CreateWorkflowDialog />,
};

// --- Edit Workflow Dialog ---

function EditDialogOpener({ children }: { children: ReactNode }) {
  const loadWorkflows = useKanbanStore((s) => s.loadWorkflows);
  const loadBoard = useKanbanStore((s) => s.loadBoard);
  const activeWorkflow = useKanbanStore((s) => s.activeWorkflow);
  const openEditWorkflow = useKanbanStore((s) => s.openEditWorkflow);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (activeWorkflow) {
      void loadBoard(activeWorkflow).then(() => {
        openEditWorkflow();
      });
    }
  }, [activeWorkflow, loadBoard, openEditWorkflow]);

  return <>{children}</>;
}

export const EditColumns: CreateStory = {
  render: () => <EditWorkflowDialog />,
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "content pipeline": sampleBoard },
        }}
      >
        <KanbanStoreProvider>
          <EditDialogOpener>
            <div className="bg-background text-foreground min-h-[400px]">
              <Story />
            </div>
          </EditDialogOpener>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

// --- Delete Workflow Dialog ---

function DeleteDialogOpener({ children }: { children: ReactNode }) {
  const loadWorkflows = useKanbanStore((s) => s.loadWorkflows);
  const loadBoard = useKanbanStore((s) => s.loadBoard);
  const activeWorkflow = useKanbanStore((s) => s.activeWorkflow);
  const openDeleteWorkflow = useKanbanStore((s) => s.openDeleteWorkflow);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (activeWorkflow) {
      void loadBoard(activeWorkflow).then(() => {
        openDeleteWorkflow();
      });
    }
  }, [activeWorkflow, loadBoard, openDeleteWorkflow]);

  return <>{children}</>;
}

export const DeleteBoard: CreateStory = {
  render: () => <DeleteWorkflowDialog />,
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "content pipeline": sampleBoard },
        }}
      >
        <KanbanStoreProvider>
          <DeleteDialogOpener>
            <div className="bg-background text-foreground min-h-[400px]">
              <Story />
            </div>
          </DeleteDialogOpener>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export const DeleteEmptyBoard: CreateStory = {
  render: () => <DeleteWorkflowDialog />,
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: {
            "content pipeline": {
              columns: [
                { state: "Draft", color: "#3b82f6", pages: [] },
                { state: "Review", color: "#f59e0b", pages: [] },
                { state: "Published", color: "#22c55e", pages: [] },
              ],
            },
          },
        }}
      >
        <KanbanStoreProvider>
          <DeleteDialogOpener>
            <div className="bg-background text-foreground min-h-[400px]">
              <Story />
            </div>
          </DeleteDialogOpener>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};
