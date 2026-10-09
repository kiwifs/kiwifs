import { describe, expect, it } from "vitest";
import { flattenTree, forestFromParents, layoutTree, type LayoutInput } from "./treeLayout";

const OPTS = { hGap: 24, vGap: 56, nodeSize: 40, showNulls: true };
const COMPACT = { ...OPTS, showNulls: false };

function byValue(root: LayoutInput, opts = OPTS) {
  const layout = layoutTree(root, 0, opts);
  expect(layout).not.toBeNull();
  const map = new Map<string | number, { x: number; y: number; ghost?: boolean }>();
  for (const n of flattenTree(layout!)) {
    map.set(n.key, { x: n.x, y: n.y, ghost: n.ghost });
  }
  return { layout: layout!, map };
}

describe("layoutTree binary sides", () => {
  it("places a right-only stick to the right of each parent, not under it", () => {
    const { map } = byValue({
      value: 1,
      right: { value: 2, right: { value: 3 } },
    });
    expect(map.get(2)!.x).toBeGreaterThan(map.get(1)!.x);
    expect(map.get(3)!.x).toBeGreaterThan(map.get(2)!.x);
    expect(map.get(2)!.y).toBeGreaterThan(map.get(1)!.y);
  });

  it("places a left-only stick to the left of each parent", () => {
    const { map } = byValue({
      value: 1,
      left: { value: 2, left: { value: 3 } },
    });
    expect(map.get(2)!.x).toBeLessThan(map.get(1)!.x);
    expect(map.get(3)!.x).toBeLessThan(map.get(2)!.x);
  });

  it("keeps both children on opposite sides of the parent", () => {
    const { map } = byValue({
      value: 3,
      left: { value: 9 },
      right: { value: 20, left: { value: 15 }, right: { value: 7 } },
    });
    expect(map.get(9)!.x).toBeLessThan(map.get(3)!.x);
    expect(map.get(20)!.x).toBeGreaterThan(map.get(3)!.x);
    expect(map.get(15)!.x).toBeLessThan(map.get(20)!.x);
    expect(map.get(7)!.x).toBeGreaterThan(map.get(20)!.x);
  });

  it("draws a ghost on the empty side of a one-child node", () => {
    const { map } = byValue({ value: 1, right: { value: 2 } });
    const ghosts = [...map.values()].filter((n) => n.ghost);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.x).toBeLessThan(map.get(1)!.x);
    expect(map.get(2)!.x).toBeGreaterThan(map.get(1)!.x);
  });

  it("does not ghost a leaf (both children missing)", () => {
    const { map } = byValue({ value: 1 });
    expect([...map.values()].filter((n) => n.ghost)).toHaveLength(0);
    expect(map.size).toBe(1);
  });

  it("can hide ghosts when showNulls is false, still keeping the side", () => {
    const { map } = byValue({ value: 1, right: { value: 2 } }, COMPACT);
    expect([...map.values()].filter((n) => n.ghost)).toHaveLength(0);
    expect(map.get(2)!.x).toBeGreaterThan(map.get(1)!.x);
  });

  it("does not treat n-ary children as left/right slots", () => {
    const { map } = byValue({
      value: "root",
      children: [{ value: "a", children: [] }, { value: "b", children: [] }],
    });
    expect([...map.values()].filter((n) => n.ghost)).toHaveLength(0);
    expect(map.get("a")!.x).toBeLessThan(map.get("root")!.x);
    expect(map.get("b")!.x).toBeGreaterThan(map.get("root")!.x);
  });
});

describe("forestFromParents", () => {
  const shape = (n: LayoutInput): unknown => ({ v: n.value, c: (n.children ?? []).map(shape) });

  it("builds one tree per root, in key order", () => {
    const roots = forestFromParents([0, 0, 0, 2, 4, 4]);
    expect(roots.map(shape)).toEqual([
      { v: 0, c: [{ v: 1, c: [] }, { v: 2, c: [{ v: 3, c: [] }] }] },
      { v: 4, c: [{ v: 5, c: [] }] },
    ]);
  });

  it("treats null, -1 and unknown parents as roots", () => {
    const roots = forestFromParents([null, -1, 9]);
    expect(roots.map((r) => r.value)).toEqual([0, 1, 2]);
  });

  it("accepts an object of parent links", () => {
    const roots = forestFromParents({ a: "a", b: "a", c: "b" });
    expect(roots.map(shape)).toEqual([{ v: "a", c: [{ v: "b", c: [{ v: "c", c: [] }] }] }]);
  });

  it("breaks a rootless cycle instead of looping", () => {
    const roots = forestFromParents([1, 0]);
    expect(roots).toHaveLength(1);
    expect(flattenTree(layoutTree(roots[0], 0, OPTS)!)).toHaveLength(2);
  });
});
