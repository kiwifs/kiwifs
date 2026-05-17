import type { Meta, StoryObj } from "@storybook/react";
import { KiwiColumns } from "./KiwiColumns";

const meta: Meta<typeof KiwiColumns> = {
  title: "Content/KiwiColumns",
  component: KiwiColumns,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4 bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiColumns>;

export const TwoEqualColumns: Story = {
  render: () => (
    <KiwiColumns>
      <div data-kiwi-directive="col">
        <h3 className="font-semibold mb-2">Left Column</h3>
        <p className="text-sm text-muted-foreground">
          Content on the left side. This demonstrates equal width columns
          that stack on mobile.
        </p>
      </div>
      <div data-kiwi-directive="col">
        <h3 className="font-semibold mb-2">Right Column</h3>
        <p className="text-sm text-muted-foreground">
          Content on the right side. Both columns take equal space by default.
        </p>
      </div>
    </KiwiColumns>
  ),
};

export const ThreeColumns: Story = {
  render: () => (
    <KiwiColumns>
      <div data-kiwi-directive="col">
        <h4 className="font-semibold mb-1">First</h4>
        <p className="text-sm text-muted-foreground">Column one content.</p>
      </div>
      <div data-kiwi-directive="col">
        <h4 className="font-semibold mb-1">Second</h4>
        <p className="text-sm text-muted-foreground">Column two content.</p>
      </div>
      <div data-kiwi-directive="col">
        <h4 className="font-semibold mb-1">Third</h4>
        <p className="text-sm text-muted-foreground">Column three content.</p>
      </div>
    </KiwiColumns>
  ),
};

export const CustomRatio: Story = {
  render: () => (
    <KiwiColumns ratio="2:1">
      <div data-kiwi-directive="col">
        <h3 className="font-semibold mb-2">Main Content (2fr)</h3>
        <p className="text-sm text-muted-foreground">
          This column takes up 2/3 of the space due to the 2:1 ratio.
          Use ratios to give more space to primary content.
        </p>
      </div>
      <div data-kiwi-directive="col">
        <h3 className="font-semibold mb-2">Sidebar (1fr)</h3>
        <p className="text-sm text-muted-foreground">Smaller sidebar.</p>
      </div>
    </KiwiColumns>
  ),
};

export const ExplicitColCount: Story = {
  render: () => (
    <KiwiColumns cols="4">
      <div data-kiwi-directive="col">
        <div className="h-16 bg-primary/10 rounded-md flex items-center justify-center text-sm">1</div>
      </div>
      <div data-kiwi-directive="col">
        <div className="h-16 bg-primary/10 rounded-md flex items-center justify-center text-sm">2</div>
      </div>
      <div data-kiwi-directive="col">
        <div className="h-16 bg-primary/10 rounded-md flex items-center justify-center text-sm">3</div>
      </div>
      <div data-kiwi-directive="col">
        <div className="h-16 bg-primary/10 rounded-md flex items-center justify-center text-sm">4</div>
      </div>
    </KiwiColumns>
  ),
};
