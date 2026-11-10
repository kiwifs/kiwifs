import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "./staleBuild";

describe("isStaleChunkError", () => {
  it("recognises browser chunk-load failures", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: http://x/assets/a.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
  });

  it("leaves real diagram errors alone", () => {
    expect(isStaleChunkError(new Error("Parse error on line 3"))).toBe(false);
    expect(isStaleChunkError("Syntax error in text")).toBe(false);
  });
});
