import { describe, expect, it } from "vitest";
import { assignLanes } from "./TimelineView";

describe("assignLanes", () => {
  it("keeps disjoint intervals on one lane", () => {
    expect(assignLanes([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
      { start: 12, end: 20 },
    ])).toEqual([0, 0, 0]);
  });

  it("stacks overlapping intervals", () => {
    expect(assignLanes([
      { start: 0, end: 30 },
      { start: 5, end: 10 },
      { start: 15, end: 20 },
    ])).toEqual([0, 1, 1]);
  });

  it("needs as many lanes as the peak overlap", () => {
    const lanes = assignLanes([
      { start: 0, end: 10 },
      { start: 1, end: 10 },
      { start: 2, end: 10 },
    ]);
    expect(new Set(lanes).size).toBe(3);
  });

  it("honours an explicit lane", () => {
    expect(assignLanes([
      { start: 0, end: 5, lane: 2 },
      { start: 0, end: 5 },
    ])).toEqual([2, 0]);
  });

  it("does not reuse a lane an explicit interval already occupies", () => {
    expect(assignLanes([
      { start: 0, end: 10, lane: 0 },
      { start: 5, end: 15 },
    ])).toEqual([0, 1]);
  });

  it("tolerates a reversed interval", () => {
    expect(assignLanes([
      { start: 10, end: 0 },
      { start: 12, end: 20 },
    ])).toEqual([0, 0]);
  });
});
