import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesSortPanel, type SortKey } from "./BasesSortPanel";

const PROPERTIES = ["title", "status", "priority", "created_at", "assignee"];

function Harness({ initial }: { initial: SortKey[] }) {
  const [sorts, setSorts] = useState(initial);
  return (
    <div className="max-w-md rounded-lg border border-border bg-card p-3 text-foreground">
      <BasesSortPanel
        sorts={sorts}
        onChange={(next) => {
          setSorts(next);
          action("change")(next);
        }}
        properties={PROPERTIES}
        onClose={action("close")}
      />
    </div>
  );
}

const meta: Meta<typeof BasesSortPanel> = {
  title: "Bases/BasesSortPanel",
  component: BasesSortPanel,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof BasesSortPanel>;

export const Empty: Story = {
  render: () => <Harness initial={[]} />,
};

export const MultiSort: Story = {
  render: () => (
    <Harness
      initial={[
        { id: "s1", property: "priority", direction: "desc" },
        { id: "s2", property: "title", direction: "asc" },
      ]}
    />
  ),
};
