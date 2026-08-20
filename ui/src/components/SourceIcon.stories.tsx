import type { Meta, StoryObj } from "@storybook/react";
import { SourceIcon } from "./SourceIcon";

const SOURCES = [
  "markdown",
  "obsidian",
  "csv",
  "json",
  "jsonl",
  "yaml",
  "excel",
  "sqlite",
  "postgres",
  "mysql",
  "mongodb",
  "firestore",
  "firebase-rtdb",
  "notion",
  "airtable",
  "unknown-source",
];

const meta: Meta<typeof SourceIcon> = {
  title: "UI/SourceIcon",
  component: SourceIcon,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof SourceIcon>;

export const AllSources: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-4 p-4 bg-background text-foreground sm:grid-cols-6">
      {SOURCES.map((source) => (
        <div key={source} className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
          <SourceIcon source={source} size={28} />
          <span>{source}</span>
        </div>
      ))}
    </div>
  ),
};

export const Default: Story = {
  args: { source: "postgres", size: 32 },
};
