import { useRef, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { AnnotationBar } from "./AnnotationBar";
import { ArrayStack, ArrayView } from "./ArrayView";
import { BarView } from "./BarView";
import { BitsView } from "./BitsView";
import { CallStackView, type CallFrame } from "./CallStackView";
import { CodeHighlight } from "./CodeHighlight";
import { GraphView } from "./GraphView";
import { LinkedListView, type LLNode } from "./LinkedListView";
import { MapView, type MapSlot } from "./MapView";
import { MatrixView } from "./MatrixView";
import { MemoryView } from "./MemoryView";
import type { HeapObject, StackFrame } from "./memoryTrace";
import { PlaybackControls } from "./PlaybackControls";
import { PlotView, type PlotPoint } from "./PlotView";
import { QueueView } from "./QueueView";
import { SequenceView } from "./SequenceView";
import { StackView } from "./StackView";
import { TimelineView, type TimelineInterval } from "./TimelineView";
import { TreeView, type TreeNode } from "./TreeView";
import { usePlayback, type Step } from "./usePlayback";
import { WidgetRootContext } from "./widgetRoot";

/**
 * Each widget driven through a short walkthrough by `usePlayback`, the way a
 * stepped fence drives it on a page. Widgets that tween or flash between
 * frames only show that here; the Gallery holds one frozen frame of each.
 */

interface Frame {
  label: string;
  /** Shown in the annotation bar under the widget. */
  note: string;
  /** 1-based line in the code listing. */
  line?: number;
  variant?: "info" | "success" | "warning";
}

function frames<S extends Frame>(list: S[]): Step<S>[] {
  return list.map((s) => ({ state: s, label: s.label }));
}

interface PlayerProps<S extends Frame> {
  title: string;
  steps: Step<S>[];
  autoPlay: boolean;
  code?: { title: string; lines: string[] };
  children: (state: S) => ReactNode;
}

function Player<S extends Frame>({ title, steps, autoPlay, code, children }: PlayerProps<S>) {
  const rootRef = useRef<HTMLElement>(null);
  const pb = usePlayback(steps, { containerRef: rootRef, autoPlay, loop: true, interval: 1200 });
  const state = pb.current.state;

  return (
    <div style={{ padding: 24, background: "var(--background)", color: "var(--foreground)", minHeight: "100vh" }}>
      <WidgetRootContext.Provider value={rootRef}>
        <figure
          ref={rootRef}
          tabIndex={-1}
          aria-label={title}
          className="kiwi-widget rounded-lg border border-border bg-card"
          style={{ margin: 0, padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 880 }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0, overflowX: "auto" }}>{children(state)}</div>
            {code && (
              <div style={{ flex: "0 1 340px", minWidth: 0 }}>
                <CodeHighlight code={code.lines} title={code.title} indexBase={1} activeLine={state.line} />
              </div>
            )}
          </div>
          <AnnotationBar label={pb.current.label} text={state.note} variant={state.variant} />
          <PlaybackControls pb={pb} />
        </figure>
      </WidgetRootContext.Provider>
    </div>
  );
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/* ArrayView — binary search */

const SORTED = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];

const SEARCH_CODE = [
  "def search(a, x):",
  "    lo, hi = 0, len(a) - 1",
  "    while lo <= hi:",
  "        mid = (lo + hi) // 2",
  "        if a[mid] == x: return mid",
  "        if a[mid] < x: lo = mid + 1",
  "        else: hi = mid - 1",
  "    return -1",
];

const SEARCH_STEPS = frames<Frame & { lo: number; hi: number; mid?: number }>([
  { label: "start", note: "Look for **23**. The whole array is still in play.", line: 2, lo: 0, hi: 9 },
  { label: "mid = 4", note: "`a[4] = 16`, smaller than 23.", line: 4, lo: 0, hi: 9, mid: 4 },
  { label: "lo = 5", note: "23 can only be right of `mid`, so drop the left half.", line: 6, lo: 5, hi: 9 },
  { label: "mid = 7", note: "`a[7] = 56`, larger than 23.", line: 4, lo: 5, hi: 9, mid: 7 },
  { label: "hi = 6", note: "Drop everything from `mid` rightwards.", line: 7, lo: 5, hi: 6 },
  { label: "mid = 5", note: "`a[5] = 23`. Found after three probes.", line: 5, lo: 5, hi: 6, mid: 5, variant: "success" },
]);

function BinarySearch({ autoPlay }: StoryArgs) {
  return (
    <Player title="Binary search" steps={SEARCH_STEPS} autoPlay={autoPlay} code={{ title: "search", lines: SEARCH_CODE }}>
      {(s) => (
        <ArrayView
          label="a"
          values={SORTED}
          activeIndex={s.mid}
          dimIndices={SORTED.map((_, i) => i).filter((i) => i < s.lo || i > s.hi)}
          ranges={[{ start: s.lo, end: s.hi, label: "window", side: "bottom" }]}
          pointers={[
            { index: s.lo, label: "lo" },
            { index: s.hi, label: "hi" },
            ...(s.mid != null ? [{ index: s.mid, label: "mid", side: "bottom" as const }] : []),
          ]}
          cellSize={40}
        />
      )}
    </Player>
  );
}

/* ArrayStack — prefix sums */

const NUMS = [3, 1, 4, 1, 5, 9];
const PREFIX = NUMS.reduce<number[]>((acc, n, i) => [...acc, (i ? acc[i - 1]! : 0) + n], []);

const PREFIX_STEPS = frames<Frame & { i: number }>(
  NUMS.map((n, i) => ({
    label: `i = ${i}`,
    note:
      i === 0
        ? `\`pre[0] = nums[0] = ${n}\``
        : `\`pre[${i}] = pre[${i - 1}] + nums[${i}] = ${PREFIX[i - 1]} + ${n} = ${PREFIX[i]}\``,
    line: i === 0 ? 1 : 3,
    i,
    variant: i === NUMS.length - 1 ? ("success" as const) : undefined,
  })),
);

function PrefixSums({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Prefix sums"
      steps={PREFIX_STEPS}
      autoPlay={autoPlay}
      code={{ title: "prefix", lines: ["pre[0] = nums[0]", "for i in range(1, n):", "    pre[i] = pre[i - 1] + nums[i]"] }}
    >
      {(s) => (
        <ArrayStack
          rows={[
            { label: "nums", values: NUMS, readIndices: [s.i] },
            {
              label: "pre",
              values: PREFIX.map((v, i) => (i <= s.i ? v : null)),
              activeIndex: s.i,
              readIndices: s.i > 0 ? [s.i - 1] : [],
            },
          ]}
          arrows={[
            { from: [0, s.i], to: [1, s.i] },
            ...(s.i > 0 ? [{ from: [1, s.i - 1] as [number, number], to: [1, s.i] as [number, number], dashed: true }] : []),
          ]}
          cellSize={42}
        />
      )}
    </Player>
  );
}

/* MatrixView — lattice paths */

const GRID_ORDER: [number, number][] = [
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 1],
  [2, 2],
  [2, 3],
];

function pathsTable(filled: number): (number | null)[][] {
  const t: (number | null)[][] = [
    [1, 1, 1, 1],
    [1, null, null, null],
    [1, null, null, null],
  ];
  for (const [r, c] of GRID_ORDER.slice(0, filled)) t[r]![c] = t[r - 1]![c]! + t[r]![c - 1]!;
  return t;
}

const PATHS_STEPS = frames<Frame & { filled: number }>([
  { label: "edges", note: "Along the top row and left column there is only one way to arrive.", line: 1, filled: 0 },
  ...GRID_ORDER.map(([r, c], i) => {
    const t = pathsTable(i + 1);
    return {
      label: `(${r}, ${c})`,
      note: `Arrive from above or from the left: ${t[r - 1]![c]} + ${t[r]![c - 1]} = **${t[r]![c]}**.`,
      line: 4,
      filled: i + 1,
      variant: i === GRID_ORDER.length - 1 ? ("success" as const) : undefined,
    };
  }),
]);

function LatticePaths({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Lattice paths"
      steps={PATHS_STEPS}
      autoPlay={autoPlay}
      code={{
        title: "paths",
        lines: [
          "dp[0][*] = dp[*][0] = 1",
          "for r in range(1, rows):",
          "    for c in range(1, cols):",
          "        dp[r][c] = dp[r-1][c] + dp[r][c-1]",
        ],
      }}
    >
      {(s) => {
        const cell = s.filled > 0 ? GRID_ORDER[s.filled - 1]! : null;
        const from: [number, number][] = cell ? [[cell[0] - 1, cell[1]], [cell[0], cell[1] - 1]] : [];
        return (
          <MatrixView
            values={pathsTable(s.filled)}
            activeCell={cell ?? undefined}
            readCells={from}
            arrows={cell ? from.map((f) => ({ from: f, to: cell })) : []}
            highlightCells={cell ? [] : ["0,0", "0,1", "0,2", "0,3", "1,0", "2,0"]}
          />
        );
      }}
    </Player>
  );
}

/* TreeView — BST insert */

const BST: TreeNode = {
  value: 8,
  left: { value: 3, left: { value: 1 }, right: { value: 6 } },
  right: { value: 10, right: { value: 14, left: { value: 13 } } },
};

const BST_AFTER: TreeNode = {
  value: 8,
  left: { value: 3, left: { value: 1 }, right: { value: 6, right: { value: 7 } } },
  right: { value: 10, right: { value: 14, left: { value: 13 } } },
};

const BST_STEPS = frames<Frame & { at?: number; path: number[]; inserted?: boolean }>([
  { label: "insert 7", note: "Insert **7**, starting at the root.", line: 1, path: [] },
  { label: "at 8", note: "7 < 8: go left.", line: 3, at: 8, path: [] },
  { label: "at 3", note: "7 > 3: go right.", line: 5, at: 3, path: [8] },
  { label: "at 6", note: "7 > 6: go right, but there is no right child.", line: 5, at: 6, path: [8, 3] },
  { label: "attach", note: "Hang 7 in the empty slot. Nothing else moves.", line: 2, at: 7, path: [8, 3, 6], inserted: true },
  {
    label: "done",
    note: "The in-order walk is still sorted: 1 3 6 **7** 8 10 13 14.",
    path: [8, 3, 6, 7],
    inserted: true,
    variant: "success",
  },
]);

function BstInsert({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="BST insert"
      steps={BST_STEPS}
      autoPlay={autoPlay}
      code={{
        title: "insert",
        lines: [
          "def insert(node, x):",
          "    if node is None: return Node(x)",
          "    if x < node.val: node.left = insert(node.left, x)",
          "    else:",
          "        node.right = insert(node.right, x)",
          "    return node",
        ],
      }}
    >
      {(s) => (
        <TreeView
          root={s.inserted ? BST_AFTER : BST}
          activeNodes={s.at != null ? [s.at] : []}
          highlightNodes={s.path}
          pointers={s.at != null ? [{ value: s.at, label: "node" }] : []}
        />
      )}
    </Player>
  );
}

/* GraphView — breadth-first search */

const BFS_NODES = [
  { id: "A", x: 40, y: 110 },
  { id: "B", x: 140, y: 40 },
  { id: "C", x: 140, y: 180 },
  { id: "D", x: 250, y: 60 },
  { id: "E", x: 250, y: 190 },
  { id: "F", x: 350, y: 120 },
];

const BFS_EDGES = [
  { from: "A", to: "B" },
  { from: "A", to: "C" },
  { from: "B", to: "D" },
  { from: "C", to: "D" },
  { from: "C", to: "E" },
  { from: "D", to: "F" },
  { from: "E", to: "F" },
];

interface BfsState extends Frame {
  visit?: string;
  done: string[];
  queue: string[];
  dist: Record<string, number>;
  tree: string[];
}

const BFS_STEPS = frames<BfsState>([
  { label: "start", note: "Queue the source **A** at distance 0.", done: [], queue: ["A"], dist: { A: 0 }, tree: [] },
  {
    label: "visit A",
    note: "Pop A. Its neighbours B and C are new: distance 1. Queue: `B C`",
    visit: "A",
    done: [],
    queue: ["B", "C"],
    dist: { A: 0, B: 1, C: 1 },
    tree: ["A->B", "A->C"],
  },
  {
    label: "visit B",
    note: "Pop B. D is new: distance 2. Queue: `C D`",
    visit: "B",
    done: ["A"],
    queue: ["C", "D"],
    dist: { A: 0, B: 1, C: 1, D: 2 },
    tree: ["A->B", "A->C", "B->D"],
  },
  {
    label: "visit C",
    note: "Pop C. D is already queued, so only E is new. Queue: `D E`",
    visit: "C",
    done: ["A", "B"],
    queue: ["D", "E"],
    dist: { A: 0, B: 1, C: 1, D: 2, E: 2 },
    tree: ["A->B", "A->C", "B->D", "C->E"],
  },
  {
    label: "visit D",
    note: "Pop D. F is new: distance 3. Queue: `E F`",
    visit: "D",
    done: ["A", "B", "C"],
    queue: ["E", "F"],
    dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
    tree: ["A->B", "A->C", "B->D", "C->E", "D->F"],
  },
  {
    label: "visit E",
    note: "Pop E. F was reached first through D, so its distance stays 3.",
    visit: "E",
    done: ["A", "B", "C", "D"],
    queue: ["F"],
    dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
    tree: ["A->B", "A->C", "B->D", "C->E", "D->F"],
  },
  {
    label: "visit F",
    note: "Queue empty. The highlighted edges form a shortest-path tree from A.",
    visit: "F",
    done: ["A", "B", "C", "D", "E"],
    queue: [],
    dist: { A: 0, B: 1, C: 1, D: 2, E: 2, F: 3 },
    tree: ["A->B", "A->C", "B->D", "C->E", "D->F"],
    variant: "success",
  },
]);

function Bfs({ autoPlay }: StoryArgs) {
  return (
    <Player title="Breadth-first search" steps={BFS_STEPS} autoPlay={autoPlay}>
      {(s) => (
        <GraphView
          nodes={BFS_NODES}
          edges={BFS_EDGES}
          width={400}
          height={230}
          activeNodes={s.visit ? [s.visit] : []}
          highlightNodes={s.queue}
          dimNodes={s.done}
          highlightEdges={s.tree}
          badges={s.dist}
          pointers={s.visit ? [{ id: s.visit, label: "visit" }] : []}
        />
      )}
    </Player>
  );
}

/* LinkedListView — in-place reversal */

const REVERSE_CODE = [
  "prev, curr = None, head",
  "while curr:",
  "    nxt = curr.next",
  "    curr.next = prev",
  "    prev, curr = curr, nxt",
  "head = prev",
];

function reversedUpTo(k: number): LLNode[] {
  return [1, 2, 3, 4].map((value, i) => (i < k ? { value, next: i === 0 ? false : i - 1 } : { value }));
}

const REVERSE_STEPS = frames<Frame & { flipped: number; head: number }>([
  { label: "start", note: "`prev` is null and `curr` is the head.", line: 1, flipped: 0, head: 0 },
  { label: "flip 1", note: "Point node 1 back at `prev` (null), then advance both.", line: 4, flipped: 1, head: 0 },
  { label: "flip 2", note: "Node 2 now points back at node 1.", line: 4, flipped: 2, head: 0 },
  { label: "flip 3", note: "Node 3 points back at node 2.", line: 4, flipped: 3, head: 0 },
  { label: "flip 4", note: "Node 4 points back at node 3; `curr` falls off the end.", line: 5, flipped: 4, head: 0 },
  { label: "done", note: "`head = prev`: the list now reads 4 → 3 → 2 → 1.", line: 6, flipped: 4, head: 3, variant: "success" },
]);

function ReverseList({ autoPlay }: StoryArgs) {
  return (
    <Player title="Reverse a linked list" steps={REVERSE_STEPS} autoPlay={autoPlay} code={{ title: "reverse", lines: REVERSE_CODE }}>
      {(s) => {
        const prev = s.flipped - 1;
        const curr = s.flipped < 4 ? s.flipped : null;
        return (
          <LinkedListView
            nodes={reversedUpTo(s.flipped)}
            activeIndex={curr ?? undefined}
            dimIndices={range(0, prev)}
            pointers={[
              { index: s.head, label: "head" },
              ...(prev >= 0 && s.head !== prev ? [{ index: prev, label: "prev" }] : []),
              ...(curr != null && curr !== s.head ? [{ index: curr, label: "curr" }] : []),
            ]}
          />
        );
      }}
    </Player>
  );
}

/* StackView — bracket matching */

const BRACKETS = ["{", "[", "(", ")", "]", "}"];

const BRACKET_STEPS = frames<Frame & { i: number; stack: string[] }>([
  { label: "start", note: "Scan left to right, pushing openers.", line: 1, i: -1, stack: [] },
  { label: "push {", note: "`{` opens: push it.", line: 4, i: 0, stack: ["{"] },
  { label: "push [", note: "`[` opens: push it.", line: 4, i: 1, stack: ["{", "["] },
  { label: "push (", note: "`(` opens: push it.", line: 4, i: 2, stack: ["{", "[", "("] },
  { label: "pop (", note: "`)` closes. The top is `(`, a match: pop.", line: 6, i: 3, stack: ["{", "["] },
  { label: "pop [", note: "`]` matches the `[` on top: pop.", line: 6, i: 4, stack: ["{"] },
  { label: "pop {", note: "`}` matches the `{` on top: pop.", line: 6, i: 5, stack: [] },
  { label: "balanced", note: "Input consumed with an empty stack: **balanced**.", line: 7, i: 6, stack: [], variant: "success" },
]);

function BracketMatching({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Bracket matching"
      steps={BRACKET_STEPS}
      autoPlay={autoPlay}
      code={{
        title: "balanced",
        lines: [
          "stack = []",
          "for ch in s:",
          "    if ch in '([{':",
          "        stack.append(ch)",
          "    elif not stack or stack.pop() != pair[ch]:",
          "        return False",
          "return not stack",
        ],
      }}
    >
      {(s) => (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
          <ArrayView
            label="s"
            values={BRACKETS}
            activeIndex={s.i >= 0 && s.i < BRACKETS.length ? s.i : undefined}
            dimIndices={range(0, s.i - 1)}
            cellSize={36}
          />
          <StackView values={s.stack} title="stack" itemWidth={80} />
        </div>
      )}
    </Player>
  );
}

/* QueueView — a ring buffer draining */

interface RingState extends Frame {
  values: (string | null)[];
  front: number;
  back: number;
  size: number;
  touched?: number;
}

const RING_STEPS = frames<RingState>([
  {
    label: "5 queued",
    note: "Five jobs wait in a six-slot ring buffer.",
    values: ["j1", "j2", "j3", "j4", "j5", null],
    front: 0,
    back: 5,
    size: 5,
  },
  {
    label: "dequeue j1",
    note: "A worker takes **j1**; `front` advances.",
    values: [null, "j2", "j3", "j4", "j5", null],
    front: 1,
    back: 5,
    size: 4,
    touched: 0,
  },
  {
    label: "enqueue j6",
    note: "**j6** lands in the last slot and `back` wraps round to 0.",
    values: [null, "j2", "j3", "j4", "j5", "j6"],
    front: 1,
    back: 0,
    size: 5,
    touched: 5,
  },
  {
    label: "dequeue j2",
    note: "Take **j2**.",
    values: [null, null, "j3", "j4", "j5", "j6"],
    front: 2,
    back: 0,
    size: 4,
    touched: 1,
  },
  {
    label: "dequeue j3",
    note: "Take **j3**.",
    values: [null, null, null, "j4", "j5", "j6"],
    front: 3,
    back: 0,
    size: 3,
    touched: 2,
  },
  {
    label: "dequeue j4, j5",
    note: "Two more workers free up and take **j4** and **j5**.",
    values: [null, null, null, null, null, "j6"],
    front: 5,
    back: 0,
    size: 1,
    touched: 4,
  },
  {
    label: "drained",
    note: "Take **j6**. `front === back` with size 0: the ring is empty, not full.",
    values: [null, null, null, null, null, null],
    front: 0,
    back: 0,
    size: 0,
    touched: 5,
    variant: "success",
  },
]);

function RingDrain({ autoPlay }: StoryArgs) {
  return (
    <Player title="Ring buffer draining" steps={RING_STEPS} autoPlay={autoPlay}>
      {(s) => (
        <QueueView
          layout="ring"
          values={s.values}
          capacity={6}
          front={s.front}
          back={s.back}
          size={s.size}
          activeIndices={s.touched != null ? [s.touched] : []}
          title="jobs"
        />
      )}
    </Player>
  );
}

/* BarView — one bubble-sort pass */

const BUBBLE_STEPS = frames<Frame & { values: number[]; compare?: [number, number]; swap?: [number, number]; settled: number[] }>([
  { label: "start", note: "One pass carries the largest value to the end.", line: 1, values: [5, 1, 4, 2, 8], settled: [] },
  { label: "swap 0,1", note: "5 > 1: swap.", line: 4, values: [1, 5, 4, 2, 8], swap: [0, 1], settled: [] },
  { label: "swap 1,2", note: "5 > 4: swap.", line: 4, values: [1, 4, 5, 2, 8], swap: [1, 2], settled: [] },
  { label: "swap 2,3", note: "5 > 2: swap.", line: 4, values: [1, 4, 2, 5, 8], swap: [2, 3], settled: [] },
  { label: "compare 3,4", note: "5 < 8: leave them.", line: 3, values: [1, 4, 2, 5, 8], compare: [3, 4], settled: [] },
  { label: "pass done", note: "**8** is in its final place; the next pass can stop one short.", line: 1, values: [1, 4, 2, 5, 8], settled: [4], variant: "success" },
]);

function BubblePass({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Bubble sort pass"
      steps={BUBBLE_STEPS}
      autoPlay={autoPlay}
      code={{
        title: "bubble pass",
        lines: ["for j in range(n - 1 - i):", "    # compare neighbours", "    if a[j] > a[j + 1]:", "        a[j], a[j + 1] = a[j + 1], a[j]"],
      }}
    >
      {(s) => (
        <BarView
          values={s.values}
          comparePair={s.compare}
          swapPair={s.swap}
          highlightIndices={s.settled}
          maxValue={9}
          chartHeight={180}
        />
      )}
    </Player>
  );
}

/* PlotView — Newton's method for √2 */

const f = (x: number) => x * x - 2;
const NEWTON_X = [3];
while (NEWTON_X.length < 5) {
  const x = NEWTON_X[NEWTON_X.length - 1]!;
  NEWTON_X.push(x - f(x) / (2 * x));
}
const CURVE: PlotPoint[] = Array.from({ length: 71 }, (_, i) => {
  const x = i * 0.05;
  return { x, y: f(x) };
});

const NEWTON_STEPS = frames<Frame & { k: number }>([
  ...NEWTON_X.slice(0, 4).map((x, k) => ({
    label: `x${k} = ${x.toFixed(4)}`,
    note:
      k === 0
        ? "Start at x₀ = 3 and follow the tangent down to the axis."
        : `The tangent at x${k} crosses at x${k + 1} = ${NEWTON_X[k + 1]!.toFixed(5)}.`,
    line: 3,
    k,
  })),
  {
    label: "converged",
    note: `x₄ = ${NEWTON_X[4]!.toFixed(6)}. The error roughly squares each step.`,
    line: 4,
    k: 4,
    variant: "success" as const,
  },
]);

function Newton({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Newton's method"
      steps={NEWTON_STEPS}
      autoPlay={autoPlay}
      code={{ title: "newton", lines: ["x = 3.0", "for _ in range(4):", "    x = x - f(x) / df(x)", "return x"] }}
    >
      {(s) => {
        const x = NEWTON_X[s.k]!;
        const next = NEWTON_X[s.k + 1];
        return (
          <PlotView
            series={[
              { id: "f", label: "x² − 2", points: CURVE },
              ...(next != null
                ? [{ id: "tangent", label: "tangent", points: [{ x, y: f(x) }, { x: next, y: 0 }] }]
                : []),
            ]}
            activeIds={new Set(["tangent"])}
            marks={[
              { x, y: f(x), label: `x${s.k}` },
              ...(next != null ? [{ x: next, label: `x${s.k + 1}` }] : []),
            ]}
            guides={s.k === 4 ? [{ x: Math.SQRT2, label: "√2" }] : []}
            xMin={0}
            xMax={3.5}
            yMin={-2.5}
            yMax={8}
            xLabel="x"
            yLabel="f(x)"
            width={380}
            height={240}
          />
        );
      }}
    </Player>
  );
}

/* SequenceView — read-through cache */

const SEQ_STEPS = frames<Frame & { step: number }>([
  { label: "idle", note: "A read-through cache in front of a slow service.", step: 0 },
  { label: "request", note: "The client asks the gateway for an item.", step: 1 },
  { label: "lookup", note: "The gateway checks the cache first.", step: 2 },
  { label: "miss", note: "Not there.", step: 3, variant: "warning" },
  { label: "fetch", note: "Fall through to the service of record.", step: 4 },
  { label: "200", note: "The service answers.", step: 5 },
  { label: "fill", note: "Store the value without waiting for the write to land.", step: 6 },
  { label: "respond", note: "The client gets its answer; the next read is a hit.", step: 7, variant: "success" },
]);

function ReadThrough({ autoPlay }: StoryArgs) {
  return (
    <Player title="Read-through cache" steps={SEQ_STEPS} autoPlay={autoPlay}>
      {(s) => (
        <SequenceView
          participants={[
            { id: "c", label: "Client", shape: "person" },
            { id: "gw", label: "Gateway" },
            { id: "cache", label: "Cache", shape: "pill" },
            { id: "svc", label: "Service", shape: "cylinder" },
          ]}
          items={[
            { from: "c", to: "gw", label: "GET /items/7" },
            { from: "gw", to: "cache", label: "get items:7" },
            { from: "cache", to: "gw", label: "miss", kind: "reply" },
            { from: "gw", to: "svc", label: "load(7)" },
            { from: "svc", to: "gw", label: "200 item", kind: "reply" },
            { from: "gw", to: "cache", label: "set items:7", kind: "async" },
            { from: "gw", to: "c", label: "200 item", kind: "reply" },
          ]}
          frames={[{ kind: "opt", label: "[miss]", from: 3, to: 5 }]}
          step={s.step}
          numbered
        />
      )}
    </Player>
  );
}

/* TimelineView — retry with exponential backoff */

const RETRY: TimelineInterval[] = [
  { id: 0, start: 0, end: 1, label: "#1", lane: "attempts", state: "running" },
  { id: 1, start: 1, end: 2, label: "1s", lane: "backoff", state: "waiting" },
  { id: 2, start: 2, end: 3, label: "#2", lane: "attempts", state: "running" },
  { id: 3, start: 3, end: 5, label: "2s", lane: "backoff", state: "waiting" },
  { id: 4, start: 5, end: 6, label: "#3", lane: "attempts", state: "running" },
  { id: 5, start: 6, end: 10, label: "4s", lane: "backoff", state: "waiting" },
  { id: 6, start: 10, end: 11, label: "#4", lane: "attempts", state: "running" },
];

const RETRY_STEPS = frames<Frame & { shown: number }>([
  { label: "attempt 1", note: "The first call fails with a 503.", line: 3, shown: 1, variant: "warning" },
  { label: "wait 1s", note: "Back off for the current delay, 1s.", line: 4, shown: 2 },
  { label: "attempt 2", note: "Fails again.", line: 3, shown: 3, variant: "warning" },
  { label: "wait 2s", note: "The delay doubles to 2s.", line: 5, shown: 4 },
  { label: "attempt 3", note: "Still failing.", line: 3, shown: 5, variant: "warning" },
  { label: "wait 4s", note: "4s. Each wait gives the service more room to recover.", line: 5, shown: 6 },
  { label: "attempt 4", note: "Succeeds at t = 11s after three retries.", line: 3, shown: 7, variant: "success" },
]);

function RetryBackoff({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Retry with backoff"
      steps={RETRY_STEPS}
      autoPlay={autoPlay}
      code={{
        title: "retry",
        lines: [
          "delay = 1",
          "for attempt in range(1, 6):",
          "    if call(): return ok",
          "    sleep(delay)",
          "    delay *= 2",
        ],
      }}
    >
      {(s) => {
        const visible = RETRY.slice(0, s.shown);
        const last = visible[visible.length - 1]!;
        return (
          <TimelineView
            intervals={visible}
            lanes={["attempts", "backoff"]}
            activeIds={[last.id!]}
            marks={visible.filter((iv) => iv.lane === "attempts" && iv.id !== 6).map((iv) => ({ at: iv.end, label: "503" }))}
            sweep={last.end}
            sweepLabel={`t = ${last.end}s`}
            min={0}
            max={12}
            width={480}
          />
        );
      }}
    </Player>
  );
}

/* MemoryView — aliasing vs copying */

const ref = (id: number) => ["REF", id] as const;

const ALIAS_STEPS = frames<Frame & { vars: StackFrame["vars"]; heap: Record<string, HeapObject>; active: number[] }>([
  { label: "start", note: "Nothing bound yet.", line: 1, vars: {}, heap: {}, active: [] },
  {
    label: "a = [1, 2]",
    note: "`a` names a new list object.",
    line: 1,
    vars: { a: ref(1) },
    heap: { 1: ["LIST", 1, 2] },
    active: [1],
  },
  {
    label: "b = a",
    note: "`b` names the **same** object. No copy is made.",
    line: 2,
    vars: { a: ref(1), b: ref(1) },
    heap: { 1: ["LIST", 1, 2] },
    active: [1],
  },
  {
    label: "b.append(3)",
    note: "Mutating through `b` changes what `a` sees too.",
    line: 3,
    vars: { a: ref(1), b: ref(1) },
    heap: { 1: ["LIST", 1, 2, 3] },
    active: [1],
    variant: "warning",
  },
  {
    label: "c = list(a)",
    note: "`list(a)` builds a second, independent list.",
    line: 4,
    vars: { a: ref(1), b: ref(1), c: ref(2) },
    heap: { 1: ["LIST", 1, 2, 3], 2: ["LIST", 1, 2, 3] },
    active: [2],
  },
  {
    label: "c.append(4)",
    note: "Only the copy grows; `a` and `b` are untouched.",
    line: 5,
    vars: { a: ref(1), b: ref(1), c: ref(2) },
    heap: { 1: ["LIST", 1, 2, 3], 2: ["LIST", 1, 2, 3, 4] },
    active: [2],
    variant: "success",
  },
]);

function Aliasing({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Aliasing and copying"
      steps={ALIAS_STEPS}
      autoPlay={autoPlay}
      code={{ title: "aliasing", lines: ["a = [1, 2]", "b = a", "b.append(3)", "c = list(a)", "c.append(4)"] }}
    >
      {(s) => <MemoryView frames={[{ name: "global", vars: s.vars }]} heap={s.heap} activeIds={s.active} />}
    </Player>
  );
}

/* CallStackView — recursive factorial */

const fact = (n: number, line: number, returns?: number): CallFrame => ({
  label: `fact(${n})`,
  state: { n },
  line,
  returns,
});

const FACT_STEPS = frames<Frame & { frames: CallFrame[]; returned: CallFrame[] }>([
  { label: "fact(4)", note: "Call `fact(4)`; it needs `fact(3)` first.", line: 4, frames: [fact(4, 4)], returned: [] },
  { label: "fact(3)", note: "Each call waits on a smaller one.", line: 4, frames: [fact(4, 4), fact(3, 4)], returned: [] },
  { label: "fact(2)", note: "Three frames deep.", line: 4, frames: [fact(4, 4), fact(3, 4), fact(2, 4)], returned: [] },
  {
    label: "fact(1)",
    note: "Base case: `n <= 1` returns 1 without recursing.",
    line: 3,
    frames: [fact(4, 4), fact(3, 4), fact(2, 4), fact(1, 3, 1)],
    returned: [],
  },
  {
    label: "return 2",
    note: "`fact(2)` multiplies: 2 × 1 = 2.",
    line: 4,
    frames: [fact(4, 4), fact(3, 4), fact(2, 4, 2)],
    returned: [{ label: "fact(1)", returns: 1 }],
  },
  {
    label: "return 6",
    note: "`fact(3)`: 3 × 2 = 6.",
    line: 4,
    frames: [fact(4, 4), fact(3, 4, 6)],
    returned: [{ label: "fact(2)", returns: 2 }],
  },
  {
    label: "return 24",
    note: "`fact(4)`: 4 × 6 = 24.",
    line: 4,
    frames: [fact(4, 4, 24)],
    returned: [{ label: "fact(3)", returns: 6 }],
  },
  {
    label: "done",
    note: "The stack has unwound; the caller receives **24**.",
    frames: [],
    returned: [{ label: "fact(4)", returns: 24 }],
    variant: "success",
  },
]);

function Factorial({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Recursive factorial"
      steps={FACT_STEPS}
      autoPlay={autoPlay}
      code={{ title: "fact", lines: ["def fact(n):", "    if n <= 1:", "        return 1", "    return n * fact(n - 1)"] }}
    >
      {(s) => <CallStackView frames={s.frames} returned={s.returned} title="call stack" />}
    </Player>
  );
}

/* MapView — open addressing with linear probing */

const PROBE_KEYS = [10, 3, 17, 24, 5];
const CAPACITY = 7;

function probeInsert(count: number): { slots: MapSlot[]; path: number[] } {
  const slots: MapSlot[] = Array(CAPACITY).fill(null);
  let path: number[] = [];
  for (const key of PROBE_KEYS.slice(0, count)) {
    path = [];
    let i = key % CAPACITY;
    while (slots[i] !== null) {
      path.push(i);
      i = (i + 1) % CAPACITY;
    }
    path.push(i);
    slots[i] = { key };
  }
  return { slots, path };
}

const HASHES = Object.fromEntries(PROBE_KEYS.map((k) => [String(k), k % CAPACITY]));

const PROBE_STEPS = frames<Frame & { count: number }>([
  { label: "empty", note: "Seven slots, `h(k) = k mod 7`, linear probing.", count: 0 },
  ...PROBE_KEYS.map((key, i) => {
    const { path } = probeInsert(i + 1);
    return {
      label: `insert ${key}`,
      note:
        path.length === 1
          ? `h(${key}) = ${key % CAPACITY}, which is free.`
          : `h(${key}) = ${key % CAPACITY} is taken; probe ${path.length - 1} more slot${path.length > 2 ? "s" : ""} to land in ${path[path.length - 1]}.`,
      count: i + 1,
      variant: path.length > 3 ? ("warning" as const) : undefined,
    };
  }),
]);

function LinearProbing({ autoPlay }: StoryArgs) {
  return (
    <Player title="Linear probing" steps={PROBE_STEPS} autoPlay={autoPlay}>
      {(s) => {
        const { slots, path } = probeInsert(s.count);
        return (
          <MapView
            mode="open"
            slots={slots}
            hashOf={HASHES}
            activeKey={s.count ? PROBE_KEYS[s.count - 1] : undefined}
            probePath={s.count ? path : []}
            activeSlots={s.count ? [path[path.length - 1]!] : []}
          />
        );
      }}
    </Player>
  );
}

/* BitsView — clearing the lowest set bit */

const POP_STEPS = frames<Frame & { n: number; count: number; lowest?: number }>([
  { label: "n = 44", note: "Count the set bits of 44 = `101100₂`.", line: 1, n: 44, count: 0 },
  { label: "lowest = 2", note: "`n - 1` flips the lowest set bit and every zero below it.", line: 3, n: 44, count: 0, lowest: 2 },
  { label: "n = 40", note: "`n &= n - 1` clears bit 2. count = 1", line: 4, n: 40, count: 1 },
  { label: "lowest = 3", note: "Next lowest set bit is 3.", line: 3, n: 40, count: 1, lowest: 3 },
  { label: "n = 32", note: "Cleared. count = 2", line: 4, n: 32, count: 2 },
  { label: "lowest = 5", note: "Only bit 5 is left.", line: 3, n: 32, count: 2, lowest: 5 },
  { label: "n = 0", note: "n is zero after **3** iterations, one per set bit.", line: 5, n: 0, count: 3, variant: "success" },
]);

function Popcount({ autoPlay }: StoryArgs) {
  return (
    <Player
      title="Counting set bits"
      steps={POP_STEPS}
      autoPlay={autoPlay}
      code={{ title: "popcount", lines: ["count = 0", "while n:", "    n &= n - 1", "    count += 1", "return count"] }}
    >
      {(s) => (
        <BitsView
          value={s.n}
          bits={6}
          label="n"
          activeBits={s.lowest != null ? [s.lowest] : []}
          readBits={s.lowest != null ? range(0, s.lowest - 1) : []}
        />
      )}
    </Player>
  );
}

interface StoryArgs {
  /** Start the walkthrough playing as soon as it mounts. */
  autoPlay: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "Widgets/Playback",
  tags: ["autodocs"],
  args: { autoPlay: true },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/**
 * Pauses autoplay, rewinds with `r`, then steps once with → from the
 * keyboard. Keys are scoped to the widget root, so it is focused first.
 */
async function stepsFromKeyboard(canvasElement: HTMLElement, title: string, steps: Step<Frame>[]) {
  const root = within(canvasElement).getByRole("figure", { name: title });
  const scope = within(root);
  await userEvent.click(await scope.findByTitle("Pause (space)"));
  root.focus();
  await userEvent.keyboard("r");
  await waitFor(() => expect(scope.getByText(`1/${steps.length}`)).toBeInTheDocument());
  const note = root.querySelector<HTMLElement>('[aria-live="polite"]')!;
  // Labels can render as inline math, which drops the spaces.
  const squash = (t: string | null) => (t ?? "").replace(/\s+/g, "");
  await expect(squash(note.textContent)).toContain(squash(steps[0]!.label));
  const before = note.textContent;

  await userEvent.keyboard("{ArrowRight}");
  await waitFor(() => expect(scope.getByText(`2/${steps.length}`)).toBeInTheDocument());
  await expect(squash(note.textContent)).toContain(squash(steps[1]!.label));
  await expect(note.textContent).not.toBe(before);
  await expect(scope.getByTitle("Play (space)")).toBeInTheDocument();
}

export const ArrayViewPlayback: Story = {
  name: "ArrayView",
  render: (args) => <BinarySearch {...args} />,
  play: async ({ canvasElement }) => {
    await stepsFromKeyboard(canvasElement, "Binary search", SEARCH_STEPS);
    const active = canvasElement.querySelector("[data-cell][data-active]");
    await expect(active?.getAttribute("data-cell")).toBe(`0:${SEARCH_STEPS[1]!.state.mid}`);
  },
};

export const ArrayStackPlayback: Story = {
  name: "ArrayStack",
  render: (args) => <PrefixSums {...args} />,
};

export const MatrixViewPlayback: Story = {
  name: "MatrixView",
  render: (args) => <LatticePaths {...args} />,
};

export const TreeViewPlayback: Story = {
  name: "TreeView",
  render: (args) => <BstInsert {...args} />,
};

export const GraphViewPlayback: Story = {
  name: "GraphView",
  render: (args) => <Bfs {...args} />,
  play: async ({ canvasElement }) => {
    await stepsFromKeyboard(canvasElement, "Breadth-first search", BFS_STEPS);
  },
};

export const LinkedListViewPlayback: Story = {
  name: "LinkedListView",
  render: (args) => <ReverseList {...args} />,
};

export const StackViewPlayback: Story = {
  name: "StackView",
  render: (args) => <BracketMatching {...args} />,
};

export const QueueViewPlayback: Story = {
  name: "QueueView",
  render: (args) => <RingDrain {...args} />,
};

export const BarViewPlayback: Story = {
  name: "BarView",
  render: (args) => <BubblePass {...args} />,
};

export const PlotViewPlayback: Story = {
  name: "PlotView",
  render: (args) => <Newton {...args} />,
};

export const SequenceViewPlayback: Story = {
  name: "SequenceView",
  render: (args) => <ReadThrough {...args} />,
  play: async ({ canvasElement }) => {
    await stepsFromKeyboard(canvasElement, "Read-through cache", SEQ_STEPS);
  },
};

export const TimelineViewPlayback: Story = {
  name: "TimelineView",
  render: (args) => <RetryBackoff {...args} />,
};

export const MemoryViewPlayback: Story = {
  name: "MemoryView",
  render: (args) => <Aliasing {...args} />,
};

export const CallStackViewPlayback: Story = {
  name: "CallStackView",
  render: (args) => <Factorial {...args} />,
};

export const MapViewPlayback: Story = {
  name: "MapView",
  render: (args) => <LinearProbing {...args} />,
};

export const BitsViewPlayback: Story = {
  name: "BitsView",
  render: (args) => <Popcount {...args} />,
};
