import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { within } from "@storybook/test";
import { KiwiBases } from "./KiwiBases";
import { MockApiProvider, type MockOverrides } from "./__mocks__/apiMock";
import { mockBasesViews } from "./__mocks__/data";

const tableView: MockOverrides = {
  views: [mockBasesViews[0]!],
};

const cardsView: MockOverrides = {
  views: [mockBasesViews[1]!],
};

const listView: MockOverrides = {
  views: [mockBasesViews[2]!],
};

const mapView: MockOverrides = {
  views: [mockBasesViews[3]!],
};

const allViews: MockOverrides = {
  views: mockBasesViews,
};

const emptyWorkspace: MockOverrides = {
  views: [],
};

const meta: Meta<typeof KiwiBases> = {
  title: "Bases/KiwiBases",
  component: KiwiBases,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof KiwiBases>;

function renderBases(overrides: MockOverrides) {
  return (
    <MockApiProvider overrides={overrides}>
      <div className="h-screen bg-background text-foreground">
        <KiwiBases onClose={action("close-bases")} onNavigate={action("navigate")} />
      </div>
    </MockApiProvider>
  );
}

export const TableView: Story = {
  render: () => renderBases(tableView),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Bases");
    await canvas.findByText("Frontmatter Guide");
    await canvas.findByText("published");
  },
};

export const CardsView: Story = {
  render: () => renderBases(cardsView),
};

export const ListView: Story = {
  render: () => renderBases(listView),
};

export const MapView: Story = {
  render: () => renderBases(mapView),
};

export const AllViews: Story = {
  render: () => renderBases(allViews),
};

export const EmptyWorkspace: Story = {
  render: () => renderBases(emptyWorkspace),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("No views yet. Create one to get started.");
  },
};
