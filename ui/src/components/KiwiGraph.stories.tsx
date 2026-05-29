import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import { userEvent, within } from "@storybook/test";
import { KiwiGraph } from "./KiwiGraph";
import { MockApiProvider, type MockOverrides } from "./__mocks__/apiMock";
import {
  mockGraphEdgesLarge,
  mockGraphNodesLarge,
  mockTree,
} from "./__mocks__/data";

const loadedGraph: MockOverrides = {
  tree: mockTree,
  graphNodes: mockGraphNodesLarge,
  graphEdges: mockGraphEdgesLarge,
};

const emptyGraph: MockOverrides = {
  tree: mockTree,
  graphNodes: [],
  graphEdges: [],
};

const graphLoadError: MockOverrides = {
  tree: mockTree,
  graphError: "Failed to load graph data",
};

const meta: Meta<typeof KiwiGraph> = {
  title: "Graph/KiwiGraph",
  component: KiwiGraph,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof KiwiGraph>;

function renderGraph(overrides: MockOverrides, activePath?: string | null) {
  return (
    <MockApiProvider overrides={overrides}>
      <div className="h-screen bg-background text-foreground">
        <KiwiGraph
          tree={mockTree}
          activePath={activePath ?? null}
          onNavigate={action("navigate")}
          onClose={action("close-graph")}
        />
      </div>
    </MockApiProvider>
  );
}

export const Loaded2D: Story = {
  render: () => renderGraph(loadedGraph),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Knowledge graph");
  },
};

export const WithActivePage: Story = {
  render: () => renderGraph(loadedGraph, "pages/frontmatter.md"),
};

export const EmptyGraph: Story = {
  render: () => renderGraph(emptyGraph),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("No pages yet.");
  },
};

export const LoadError: Story = {
  render: () => renderGraph(graphLoadError),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Failed to load graph data");
  },
};

export const SearchHighlight: Story = {
  render: () => renderGraph(loadedGraph),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByPlaceholderText("Highlight...");
    await userEvent.type(search, "kanban");
  },
};
