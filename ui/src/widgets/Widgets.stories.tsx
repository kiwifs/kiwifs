import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import { ActivityGrid } from "./ActivityGrid";
import { AnnotationBar } from "./AnnotationBar";
import { ArrayView } from "./ArrayView";
import { BarView } from "./BarView";
import { CodeHighlight } from "./CodeHighlight";
import { GraphView } from "./GraphView";
import { InputPanel } from "./InputPanel";
import { LinkedListView } from "./LinkedListView";
import { MatrixView } from "./MatrixView";
import { PlaybackControls } from "./PlaybackControls";
import { PropertyBar } from "./PropertyBar";
import { StateInspector } from "./StateInspector";
import { TreeView } from "./TreeView";
import { WidgetLayout, WidgetPanel } from "./WidgetLayout";

/**
 * Every widget rendered together so the whole library can be reviewed in one
 * pass. Flip the Theme toolbar control to check both surfaces — widgets are
 * embedded in author-written markdown and have no per-page styling to fall
 * back on, so each must stand on its own in light and dark.
 */

function Section({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2
        style={{
          margin: 0,
          fontSize: "0.7rem",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted-foreground)",
        }}
      >
        {name}
      </h2>
      <div className="kiwi-widget">{children}</div>
    </section>
  );
}

const TREE = {
  value: 8,
  left: { value: 3, left: { value: 1 }, right: { value: 6 } },
  right: { value: 10, right: { value: 14, left: { value: 13 } } },
};

const GRAPH_NODES = [
  { id: "a", x: 40, y: 90, label: "A" },
  { id: "b", x: 150, y: 30, label: "B" },
  { id: "c", x: 150, y: 150, label: "C" },
  { id: "d", x: 265, y: 90, label: "D" },
];

const GRAPH_EDGES = [
  { from: "a", to: "b", weight: 4 },
  { from: "a", to: "c", weight: 2 },
  { from: "b", to: "d", weight: 5 },
  { from: "c", to: "d", weight: 8 },
];

const CODE = [
  "def two_sum(nums, target):",
  "    seen = {}",
  "    for i, n in enumerate(nums):",
  "        if target - n in seen:",
  "            return [seen[target - n], i]",
  "        seen[n] = i",
  "    return []",
];

function activityData(): Record<string, number> {
  const data: Record<string, number> = {};
  const today = new Date();
  for (let i = 0; i < 120; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (i % 7 === 3 || i % 11 === 0) continue;
    data[iso] = (i * 7) % 13;
  }
  return data;
}

function Gallery() {
  const [inputs, setInputs] = useState<Record<string, unknown>>({
    nums: [2, 7, 11, 15],
    target: 9,
    label: "two-sum",
    verbose: true,
  });
  const [step, setStep] = useState(3);
  const [playing, setPlaying] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        padding: 32,
        background: "var(--background)",
        color: "var(--foreground)",
        minHeight: "100vh",
        fontFamily: "var(--font-sans)",
      }}
    >
      <Section name="ArrayView">
        <ArrayView
          values={[2, 7, 11, 15, 3, 6]}
          sublabels={["a", "b", null, null, "c", null]}
          activeIndex={2}
          highlightIndices={new Set([0, 1])}
          dimIndices={new Set([5])}
          pointers={[
            { index: 0, label: "L" },
            { index: 4, label: "R" },
          ]}
        />
      </Section>

      <Section name="BarView">
        <BarView
          values={[4, 8, 2, 9, 5, 7, 3]}
          labels={["a", "b", "c", "d", "e", "f", "g"]}
          valueLabels
          activeIndices={new Set([3])}
          highlightIndices={new Set([1, 5])}
          dimIndices={new Set([2])}
          pointers={[{ index: 3, label: "max" }]}
          guides={[{ value: 6, label: "threshold" }]}
        />
      </Section>

      <Section name="MatrixView">
        <MatrixView
          values={[
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
          ]}
          activeCell={[1, 1]}
          highlightCells={new Set(["0,0", "2,2"])}
          dimCells={new Set(["0,2"])}
          rowPointers={[{ row: 1, label: "r" }]}
          colPointers={[{ col: 1, label: "c" }]}
          showIndices
        />
      </Section>

      <Section name="TreeView">
        <TreeView
          root={TREE}
          activeNodes={new Set([6])}
          highlightNodes={new Set([3, 10])}
          dimNodes={new Set([1])}
          pointers={[{ value: 6, label: "cur" }]}
        />
      </Section>

      <Section name="GraphView">
        <GraphView
          nodes={GRAPH_NODES}
          edges={GRAPH_EDGES}
          directed
          activeNodes={new Set(["c"])}
          highlightNodes={new Set(["a"])}
          dimNodes={new Set(["b"])}
          highlightEdges={new Set(["a-c"])}
          pointers={[{ id: "c", label: "visit" }]}
        />
      </Section>

      <Section name="LinkedListView">
        <LinkedListView
          nodes={[{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]}
          activeIndex={1}
          highlightIndices={new Set([2])}
          dimIndices={new Set([0])}
          pointers={[{ index: 1, label: "slow" }, { index: 3, label: "fast" }]}
          showNull
        />
      </Section>

      <Section name="ActivityGrid">
        <ActivityGrid data={activityData()} weeks={18} summary="Sample activity" />
      </Section>

      <Section name="PropertyBar">
        <PropertyBar
          title="State"
          entries={[
            { label: "i", value: 3 },
            { label: "sum", value: 42, changed: true },
            { label: "found", value: false },
            { label: "window", value: "[1, 4]" },
          ]}
        />
      </Section>

      <Section name="StateInspector">
        <StateInspector
          title="Locals"
          state={{
            index: 7,
            name: "two-sum",
            done: false,
            seen: [2, 7, 11],
            table: { a: 1, b: 2 },
            missing: null,
          }}
          changedKeys={new Set(["index", "seen"])}
        />
      </Section>

      <Section name="InputPanel">
        <InputPanel
          title="Inputs"
          fields={[
            { key: "nums", label: "nums", type: "array", defaultValue: [2, 7, 11, 15] },
            { key: "target", label: "target", type: "number", defaultValue: 9 },
            { key: "label", label: "label", type: "text", defaultValue: "two-sum" },
            { key: "verbose", label: "verbose", type: "boolean", defaultValue: true },
          ]}
          values={inputs}
          onChange={(key, value) => setInputs((prev) => ({ ...prev, [key]: value }))}
        />
      </Section>

      <Section name="CodeHighlight">
        <CodeHighlight code={CODE} activeLine={3} title="two_sum" lang="python" />
      </Section>

      <Section name="AnnotationBar">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <AnnotationBar
            label="Step 3"
            variant="info"
            text="Look up **target - n** in `seen` before inserting, so an element never pairs with itself."
          />
          <AnnotationBar variant="success" text="Found a pair — *return immediately*." />
          <AnnotationBar variant="warning" text="No pair exists; the loop falls through to `return []`." />
        </div>
      </Section>

      <Section name="PlaybackControls">
        <PlaybackControls
          currentStep={step}
          totalSteps={12}
          playing={playing}
          speed={1}
          onPlay={() => setPlaying((p) => !p)}
          onStop={() => setPlaying(false)}
          onStepForward={() => setStep((s) => Math.min(11, s + 1))}
          onStepBack={() => setStep((s) => Math.max(0, s - 1))}
          onReset={() => setStep(0)}
          onSeek={setStep}
          onCycleSpeed={() => undefined}
        />
      </Section>

      <Section name="WidgetLayout / WidgetPanel">
        <WidgetLayout>
          <WidgetPanel title="Array" minWidth={220}>
            <ArrayView values={[5, 1, 4]} activeIndex={1} />
          </WidgetPanel>
          <WidgetPanel title="State" minWidth={220}>
            <PropertyBar entries={[{ label: "i", value: 1 }, { label: "n", value: 3 }]} />
          </WidgetPanel>
        </WidgetLayout>
      </Section>
    </div>
  );
}

const meta: Meta<typeof Gallery> = {
  title: "Widgets/Gallery",
  component: Gallery,
  parameters: { layout: "fullscreen" },
};

export default meta;

export const AllWidgets: StoryObj<typeof Gallery> = {};
