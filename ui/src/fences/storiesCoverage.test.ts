// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { allFences } from "./index";
import * as stories from "./Fences.stories";

describe("Fences stories", () => {
  it("have a story for every registered fence", () => {
    const covered = new Set(
      Object.values(stories)
        .map((story) => (story as { args?: { only?: string } })?.args?.only)
        .filter(Boolean),
    );
    const missing = allFences()
      .map((spec) => spec.lang)
      .filter((lang) => !covered.has(lang));
    expect(missing, `add a story to src/fences/Fences.stories.tsx for: ${missing.join(", ")}`).toEqual([]);
  });
});
