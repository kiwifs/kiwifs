import { describe, expect, it } from "vitest";
import { expandRange, niceTicks, plotDomain, slicePoints, yAt } from "./plotLayout";

describe("expandRange", () => {
  it("leaves a real span alone", () => {
    expect(expandRange(-2, 4)).toEqual({ min: -2, max: 4 });
  });

  it("opens a zero range around the origin", () => {
    expect(expandRange(0, 0)).toEqual({ min: -1, max: 1 });
  });

  it("opens a zero range around a nonzero value", () => {
    expect(expandRange(5, 5)).toEqual({ min: 0, max: 10 });
  });
});

describe("niceTicks", () => {
  it("covers the requested interval", () => {
    const ticks = niceTicks(0, 1, 5);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it("uses a regular step", () => {
    const ticks = niceTicks(0, 10, 6);
    const step = ticks[1]! - ticks[0]!;
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step, 8);
    }
  });

  it("does not explode on a degenerate domain", () => {
    const ticks = niceTicks(3, 3);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeLessThan(3);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(3);
  });
});

describe("yAt", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 2, y: 4 },
    { x: 4, y: 0 },
  ];

  it("interpolates between vertices", () => {
    expect(yAt(line, 1)).toBeCloseTo(2);
    expect(yAt(line, 3)).toBeCloseTo(2);
  });

  it("clamps outside the polyline", () => {
    expect(yAt(line, -10)).toBe(0);
    expect(yAt(line, 99)).toBe(0);
  });

  it("returns null for an empty polyline", () => {
    expect(yAt([], 0)).toBeNull();
  });
});

describe("slicePoints", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 2, y: 4 },
    { x: 4, y: 0 },
  ];

  it("includes interpolated endpoints and interior vertices", () => {
    const slice = slicePoints(line, 1, 3);
    expect(slice[0]).toEqual({ x: 1, y: 2 });
    expect(slice.some((p) => p.x === 2 && p.y === 4)).toBe(true);
    expect(slice[slice.length - 1]).toEqual({ x: 3, y: 2 });
  });

  it("tolerates a reversed interval", () => {
    const a = slicePoints(line, 1, 3);
    const b = slicePoints(line, 3, 1);
    expect(a).toEqual(b);
  });
});

describe("plotDomain", () => {
  it("reads series, shades, guides, and marks", () => {
    const d = plotDomain(
      [{ points: [{ x: 0, y: 1 }, { x: 2, y: 3 }], baseline: 0 }],
      {
        shades: [{ from: -1, to: 4, fromY: -2, toY: 5 }],
        guides: [{ x: 6 }, { y: 8 }],
        marks: [{ x: 7, y: -3 }],
        pad: 0,
      },
    );
    expect(d.xMin).toBe(-1);
    expect(d.xMax).toBe(7);
    expect(d.yMin).toBe(-3);
    expect(d.yMax).toBe(8);
  });

  it("honours explicit bounds and still pads the free axis", () => {
    const d = plotDomain(
      [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
      { xMin: 0, xMax: 10, pad: 0.1 },
    );
    expect(d.xMin).toBe(0);
    expect(d.xMax).toBe(10);
    expect(d.yMin).toBeLessThan(0);
    expect(d.yMax).toBeGreaterThan(10);
  });

  it("falls back to the unit square when there is no data", () => {
    const d = plotDomain([], { pad: 0 });
    expect(d).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
  });
});
