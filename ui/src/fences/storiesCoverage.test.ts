// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { allFences } from "./index";
import * as stories from "./Fences.stories";

const only = Object.values(stories)
  .map((story) => (story as { args?: { only?: string } })?.args?.only)
  .filter((lang): lang is string => Boolean(lang));

describe("Fences stories", () => {
  it("have a story for every registered fence", () => {
    const covered = new Set(only);
    const missing = allFences()
      .map((spec) => spec.lang)
      .filter((lang) => !covered.has(lang));
    expect(missing, `add a story to src/fences/Fences.stories.tsx for: ${missing.join(", ")}`).toEqual([]);
  });

  it("only name registered fences", () => {
    const registered = new Set(allFences().map((spec) => spec.lang));
    const unknown = only.filter((lang) => !registered.has(lang));
    expect(unknown, `no registered fence for: ${unknown.join(", ")}`).toEqual([]);
  });
});
