import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import { ActivityGrid } from "./ActivityGrid";
import { AnnotationBar } from "./AnnotationBar";
import { ArrayView } from "./ArrayView";
import { BarView } from "./BarView";
import { PlotView } from "./PlotView";
import { CallStackView } from "./CallStackView";
import { CodeHighlight } from "./CodeHighlight";
import { DateField } from "./DateField";
import { GraphView } from "./GraphView";
import { InputPanel } from "./InputPanel";
import { LinkedListView } from "./LinkedListView";
import { MatrixView } from "./MatrixView";
import { PlaybackControls } from "./PlaybackControls";
import { PropertyBar } from "./PropertyBar";
import { StackView } from "./StackView";
import { StateInspector } from "./StateInspector";
import { TimelineView } from "./TimelineView";
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

/** A trie: repeated letters, so every node needs its own id. */
const TRIE = {
  value: "•",
  id: "root",
  children: [
    {
      value: "c",
      id: "c",
      edgeLabel: "c",
      children: [
        {
          value: "a",
          id: "ca",
          edgeLabel: "a",
          children: [
            { value: "t", id: "cat", edgeLabel: "t", badge: "✓", children: [] },
            { value: "r", id: "car", edgeLabel: "r", badge: "✓", children: [] },
          ],
        },
      ],
    },
    {
      value: "a",
      id: "a",
      edgeLabel: "a",
      children: [{ value: "t", id: "at", edgeLabel: "t", badge: "✓", children: [] }],
    },
  ],
};

/** Two disjoint-set trees, drawn side by side. */
const FOREST = [
  { value: 0, children: [{ value: 2, children: [] }, { value: 5, children: [] }] },
  { value: 1, children: [{ value: 3, children: [{ value: 4, children: [] }] }] },
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
  const [day, setDay] = useState("2026-08-04");
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

      <Section name="PlotView — density, shade, scatter">
        <WidgetLayout>
          <WidgetPanel title="line + area shade" minWidth={280}>
            <PlotView
              series={[
                {
                  id: "pdf",
                  label: "N(0,1)",
                  kind: "area",
                  points: Array.from({ length: 61 }, (_, i) => {
                    const x = -3 + i * 0.1;
                    return { x, y: Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI) };
                  }),
                },
              ]}
              shades={[{ from: -1, to: 1, series: "pdf", label: "68%" }]}
              guides={[{ x: 0, label: "μ" }]}
              xMin={-3}
              xMax={3}
              yMin={0}
              width={320}
              height={220}
            />
          </WidgetPanel>
          <WidgetPanel title="scatter" minWidth={280}>
            <PlotView
              series={[
                {
                  id: "cloud",
                  label: "pairs",
                  kind: "scatter",
                  points: [
                    { x: 1, y: 1.2 }, { x: 1.4, y: 1.8 }, { x: 2, y: 2.1 },
                    { x: 2.3, y: 2.9 }, { x: 3, y: 2.7 }, { x: 3.4, y: 3.6 },
                  ],
                },
                {
                  id: "fit",
                  label: "fit",
                  points: [{ x: 1, y: 1.1 }, { x: 3.4, y: 3.5 }],
                },
              ]}
              width={320}
              height={220}
            />
          </WidgetPanel>
        </WidgetLayout>
      </Section>

      <Section name="ArrayView — aligned rows (offset)">
        <div>
          <ArrayView values={["a", "b", "a", "b", "a", "b", "c", "a"]} activeIndex={6} cellSize={36} />
          <ArrayView
            values={["a", "b", "a", "b", "c"]}
            sublabels={[0, 0, 1, 2, 0]}
            offset={2}
            showIndices={false}
            highlightIndices={new Set([0, 1, 2, 3])}
            activeIndex={4}
            cellSize={36}
          />
        </div>
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

      <Section name="MatrixView — axis headers">
        <MatrixView
          values={[
            [0, 1, 2, 3],
            [1, 1, 2, 3],
            [2, 2, 1, 2],
            [3, 3, 2, 2],
          ]}
          colHeaders={["ε", "h", "o", "s"]}
          rowHeaders={["ε", "r", "o", "s"]}
          showIndices={false}
          activeCell={[2, 2]}
          highlightCells={new Set(["1,1", "1,2", "2,1"])}
        />
      </Section>

      <Section name="MatrixView — long headers and math">
        <MatrixView
          values={[
            ["$n^k$", "stars & bars"],
            ["$n^{\\underline{k}}$", "$\\binom{n}{k}$"],
          ]}
          rowHeaders={["replace", "no replace"]}
          colHeaders={["ordered", "unordered"]}
          showIndices={false}
          activeCell={[1, 1]}
          cellSize={110}
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

      <Section name="TreeView — ids, edge labels, badges, pruning">
        <TreeView
          root={TRIE}
          activeNodes={new Set(["ca"])}
          highlightNodes={new Set(["c", "cat"])}
          prunedNodes={new Set(["a", "at"])}
          pointers={[{ id: "ca", label: "node" }]}
          nodeSize={34}
        />
      </Section>

      <Section name="TreeView — forest">
        <TreeView roots={FOREST} activeNodes={new Set([0, 1])} nodeSize={32} />
      </Section>

      <Section name="TreeView — one-sided binary (right stick + left stick)">
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center" }}>
          <TreeView
            root={{ value: 1, right: { value: 2, right: { value: 3 } } }}
            highlightNodes={new Set([1, 2, 3])}
            pointers={[{ value: 3, label: "leaf" }]}
          />
          <TreeView
            root={{ value: 1, left: { value: 2, left: { value: 3 } } }}
            highlightNodes={new Set([1, 2, 3])}
          />
        </div>
      </Section>

      <Section name="TreeView — next-right links">
        <TreeView
          root={TREE}
          nextLinks={[{ from: 3, to: 10 }, { from: 6, to: 14 }]}
        />
      </Section>

      <Section name="GraphView — explicit positions">
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

      <Section name="GraphView — automatic layout">
        <WidgetLayout>
          <WidgetPanel title="force" minWidth={260}>
            <GraphView
              nodes={[1, 2, 3, 4, 5, 6].map((id) => ({ id }))}
              edges={[
                { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 },
                { from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 }, { from: 6, to: 1 },
              ]}
              width={280}
              height={220}
              activeNodes={new Set([4])}
            />
          </WidgetPanel>
          <WidgetPanel title="layered + self-loops" minWidth={260}>
            <GraphView
              nodes={["a", "b", "c", "d", "e"].map((id) => ({ id }))}
              edges={[
                { from: "a", to: "b" }, { from: "a", to: "c" },
                { from: "b", to: "d" }, { from: "c", to: "d" }, { from: "d", to: "e" },
                { from: "a", to: "a" },
              ]}
              layout="layered"
              directed
              width={280}
              height={220}
              highlightNodes={new Set(["a"])}
            />
          </WidgetPanel>
        </WidgetLayout>
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

      <Section name="LinkedListView — cycle">
        <LinkedListView
          nodes={[{ value: 3 }, { value: 2 }, { value: 0 }, { value: -4, next: 1 }]}
          activeIndex={2}
          pointers={[{ index: 2, label: "slow" }, { index: 1, label: "fast" }]}
        />
      </Section>

      <Section name="LinkedListView — doubly linked with a random pointer">
        <LinkedListView
          nodes={[{ value: 7 }, { value: 13 }, { value: 11 }, { value: 10 }]}
          doubly
          edges={[{ from: 1, to: 0, label: "random", side: "above" }]}
          activeIndex={1}
          showNull={false}
        />
      </Section>

      <Section name="StackView">
        <WidgetLayout>
          <WidgetPanel title="monotonic stack" minWidth={200}>
            <StackView
              values={[9, 7, 4]}
              pointers={[{ index: 2, label: "← pop" }]}
              title="stack"
            />
          </WidgetPanel>
          <WidgetPanel title="empty" minWidth={200}>
            <StackView values={[]} title="stack" />
          </WidgetPanel>
        </WidgetLayout>
      </Section>

      <Section name="CallStackView">
        <CallStackView
          frames={[
            { label: "fib(5)", state: { n: 5 }, line: 2 },
            { label: "fib(4)", state: { n: 4 }, line: 2 },
            { label: "fib(3)", state: { n: 3 }, line: 3, returns: 2 },
          ]}
          returned={[{ label: "fib(2)", returns: 1 }]}
        />
      </Section>

      <Section name="TimelineView">
        <TimelineView
          intervals={[
            { start: 0, end: 30, label: "A" },
            { start: 5, end: 10, label: "B" },
            { start: 15, end: 20, label: "C" },
            { start: 25, end: 40, label: "D" },
          ]}
          sweep={17}
          sweepLabel="rooms = 2"
          activeIds={new Set([2])}
          highlightIds={new Set([0])}
          marks={[{ at: 40, label: "end" }]}
          width={520}
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

      <Section name="DateField">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <DateField value={day} onChange={setDay} ariaLabel="Target date" clearable />
          <DateField value="" placeholder="No date yet" />
          <DateField
            value={day}
            min={day}
            max="2027-12-31"
            weekStartsOn={1}
            ariaLabel="Bounded date"
          />
        </div>
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
