import type { Meta, StoryObj } from "@storybook/react";
import { KiwiWidget } from "./KiwiWidget";

/**
 * `widget:live` fences as readers see them: authored code, the live scope,
 * and playback. Click a widget, then use ← → Space r to drive it.
 */
const meta: Meta<typeof KiwiWidget> = {
  title: "Widgets/Live",
  component: KiwiWidget,
  parameters: { layout: "padded" },
  args: { name: "live" },
  argTypes: {
    name: { control: false },
    source: { control: "text" },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-background p-4 text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof KiwiWidget>;

const COIN_CHANGE = `const coins = [1, 2, 5];
const amount = 7;
const steps = [];
const dp = Array(amount + 1).fill(null);
dp[0] = 0;
steps.push({ dp: dp.slice(), i: 0, label: "dp[0] = 0 — no coins make 0" });
for (let i = 1; i <= amount; i++) {
  let best = null, from = null, coin = null;
  for (const c of coins) {
    if (c > i || dp[i - c] == null) continue;
    if (best == null || dp[i - c] + 1 < best) { best = dp[i - c] + 1; from = i - c; coin = c; }
  }
  dp[i] = best;
  steps.push({
    dp: dp.slice(), i, from, coin,
    label: "dp[" + i + "] = dp[" + from + "] + 1 using coin " + coin,
  });
}

function CoinChange() {
  const pb = usePlayback(steps, { interval: 900 });
  const s = pb.current;
  const reading = s.from != null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ArrayView
        label="dp"
        values={s.dp}
        activeIndex={s.i}
        readIndices={reading ? [s.from] : []}
        arrows={reading ? [{ from: s.from, to: s.i, label: "+1 (coin " + s.coin + ")" }] : []}
        ranges={reading ? [{ start: s.from, end: s.i, label: "w = " + s.coin, side: "bottom" }] : []}
        pointers={[{ index: s.i, label: "i" }]}
      />
      <AnnotationBar label={"Step " + (pb.currentStep + 1)} text={s.label} variant={pb.currentStep === steps.length - 1 ? "success" : "info"} />
      <PlaybackControls pb={pb} />
    </div>
  );
}

render(<CoinChange />);`;

export const DpTabulation: Story = {
  name: "DP tabulation (reads, arcs, ranges)",
  args: { source: COIN_CHANGE },
};

const UNION_FIND = `const steps = [
  { parents: [0, 1, 2, 3, 4, 5], label: "Six singletons" },
  { parents: [0, 0, 2, 3, 4, 5], active: [1], label: "union(0, 1): 1 points at 0" },
  { parents: [0, 0, 2, 2, 4, 5], active: [3], label: "union(2, 3): 3 points at 2" },
  { parents: [0, 0, 0, 2, 4, 5], active: [2], label: "union(1, 3): roots 0 and 2 — attach 2 under 0" },
  { parents: [0, 0, 0, 2, 4, 4], active: [5], label: "union(4, 5): 5 points at 4" },
  { parents: [0, 0, 0, 0, 4, 4], active: [3], ghost: [{ from: 2, to: 3 }], label: "find(3) compresses the path: 3 now points straight at 0" },
];

function rootOf(p, i) { while (p[i] !== i) i = p[i]; return i; }

function UnionFind() {
  const pb = usePlayback(steps, { interval: 1200 });
  const s = pb.current;
  const roots = Array.from(new Set(s.parents.map((_, i) => rootOf(s.parents, i))));
  const colors = s.parents.map((_, i) => groupColor(roots.indexOf(rootOf(s.parents, i))));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TreeView
        parents={s.parents}
        nodeColors={colors}
        edgeDirection="up"
        activeNodes={new Set(s.active || [])}
        ghostEdges={s.ghost || []}
        nodeSize={32}
      />
      <ArrayView label="parent" values={s.parents} cellColors={colors} activeIndex={(s.active || [])[0]} cellSize={36} />
      <AnnotationBar text={s.label} />
      <PlaybackControls pb={pb} />
    </div>
  );
}

render(<UnionFind />);`;

export const AnimatedForest: Story = {
  name: "Animated forest (union-find)",
  args: { source: UNION_FIND },
  parameters: {
    docs: {
      description: {
        story: "Nodes glide to new positions between steps; group colors track each component, and path compression leaves a ghost edge.",
      },
    },
  },
};

const BUY_SELL = `const price = [3, 1, 4, 1, 5];
const steps = [];
let hold = -price[0], free = 0;
const H = [hold], F = [free];
steps.push({ day: 0, label: "Day 0: buy at 3 to start holding, or stay free with 0" });
for (let d = 1; d < price.length; d++) {
  const buy = free - price[d] > hold;
  const sell = hold + price[d] > free;
  const nh = buy ? free - price[d] : hold;
  const nf = sell ? hold + price[d] : free;
  hold = nh; free = nf; H.push(hold); F.push(free);
  const moves = [buy ? "buy at " + price[d] : null, sell ? "sell at " + price[d] : null].filter(Boolean);
  steps.push({
    day: d, buy, sell,
    label: "Day " + d + ": " + (moves.length ? moves.join(" and ") : "keep both states") + " (best holding " + hold + ", best free " + free + ")",
  });
}

function BuySell() {
  const pb = usePlayback(steps, { interval: 1000 });
  const { day: d, buy, sell } = pb.current;
  const pad = (row) => row.map((v, i) => (i <= d ? v : null));
  const arrows = [];
  if (buy) arrows.push({ from: [2, d - 1], to: [1, d], label: "buy" });
  if (sell) arrows.push({ from: [1, d - 1], to: [2, d], label: "sell" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ArrayStack
        rows={[
          { label: "price", values: price, highlightIndices: [d] },
          { label: "hold", values: pad(H), activeIndex: d, readIndices: d ? [d - 1] : [] },
          { label: "free", values: pad(F), activeIndex: d, readIndices: d ? [d - 1] : [] },
        ]}
        arrows={arrows}
        indexLabels={price.map((_, i) => "d" + i)}
      />
      <AnnotationBar text={pb.current.label} />
      <PlaybackControls pb={pb} />
    </div>
  );
}

render(<BuySell />);`;

export const StateMachineRows: Story = {
  name: "State-machine DP (ArrayStack)",
  args: { source: BUY_SELL },
};

const MERMAID_WALK = `const chart = [
  "graph LR",
  "  U((User)) --> CDN[CDN]",
  "  CDN -->|miss| LB{{Load balancer}}",
  "  LB --> API[API]",
  "  API --> C[(Redis)]",
  "  API --> DB[(Postgres)]",
].join("\\n");

const steps = [
  { focus: ["U", "CDN"], label: "The request hits the CDN" },
  { focus: ["CDN", "LB"], label: "Cache miss: forward to the load balancer" },
  { focus: ["LB", "API"], label: "Route to a healthy API instance" },
  { focus: ["API->C"], label: "Try Redis first" },
  { focus: ["API", "DB"], dim: ["C"], label: "Miss again: read Postgres" },
];

function Walk() {
  const pb = usePlayback(steps, { interval: 1400 });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <MermaidView chart={chart} focus={pb.current.focus} dim={pb.current.dim} />
      <AnnotationBar text={pb.current.label} />
      <PlaybackControls pb={pb} />
    </div>
  );
}

render(<Walk />);`;

export const SteppedMermaid: Story = {
  name: "Stepped Mermaid (request path)",
  args: { source: MERMAID_WALK },
  parameters: {
    docs: { description: { story: "A new `focus` only repaints emphasis, so playback walks a request through one rendered diagram." } },
  },
};

const SEQUENCE = `const items = [
  { from: "c", to: "api", label: "POST /orders" },
  { from: "api", to: "db", label: "INSERT order + outbox row" },
  { from: "db", to: "api", label: "commit", kind: "reply" },
  { note: "one transaction", over: ["api", "db"] },
  { from: "q", to: "q", label: "relay polls", kind: "async" },
  { from: "api", to: "c", label: "201 Created", kind: "reply" },
];
const steps = items.map((item, i) => ({ label: item.label || item.note }));

function Outbox() {
  const pb = usePlayback(steps, { interval: 1100 });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SequenceView
        participants={[
          { id: "c", label: "Client", shape: "person" },
          { id: "api", label: "API" },
          { id: "db", label: "DB", shape: "cylinder" },
          { id: "q", label: "Outbox", shape: "queue" },
        ]}
        items={items}
        step={pb.currentStep}
        numbered
      />
      <PlaybackControls pb={pb} />
    </div>
  );
}

render(<Outbox />);`;

export const SteppedSequence: Story = {
  name: "Stepped SequenceView (outbox pattern)",
  args: { source: SEQUENCE },
};

export const ScopedPlaybackKeys: Story = {
  name: "Scoped playback keys (two widgets)",
  render: () => (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Click either widget, then press → or Space. Only the widget you touched advances.
      </p>
      <KiwiWidget name="live" source={COIN_CHANGE} />
      <KiwiWidget name="live" source={UNION_FIND} />
    </div>
  ),
};

export const RuntimeError: Story = {
  args: {
    source: `function Broken() {
  const pb = usePlayback([{ label: "only step" }]);
  return <ArrayView values={pb.current.missing.values} />;
}

render(<Broken />);`,
  },
};
