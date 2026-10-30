---
title: Prefix sums, in one and two dimensions
tags: [algorithms, lesson, arrays]
level: introductory
estimated_time: 20 min
---

# Prefix sums, in one and two dimensions

A prefix sum turns "add up this range" from a loop into a subtraction. Spend $O(n)$ once to build the table, and every range query after that costs $O(1)$.

For an array $a_0, a_1, \dots, a_{n-1}$, define $P_0 = 0$ and $P_{i+1} = P_i + a_i$. Then the sum of a half-open range is

$$
\sum_{k=\ell}^{h-1} a_k = P_h - P_\ell
$$

## One dimension

Step the array and the listing together; the 2-D table further down shares the same clock, so it moves too.

```array id=prefix clock=prefix caption="Building P one cell at a time, then answering a query"
rows:
  - {label: a, values: [3, 1, 4, 1, 5], offset: 1}
  - {label: P, values: [0, null, null, null, null, null]}
steps:
  - note: "P[1] = P[0] + a[0] = 0 + 3"
    label: "P[1]"
    line: 3
    rows:
      - {label: a, values: [3, 1, 4, 1, 5], offset: 1, highlightIndices: [0]}
      - {label: P, values: [0, 3, null, null, null, null], activeIndex: 1, readIndices: [0]}
  - note: "P[2] = P[1] + a[1] = 3 + 1"
    label: "P[2]"
    line: 3
    rows:
      - {label: a, values: [3, 1, 4, 1, 5], offset: 1, highlightIndices: [1]}
      - {label: P, values: [0, 3, 4, null, null, null], activeIndex: 2, readIndices: [1]}
  - note: "The rest follow the same rule: P = [0, 3, 4, 8, 9, 14]"
    label: "fill"
    line: 3
    rows:
      - {label: a, values: [3, 1, 4, 1, 5], offset: 1}
      - {label: P, values: [0, 3, 4, 8, 9, 14], activeIndices: [3, 4, 5]}
  - note: "range_sum(1, 4) = P[4] - P[1] = 9 - 3 = 6, the sum of 1 + 4 + 1"
    label: "query"
    line: 6
    breakpoint: true
    rows:
      - {label: a, values: [3, 1, 4, 1, 5], offset: 1, highlightIndices: [1, 2, 3]}
      - {label: P, values: [0, 3, 4, 8, 9, 14], activeIndices: [1, 4]}
code: |-
  P = [0] * (len(a) + 1)
  for i, x in enumerate(a):
      P[i + 1] = P[i] + x

  def range_sum(lo, hi):
      return P[hi] - P[lo]
lang: python
```

## Two dimensions

The same idea, one dimension up: a summed-area table $S$ where $S_{i,j}$ is the sum of everything above and to the left. Each cell reads three neighbours:

$$
S_{i,j} = A_{i-1,j-1} + S_{i-1,j} + S_{i,j-1} - S_{i-1,j-1}
$$

The subtraction removes the top-left block, which both neighbours counted.

```matrix id=summed-area clock=prefix caption="Summed-area table for A = [[1, 2, 0], [3, 1, 2], [0, 4, 1]]"
values:
  - [0, 0, 0, 0]
  - [0, null, null, null]
  - [0, null, null, null]
  - [0, null, null, null]
steps:
  - note: "Row 1 is a plain 1-D prefix sum of A's first row"
    line: 4
    values:
      - [0, 0, 0, 0]
      - [0, 1, 3, 3]
      - [0, null, null, null]
      - [0, null, null, null]
    activeCells: [[1, 1], [1, 2], [1, 3]]
  - note: "S[2][2] = 1 + 3 + 4 - 1 = 7: above plus left, minus the overlap"
    line: 4
    values:
      - [0, 0, 0, 0]
      - [0, 1, 3, 3]
      - [0, 4, 7, null]
      - [0, null, null, null]
    activeCells: [[2, 2]]
    readCells: [[1, 2], [2, 1], [1, 1]]
  - note: "The bottom-right cell is the total of A: 14"
    line: 4
    values:
      - [0, 0, 0, 0]
      - [0, 1, 3, 3]
      - [0, 4, 7, 9]
      - [0, 4, 11, 14]
    activeCells: [[3, 3]]
    readCells: [[2, 3], [3, 2], [2, 2]]
  - note: "Sum of A's bottom-right 2×2 block = 14 - 3 - 4 + 1 = 8"
    line: 7
    activeCells: [[3, 3]]
    readCells: []
    highlightCells: [[1, 3], [3, 1], [1, 1]]
code: |-
  S = [[0] * (m + 1) for _ in range(n + 1)]
  for i in range(1, n + 1):
      for j in range(1, m + 1):
          S[i][j] = A[i-1][j-1] + S[i-1][j] + S[i][j-1] - S[i-1][j-1]

  def block_sum(r0, c0, r1, c1):
      return S[r1][c1] - S[r0][c1] - S[r1][c0] + S[r0][c0]
lang: python
```

## A sliding window, by hand

Prefix sums answer any range. When the ranges only ever slide right by one, you do not need the table: keep a running sum, add the element that enters and subtract the one that leaves.

```widget:live
const a = [2, 7, 1, 8, 2, 8, 1];
const k = 3;
const code = [
  "window = sum(a[:k])",
  "best = window",
  "for i in range(k, len(a)):",
  "    window += a[i] - a[i - k]",
  "    best = max(best, window)",
];
const steps = [];
let win = a[0] + a[1] + a[2];
let best = win;
steps.push({ lo: 0, hi: 2, win, best, line: 0, label: "First window: 2 + 7 + 1 = " + win });
for (let i = k; i < a.length; i++) {
  win += a[i] - a[i - k];
  best = Math.max(best, win);
  steps.push({ lo: i - k + 1, hi: i, enter: i, leave: i - k, win, best, line: 3, label: "Add " + a[i] + ", drop " + a[i - k] + ": window = " + win + ", best = " + best });
}

function Window() {
  const pb = usePlayback(steps, { interval: 1100 });
  const s = pb.current;
  const span = [];
  for (let j = s.lo; j <= s.hi; j++) span.push(j);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ArrayStack
        rows={[
          { label: "a", values: a, highlightIndices: span, activeIndex: s.enter, readIndices: s.leave == null ? [] : [s.leave] },
          { label: "sum", values: a.map((_, j) => (j === s.hi ? s.win : null)), activeIndex: s.hi },
        ]}
        arrows={s.leave == null ? [] : [{ from: [0, s.leave], to: [0, s.enter], label: "slide" }]}
      />
      <CodeHighlight code={code} activeLine={s.line} lang="python" />
      <AnnotationBar label={"Step " + (pb.currentStep + 1)} text={s.label} variant={pb.currentStep === steps.length - 1 ? "success" : "info"} />
      <PlaybackControls pb={pb} />
    </div>
  );
}

render(<Window />);
```

## Try it

Edit the array and run it. The answer to every query is two lookups.

```widget:code lang=python
a = [3, 1, 4, 1, 5, 9, 2, 6]
P = [0]
for x in a:
    P.append(P[-1] + x)

def range_sum(lo, hi):
    return P[hi] - P[lo]

print("P =", P)
print("sum of a[2:6] =", range_sum(2, 6))
```

## Check yourself

> [!quiz single ^prefix-range] With `P = [0, 3, 4, 8, 9, 14]`, what is `a[2] + a[3] + a[4]`?
> - [ ] 9
>   That is `P[4]`, the sum of the first four elements.
> - [x] 10
> - [ ] 11
>   Check the indices: the range is half-open, so you want `P[5] - P[2]`.
>
> The range `[2, 5)` sums to `P[5] - P[2] = 14 - 4 = 10`.

> [!TIP]
> If a problem asks for many range sums over data that does not change, build the prefix table first. If the data changes between queries, reach for a Fenwick tree instead.
