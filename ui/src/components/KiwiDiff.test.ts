import { describe, expect, it } from "vitest";
import { parseDiffSource } from "./KiwiDiff";

describe("parseDiffSource", () => {
  it("reads a title header above the === form", () => {
    const parsed = parseDiffSource("title: Raise the lease\nlanguage: yaml\n---\nlease: 10\n===\nlease: 30");
    expect(parsed.config.title).toBe("Raise the lease");
    expect(parsed.config.language).toBe("yaml");
    expect(parsed.oldValue).toBe("lease: 10");
    expect(parsed.newValue).toBe("lease: 30");
  });

  it("keeps a before block that holds its own --- intact", () => {
    const parsed = parseDiffSource("a: 1\n---\nb: 2\n===\nb: 3");
    expect(parsed.config.title).toBeUndefined();
    expect(parsed.oldValue).toBe("a: 1\n---\nb: 2");
  });
});
