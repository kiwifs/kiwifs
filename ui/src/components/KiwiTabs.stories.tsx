import type { Meta, StoryObj } from "@storybook/react";
import { KiwiTabs } from "./KiwiTabs";

const meta: Meta<typeof KiwiTabs> = {
  title: "Content/KiwiTabs",
  component: KiwiTabs,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-lg p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiTabs>;

export const TwoTabs: Story = {
  render: () => (
    <KiwiTabs>
      <div data-kiwi-directive="tab" data-label="Overview">
        <p>This is the overview content. It provides a high-level summary of the topic.</p>
      </div>
      <div data-kiwi-directive="tab" data-label="Details">
        <p>This is the details content with more specific information.</p>
        <ul>
          <li>Detail point one</li>
          <li>Detail point two</li>
          <li>Detail point three</li>
        </ul>
      </div>
    </KiwiTabs>
  ),
};

export const ThreeTabs: Story = {
  render: () => (
    <KiwiTabs>
      <div data-kiwi-directive="tab" data-label="JavaScript">
        <pre className="text-sm bg-muted p-3 rounded-md"><code>{`function hello() {\n  console.log("Hello!");\n}`}</code></pre>
      </div>
      <div data-kiwi-directive="tab" data-label="Python">
        <pre className="text-sm bg-muted p-3 rounded-md"><code>{`def hello():\n    print("Hello!")`}</code></pre>
      </div>
      <div data-kiwi-directive="tab" data-label="Rust">
        <pre className="text-sm bg-muted p-3 rounded-md"><code>{`fn main() {\n    println!("Hello!");\n}`}</code></pre>
      </div>
    </KiwiTabs>
  ),
};

export const Empty: Story = {
  render: () => (
    <KiwiTabs>
      <p>No tab children here</p>
    </KiwiTabs>
  ),
};
