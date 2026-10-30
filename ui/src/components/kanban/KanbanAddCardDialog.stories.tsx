import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { KanbanAddCardDialog } from "./KanbanAddCardDialog";
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
    { state: "Draft", color: "#3b82f6", pages: [{ path: "tasks/setup-ci.md", title: "Setup CI/CD pipeline" }] },
    { state: "Review", color: "#f59e0b", pages: [] },
    { state: "Published", color: "#22c55e", pages: [] },
  ],
};

/** Loads data and opens the add card dialog targeting a specific column. */
function AddCardOpener({ children, targetState }: { children: ReactNode; targetState: string }) {
  const loadWorkflows = useKanbanStore((s) => s.loadWorkflows);
  const openAddCard = useKanbanStore((s) => s.openAddCard);

  useEffect(() => {
    void loadWorkflows().then(() => {
      openAddCard(targetState);
    });
  }, [loadWorkflows, openAddCard, targetState]);

  return <>{children}</>;
}

const meta: Meta<typeof KanbanAddCardDialog> = {
  title: "Kanban/KanbanAddCardDialog",
  component: KanbanAddCardDialog,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "content pipeline": sampleBoard },
        }}
      >
        <KanbanStoreProvider>
          <AddCardOpener targetState="Draft">
            <div className="bg-background text-foreground min-h-[400px]">
              <Story />
            </div>
          </AddCardOpener>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KanbanAddCardDialog>;

export const NewCard: Story = {
  args: { onNavigate: action("navigate") },
};

export const AddToReview: Story = {
  args: { onNavigate: action("navigate") },
  decorators: [
    (Story) => (
      <MockApiProvider
        overrides={{
          workflows: sampleWorkflows,
          workflowBoards: { "content pipeline": sampleBoard },
        }}
      >
        <KanbanStoreProvider>
          <AddCardOpener targetState="Review">
            <div className="bg-background text-foreground min-h-[400px]">
              <Story />
            </div>
          </AddCardOpener>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};
