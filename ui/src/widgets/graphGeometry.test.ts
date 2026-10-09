import { describe, expect, it } from "vitest";
import { boundaryPoint, measureNode, parallelBends, pointAlong, routeEdge, textWidth, wrapText } from "./graphGeometry";

describe("measureNode", () => {
  it("keeps short circle labels at the author's size and grows for long ones, capped", () => {
    expect(measureNode({ label: "7", shape: "circle", nodeSize: 36 }).w).toBe(36);
    const grown = measureNode({ label: "frontier", shape: "circle", nodeSize: 36 }).w;
    expect(grown).toBeGreaterThan(36);
    expect(measureNode({ label: "a-very-long-node-name-here", shape: "circle", nodeSize: 36 }).w).toBeLessThanOrEqual(36 * 2.2);
  });

  it("sizes boxes to fit their label and wraps long ones", () => {
    const box = measureNode({ label: "Admin dashboard", shape: "box", nodeSize: 36 });
    expect(box.w).toBeGreaterThanOrEqual(textWidth("Admin dashboard", 13) + 24);
    const long = measureNode({ label: "A service whose name is far too long for one line", shape: "box", nodeSize: 36 });
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.h).toBeGreaterThan(box.h);
  });

  it("adds a sublabel line", () => {
    const plain = measureNode({ label: "DB", shape: "cylinder", nodeSize: 36 });
    const sub = measureNode({ label: "DB", sublabel: "Postgres primary", shape: "cylinder", nodeSize: 36 });
    expect(sub.sublines).toEqual(["Postgres primary"]);
    expect(sub.h).toBeGreaterThan(plain.h);
  });
});

describe("wrapText", () => {
  it("honours explicit newlines", () => {
    expect(wrapText("one\ntwo", 13, 500)).toEqual(["one", "two"]);
  });
});

describe("boundaryPoint", () => {
  it("clips to the rectangle edge for boxes and the radius for circles", () => {
    expect(boundaryPoint({ x: 0, y: 0, w: 100, h: 40, shape: "box" }, { x: 500, y: 0 })).toEqual({ x: 50, y: 0 });
    expect(boundaryPoint({ x: 0, y: 0, w: 100, h: 40, shape: "box" }, { x: 0, y: -500 })).toEqual({ x: 0, y: -20 });
    const c = boundaryPoint({ x: 0, y: 0, w: 20, h: 20, shape: "circle" }, { x: 30, y: 40 });
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(10);
  });
});

describe("parallelBends", () => {
  it("leaves single edges straight and fans opposite edges to different sides", () => {
    const bends = parallelBends([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "b", to: "c" },
    ]);
    expect(bends[2]).toBe(0);
    expect(bends[0]).not.toBe(0);
    // Same sign in each edge's own frame = opposite sides on the page.
    expect(Math.sign(bends[0]!)).toBe(Math.sign(bends[1]!));
  });
});

describe("routeEdge + pointAlong", () => {
  const a = { x: 0, y: 0, w: 20, h: 20, shape: "box" as const };
  const b = { x: 100, y: 0, w: 20, h: 20, shape: "box" as const };

  it("draws a straight line between node rims", () => {
    const r = routeEdge(a, b);
    expect(r.start).toEqual({ x: 10, y: 0 });
    expect(r.end).toEqual({ x: 90, y: 0 });
    expect(pointAlong(r.samples, 0.5)).toMatchObject({ x: 50, y: 0 });
  });

  it("bows a bent edge off the straight line", () => {
    const r = routeEdge(a, b, { bend: 20 });
    expect(r.d).toContain(" Q ");
    expect(Math.abs(pointAlong(r.samples, 0.5).y)).toBeGreaterThan(10);
  });

  it("passes through layout waypoints", () => {
    const r = routeEdge(a, { ...b, y: 100 }, { via: [{ x: 0, y: 50 }, { x: 100, y: 50 }] });
    expect(r.samples.length).toBeGreaterThan(4);
    expect(r.d.match(/ Q /g)?.length).toBe(2);
  });
});
