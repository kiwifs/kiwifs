import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { KanbanToolbar } from "./KanbanToolbar";
import { KanbanStoreProvider, useKanbanStore } from "./kanbanStore";
import { MockApiProvider } from "@kw/components/__mocks__/apiMock";
import type { WorkflowDef } from "@kw/lib/api";

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
  {
    name: "bug tracker",
    states: [
      { name: "Open", color: "#ef4444" },
      { name: "In Progress", color: "#f59e0b" },
      { name: "Closed", color: "#6b7280" },
    ],
    transitions: [
      { from: "Open", to: "In Progress" },
      { from: "In Progress", to: "Open" },
      { from: "In Progress", to: "Closed" },
      { from: "Closed", to: "In Progress" },
    ],
  },
];

/** Loads workflows from mock API on mount so the toolbar populates. */
function StoreLoader({ children }: { children: ReactNode }) {
  const loadWorkflows = useKanbanStore((s) => s.loadWorkflows);
  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);
  return <>{children}</>;
}

const meta: Meta<typeof KanbanToolbar> = {
  title: "Kanban/KanbanToolbar",
  component: KanbanToolbar,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ workflows: sampleWorkflows }}>
        <KanbanStoreProvider>
          <StoreLoader>
            <div className="bg-background text-foreground">
              <Story />
            </div>
          </StoreLoader>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KanbanToolbar>;

export const Default: Story = {
  args: { onClose: action("close") },
};

export const NoWorkflows: Story = {
  args: { onClose: action("close") },
  decorators: [
    (Story) => (
      <MockApiProvider overrides={{ workflows: [] }}>
        <KanbanStoreProvider>
          <StoreLoader>
            <div className="bg-background text-foreground">
              <Story />
            </div>
          </StoreLoader>
        </KanbanStoreProvider>
      </MockApiProvider>
    ),
  ],
};
