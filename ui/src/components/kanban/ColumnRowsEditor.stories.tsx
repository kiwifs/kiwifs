import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { ColumnRowsEditor, type EditStateRow } from "./ColumnRowsEditor";

const defaultRows: EditStateRow[] = [
  { id: "1", name: "To Do", color: "#3b82f6" },
  { id: "2", name: "In Progress", color: "#f59e0b" },
  { id: "3", name: "Done", color: "#22c55e" },
];

const meta: Meta<typeof ColumnRowsEditor> = {
  title: "Kanban/ColumnRowsEditor",
  component: ColumnRowsEditor,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ColumnRowsEditor>;

export const Default: Story = {
  args: {
    rows: defaultRows,
    disabled: false,
    onAdd: action("add"),
    onRemove: action("remove"),
    onNameChange: action("nameChange"),
    onColorChange: action("colorChange"),
  },
};

export const WithWipLimits: Story = {
  args: {
    rows: [
      { id: "1", name: "Backlog", color: "#6b7280" },
      { id: "2", name: "In Progress", color: "#f59e0b", wip_limit: 3 },
      { id: "3", name: "Review", color: "#8b5cf6", wip_limit: 2 },
      { id: "4", name: "Done", color: "#22c55e" },
    ],
    disabled: false,
    onAdd: action("add"),
    onRemove: action("remove"),
    onNameChange: action("nameChange"),
    onColorChange: action("colorChange"),
    onWipLimitChange: action("wipLimitChange"),
  },
};

export const SingleColumn: Story = {
  args: {
    rows: [{ id: "1", name: "Tasks", color: "#3b82f6" }],
    disabled: false,
    onAdd: action("add"),
    onRemove: action("remove"),
    onNameChange: action("nameChange"),
    onColorChange: action("colorChange"),
  },
};

export const Disabled: Story = {
  args: {
    rows: defaultRows,
    disabled: true,
    onAdd: action("add"),
    onRemove: action("remove"),
    onNameChange: action("nameChange"),
    onColorChange: action("colorChange"),
  },
};

function InteractiveHarness() {
  const [rows, setRows] = useState<EditStateRow[]>([...defaultRows]);
  let counter = rows.length + 1;

  return (
    <ColumnRowsEditor
      rows={rows}
      disabled={false}
      onAdd={() => {
        const id = String(++counter);
        setRows((prev) => [...prev, { id, name: "", color: "#9B59B6" }]);
      }}
      onRemove={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
      onNameChange={(id, name) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)))
      }
      onColorChange={(id, color) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, color } : r)))
      }
      onWipLimitChange={(id, wip_limit) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, wip_limit } : r)))
      }
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveHarness />,
};
