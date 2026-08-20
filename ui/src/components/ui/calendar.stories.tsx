import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Calendar } from "./calendar";

function Example() {
  const [date, setDate] = useState<Date | undefined>(new Date("2026-08-20"));
  return (
    <div className="rounded-lg border border-border bg-background p-2 text-foreground">
      <Calendar mode="single" selected={date} onSelect={setDate} />
    </div>
  );
}

const meta: Meta<typeof Example> = {
  title: "UI/Calendar",
  component: Example,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Example>;

export const Default: Story = {};
