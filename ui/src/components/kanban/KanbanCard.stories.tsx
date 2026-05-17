import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { KanbanCard } from "./KanbanCard";
import { KanbanDragProvider } from "./KanbanDragProvider";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { WorkflowPage } from "@kw/lib/api";

const meta: Meta<typeof KanbanCard> = {
  title: "Kanban/KanbanCard",
  component: KanbanCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <KanbanDragProvider>
        <SortableContext items={["page-1"]} strategy={verticalListSortingStrategy}>
          <div className="max-w-[18rem] p-4 bg-background text-foreground">
            <Story />
          </div>
        </SortableContext>
      </KanbanDragProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KanbanCard>;

const basePage: WorkflowPage = {
  path: "page-1",
  title: "Implement search filtering",
};

export const Simple: Story = {
  args: {
    page: basePage,
    onNavigate: action("navigate"),
  },
};

export const WithTags: Story = {
  args: {
    page: {
      ...basePage,
      title: "Add dark mode support",
      tags: ["frontend", "ui", "enhancement"],
    },
    onNavigate: action("navigate"),
  },
};

export const WithPriority: Story = {
  args: {
    page: {
      ...basePage,
      title: "Fix critical auth bug",
      priority: "critical",
      tags: ["bug"],
    },
    onNavigate: action("navigate"),
  },
};

export const WithDueDate: Story = {
  args: {
    page: {
      ...basePage,
      title: "Complete API documentation",
      due: "2026-05-20",
      author: "Alice Chen",
      tags: ["docs"],
    },
    onNavigate: action("navigate"),
  },
};

export const Overdue: Story = {
  args: {
    page: {
      ...basePage,
      title: "Submit quarterly report",
      due: "2026-01-15",
      author: "Bob Smith",
      priority: "high",
    },
    onNavigate: action("navigate"),
  },
};

export const Blocked: Story = {
  args: {
    page: {
      ...basePage,
      title: "Deploy to production",
      blocked: true,
      block_reason: "Waiting on security review",
      tags: ["devops"],
    },
    onNavigate: action("navigate"),
  },
};

export const WithDependencies: Story = {
  args: {
    page: {
      ...basePage,
      title: "Build notification system",
      depends_on: ["setup-webhooks.md", "design-notification-schema.md"],
      description: "Full notification system with email and push support",
      author: "Charlie Dev",
      tags: ["backend", "feature"],
      modified: "2026-05-14T10:30:00Z",
    },
    onNavigate: action("navigate"),
  },
};

export const FullyLoaded: Story = {
  args: {
    page: {
      ...basePage,
      title: "Redesign settings page",
      priority: "high",
      tags: ["design", "frontend", "ux", "sprint-12"],
      due: "2026-05-25",
      author: "Diana UX",
      description: "Complete overhaul of settings with new navigation patterns",
      depends_on: ["design-system-v2.md"],
      modified: "2026-05-15T08:00:00Z",
    },
    onNavigate: action("navigate"),
  },
};
