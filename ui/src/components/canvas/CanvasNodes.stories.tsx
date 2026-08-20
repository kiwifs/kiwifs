import type { Meta, StoryObj } from "@storybook/react";
import { action } from "@storybook/addon-actions";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import CanvasTextNode from "./CanvasTextNode";
import CanvasFileNode from "./CanvasFileNode";
import CanvasLinkNode from "./CanvasLinkNode";
import CanvasGroupNode from "./CanvasGroupNode";

const nodeTypes = {
  text: CanvasTextNode,
  file: CanvasFileNode,
  link: CanvasLinkNode,
  group: CanvasGroupNode,
};

const nodes: Node[] = [
  {
    id: "group",
    type: "group",
    position: { x: 20, y: 20 },
    data: { text: "Workspace" },
    style: { width: 640, height: 280 },
  },
  {
    id: "text",
    type: "text",
    position: { x: 60, y: 80 },
    data: { text: "Agents write markdown" },
    style: { width: 180, height: 80 },
  },
  {
    id: "file",
    type: "file",
    position: { x: 280, y: 80 },
    data: { file: "pages/frontmatter.md", onNavigate: action("navigate"), color: "#3b82f6" },
    style: { width: 180, height: 80 },
  },
  {
    id: "link",
    type: "link",
    position: { x: 500, y: 80 },
    data: { url: "https://kiwifs.com", color: "#10b981" },
    style: { width: 160, height: 80 },
  },
];

function CanvasPreview({ selected }: { selected?: string }) {
  return (
    <div className="h-[360px] w-full bg-background">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes.map((n) => ({ ...n, selected: n.id === selected }))}
          edges={[]}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

const meta: Meta<typeof CanvasPreview> = {
  title: "Canvas/CanvasNodes",
  component: CanvasPreview,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof CanvasPreview>;

export const AllTypes: Story = {};

export const SelectedFile: Story = {
  args: { selected: "file" },
};
