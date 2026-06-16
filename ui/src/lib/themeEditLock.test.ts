import { describe, expect, it } from "vitest";
import { guardedThemeAction } from "./themeEditLock";

describe("guardedThemeAction", () => {
  it("no-ops when theme is locked", () => {
    let called = false;
    guardedThemeAction(true, () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("runs the action when theme is not locked", () => {
    let called = false;
    guardedThemeAction(false, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});
