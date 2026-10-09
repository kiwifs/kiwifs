import { describe, expect, it } from "vitest";
import { GROUP_COLOR_COUNT, groupColor, lookupKeyed } from "./colors";

describe("groupColor", () => {
  it("cycles through the palette, including negative indices", () => {
    expect(groupColor(GROUP_COLOR_COUNT)).toBe(groupColor(0));
    expect(groupColor(-1)).toBe(groupColor(GROUP_COLOR_COUNT - 1));
    expect(groupColor(0)).toMatch(/^var\(--kw-widget-group-0, #/);
  });
});

describe("lookupKeyed", () => {
  it("reads arrays by index and objects by key", () => {
    expect(lookupKeyed(["a", null, "c"], 2)).toBe("c");
    expect(lookupKeyed(["a", null], 1)).toBeUndefined();
    expect(lookupKeyed({ x: "1" }, "x")).toBe("1");
    expect(lookupKeyed(undefined, 0)).toBeUndefined();
  });
});
