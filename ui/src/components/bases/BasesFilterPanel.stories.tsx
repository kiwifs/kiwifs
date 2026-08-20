import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { BasesFilterPanel, type ViewFilter } from "./BasesFilterPanel";

const PROPERTIES = ["title", "status", "priority", "assignee"];

function Harness({ initial }: { initial: ViewFilter[] }) {
  const [filters, setFilters] = useState(initial);
  const [conjunction, setConjunction] = useState<"and" | "or">("and");
  return (
    <div className="max-w-md rounded-lg border border-border bg-card p-3 text-foreground">
      <BasesFilterPanel
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          action("change")(next);
        }}
        conjunction={conjunction}
        onConjunctionChange={setConjunction}
        properties={PROPERTIES}
        onClose={action("close")}
      />
    </div>
  );
}

const meta: Meta<typeof BasesFilterPanel> = {
  title: "Bases/BasesFilterPanel",
  component: BasesFilterPanel,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof BasesFilterPanel>;

export const Empty: Story = {
  render: () => <Harness initial={[]} />,
};

export const WithFilters: Story = {
  render: () => (
    <Harness
      initial={[
        { property: "status", op: "equals", value: "published" },
        { property: "title", op: "contains", value: "search" },
      ]}
    />
  ),
};
