import { describe, expect, it } from "vitest";
import { shouldApplyTreeLoad, shouldRefreshTreeImmediately } from "./treeRefresh";

describe("shouldRefreshTreeImmediately", () => {
  it("debounces local write/delete echoes shortly after a local tree mutation", () => {
    expect(shouldRefreshTreeImmediately({ now: 1_500, lastLocalMutationAt: 1_000, suppressWindowMs: 1_000 })).toBe(false);
  });

  it("allows normal external refreshes outside the local mutation window", () => {
    expect(shouldRefreshTreeImmediately({ now: 3_000, lastLocalMutationAt: 1_000, suppressWindowMs: 1_000 })).toBe(true);
  });

  it("allows refreshes when there has been no local mutation", () => {
    expect(shouldRefreshTreeImmediately({ now: 1_000, lastLocalMutationAt: 0, suppressWindowMs: 1_000 })).toBe(true);
  });
});

describe("shouldApplyTreeLoad", () => {
  it("rejects an in-flight tree response that started before an optimistic local mutation", () => {
    expect(shouldApplyTreeLoad({ requestStartedAt: 1_000, lastLocalMutationAt: 1_500 })).toBe(false);
  });

  it("accepts a tree response that started after the latest local mutation", () => {
    expect(shouldApplyTreeLoad({ requestStartedAt: 2_000, lastLocalMutationAt: 1_500 })).toBe(true);
  });
});
