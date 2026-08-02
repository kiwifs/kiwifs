import { describe, expect, it } from "vitest";
import { layoutGraph } from "./graphLayout";

const OPTIONS = { width: 300, height: 200, nodeSize: 30, layout: "force" as const };

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("layoutGraph", () => {
  it("keeps coordinates an author supplied", () => {
    const positions = layoutGraph(
      [{ id: "a", x: 11, y: 22 }, { id: "b" }],
      [{ from: "a", to: "b" }],
      OPTIONS,
    );
    expect(positions.get("a")).toEqual({ x: 11, y: 22 });
    expect(positions.get("b")).toBeDefined();
  });

  it("places every node exactly once", () => {
    for (const layout of ["force", "circular", "grid", "layered"] as const) {
      const positions = layoutGraph(ids(7), [{ from: 0, to: 1 }], { ...OPTIONS, layout });
      expect(positions.size, layout).toBe(7);
      for (const [, p] of positions) {
        expect(Number.isFinite(p.x), layout).toBe(true);
        expect(Number.isFinite(p.y), layout).toBe(true);
      }
    }
  });

  it("stays inside the canvas", () => {
    for (const layout of ["force", "circular", "grid", "layered"] as const) {
      const positions = layoutGraph(
        ids(9),
        [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 0, to: 3 }],
        { ...OPTIONS, layout },
      );
      for (const [id, p] of positions) {
        expect(p.x, `${layout} ${id} x`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${layout} ${id} x`).toBeLessThanOrEqual(OPTIONS.width);
        expect(p.y, `${layout} ${id} y`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${layout} ${id} y`).toBeLessThanOrEqual(OPTIONS.height);
      }
    }
  });

  it("is deterministic, so nodes hold still between animation steps", () => {
    const nodes = ids(8);
    const edges = [
      { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 },
      { from: 3, to: 4 }, { from: 4, to: 0 }, { from: 5, to: 6 }, { from: 6, to: 7 },
    ];
    const first = layoutGraph(nodes, edges, OPTIONS);
    const second = layoutGraph(nodes, edges, OPTIONS);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("gives separate nodes separate positions", () => {
    const positions = layoutGraph(ids(6), [], { ...OPTIONS, layout: "circular" });
    const seen = new Set([...positions.values()].map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(seen.size).toBe(6);
  });

  describe("layered", () => {
    const layered = { ...OPTIONS, layout: "layered" as const };

    it("puts a source above its descendants", () => {
      const positions = layoutGraph(
        [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }],
        layered,
      );
      const y = (id: string) => positions.get(id)!.y;
      expect(y("a")).toBeLessThan(y("b"));
      expect(y("b")).toEqual(y("c"));
      expect(y("b")).toBeLessThan(y("d"));
    });

    it("still positions a graph with no source, such as a pure cycle", () => {
      const positions = layoutGraph(
        [{ id: 0 }, { id: 1 }, { id: 2 }],
        [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0 }],
        layered,
      );
      expect(positions.size).toBe(3);
    });

    it("drops an unreachable component below the reachable one", () => {
      const positions = layoutGraph(
        [{ id: "a" }, { id: "b" }, { id: "x" }, { id: "y" }],
        [{ from: "a", to: "b" }, { from: "x", to: "y" }, { from: "y", to: "x" }],
        layered,
      );
      expect(positions.get("x")!.y).toBeGreaterThan(positions.get("a")!.y);
    });
  });

  it("centres a lone node", () => {
    const positions = layoutGraph([{ id: "only" }], [], OPTIONS);
    expect(positions.get("only")).toEqual({ x: 150, y: 100 });
  });

  it("ignores edges that name a node that isn't there", () => {
    const positions = layoutGraph(ids(3), [{ from: 0, to: 99 }], OPTIONS);
    expect(positions.size).toBe(3);
    for (const [, p] of positions) expect(Number.isNaN(p.x)).toBe(false);
  });
});
