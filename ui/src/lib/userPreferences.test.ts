import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPreferencesToLocal,
  mergePreferences,
  readLocalPreferences,
} from "./userPreferences";

describe("userPreferences", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it("reads local sidebar and editor mode from localStorage", () => {
    localStorage.setItem("kiwifs-sidebar", "collapsed");
    localStorage.setItem("kiwifs-editor-mode", "source");
    localStorage.setItem("kiwifs-preset", "Ocean");

    expect(readLocalPreferences()).toEqual({
      theme: "Ocean",
      sidebar_collapsed: true,
      default_view: "source",
    });
  });

  it("merges server preferences over local values", () => {
    const local = { theme: "Kiwi", sidebar_collapsed: false };
    const server = { theme: "Forest", default_view: "source" as const };
    expect(mergePreferences(local, server)).toEqual({
      theme: "Forest",
      sidebar_collapsed: false,
      default_view: "source",
    });
  });

  it("writes merged preferences back to localStorage", () => {
    applyPreferencesToLocal({
      theme: "Sunset",
      sidebar_collapsed: true,
      default_view: "editor",
    });
    expect(localStorage.getItem("kiwifs-preset")).toBe("Sunset");
    expect(localStorage.getItem("kiwifs-sidebar")).toBe("collapsed");
    expect(localStorage.getItem("kiwifs-editor-mode")).toBe("visual");
  });
});
