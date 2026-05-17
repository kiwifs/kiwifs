import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { KanbanDragProvider } from "./KanbanDragProvider";
import type { WorkflowPage } from "@kw/lib/api";

const mockPages: WorkflowPage[] = [
  {
    path: "task-1",
    title: "Setup CI/CD pipeline",
    tags: ["devops"],
    priority: "high",
  },
  {
    path: "task-2",
    title: "Write unit tests for auth module",
    tags: ["testing"],
    author: "Alice",
    modified: "2026-05-14T10:00:00Z",
  },
  {
    path: "task-3",
    title: "Design new landing page",
    tags: ["design", "marketing"],
    due: "2026-05-22",
  },
];

const meta: Meta<typeof KanbanColumn> = {
  title: "Kanban/KanbanColumn",
  component: KanbanColumn,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <KanbanDragProvider>
        <div className="p-4 bg-background text-foreground">
          <Story />
        </div>
      </KanbanDragProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KanbanColumn>;

export const WithCards: Story = {
  render: () => (
    <KanbanColumn
      id="todo"
      state="To Do"
      color="#3b82f6"
      count={3}
      items={mockPages.map((p) => p.path)}
      onAdd={action("add")}
    >
      {mockPages.map((page) => (
        <KanbanCard key={page.path} page={page} onNavigate={action("navigate")} />
      ))}
    </KanbanColumn>
  ),
};

export const EmptyColumn: Story = {
  render: () => (
    <KanbanColumn
      id="done"
      state="Done"
      color="#22c55e"
      count={0}
      items={[]}
      onAdd={action("add")}
    >
      {null}
    </KanbanColumn>
  ),
};

export const WithWipLimit: Story = {
  render: () => (
    <KanbanColumn
      id="in-progress"
      state="In Progress"
      color="#f59e0b"
      count={3}
      items={mockPages.map((p) => p.path)}
      wipLimit={3}
      onAdd={action("add")}
    >
      {mockPages.map((page) => (
        <KanbanCard key={page.path} page={page} onNavigate={action("navigate")} />
      ))}
    </KanbanColumn>
  ),
};

export const OverWipLimit: Story = {
  render: () => (
    <KanbanColumn
      id="in-progress"
      state="In Progress"
      color="#f59e0b"
      count={3}
      items={mockPages.map((p) => p.path)}
      wipLimit={2}
      onAdd={action("add")}
    >
      {mockPages.map((page) => (
        <KanbanCard key={page.path} page={page} onNavigate={action("navigate")} />
      ))}
    </KanbanColumn>
  ),
};
