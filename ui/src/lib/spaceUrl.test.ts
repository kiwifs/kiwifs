import { describe, expect, it } from "vitest";
import {
  buildSpaceLocation,
  parseLegacySpaceLocation,
  parseSpaceLocation,
  planHistoryWrite,
  preservedUrlSuffix,
  spaceForLocation,
} from "./spaceUrl";

describe("parseSpaceLocation", () => {
  it("reads a primary-space page", () => {
    expect(parseSpaceLocation("/page/01-core-concepts/scaling.md")).toEqual({
      space: null,
      path: "01-core-concepts/scaling.md",
    });
  });

  it("reads a space-scoped page", () => {
    expect(parseSpaceLocation("/s/system-design/page/01-core-concepts/scaling.md")).toEqual({
      space: "system-design",
      path: "01-core-concepts/scaling.md",
    });
  });

  it("does not mistake a top-level folder for a space", () => {
    expect(parseSpaceLocation("/page/system-design/scaling.md")).toEqual({
      space: null,
      path: "system-design/scaling.md",
    });
  });

  it("handles a space root with no page", () => {
    expect(parseSpaceLocation("/s/system-design/")).toEqual({ space: "system-design", path: null });
    expect(parseSpaceLocation("/s/system-design")).toEqual({ space: "system-design", path: null });
  });

  it("decodes escaped segments", () => {
    expect(parseSpaceLocation("/page/my%20notes/auth%20flow.md").path).toBe("my notes/auth flow.md");
  });

  it("survives a malformed escape instead of blanking the page", () => {
    expect(parseSpaceLocation("/page/100%.md").path).toBe("100%.md");
  });

  it("falls back to the legacy hash route", () => {
    expect(parseSpaceLocation("/", "#/notes/a.md")).toEqual({ space: null, path: "notes/a.md" });
  });

  it("returns the root for /", () => {
    expect(parseSpaceLocation("/")).toEqual({ space: null, path: null });
  });
});

describe("buildSpaceLocation", () => {
  it("omits the marker for the primary space", () => {
    expect(buildSpaceLocation(null, "a/b.md", "leetcode")).toBe("/page/a/b.md");
    expect(buildSpaceLocation("leetcode", "a/b.md", "leetcode")).toBe("/page/a/b.md");
  });

  it("adds the marker for other spaces", () => {
    expect(buildSpaceLocation("system-design", "a/b.md", "leetcode")).toBe(
      "/s/system-design/page/a/b.md",
    );
  });

  it("encodes segments", () => {
    expect(buildSpaceLocation(null, "my notes/auth flow.md", "leetcode")).toBe(
      "/page/my%20notes/auth%20flow.md",
    );
  });

  it("round-trips through parseSpaceLocation", () => {
    const url = buildSpaceLocation("system-design", "my notes/a.md", "leetcode");
    expect(parseSpaceLocation(url)).toEqual({ space: "system-design", path: "my notes/a.md" });
  });

  it("maps an empty path to the space root", () => {
    expect(buildSpaceLocation(null, null, "leetcode")).toBe("/");
    expect(buildSpaceLocation("system-design", null, "leetcode")).toBe("/s/system-design/");
  });

  it("never double-prefixes an already-scoped path", () => {
    const once = buildSpaceLocation("system-design", "a/b.md", "leetcode");
    const parsed = parseSpaceLocation(once);
    expect(buildSpaceLocation(parsed.space, parsed.path, "leetcode")).toBe(once);
  });
});

describe("preservedUrlSuffix", () => {
  it("keeps a playback step deep-link on entry", () => {
    expect(preservedUrlSuffix("", "#?step=4", true)).toBe("#?step=4");
  });

  it("keeps a heading anchor on entry", () => {
    expect(preservedUrlSuffix("", "#the-write-path", true)).toBe("#the-write-path");
  });

  it("keeps query params regardless", () => {
    expect(preservedUrlSuffix("?theme-origins=1", "#?step=4", false)).toBe("?theme-origins=1");
  });

  it("drops the fragment when navigating away from a page", () => {
    expect(preservedUrlSuffix("", "#?step=4", false)).toBe("");
  });

  it("drops the superseded hash route even on entry", () => {
    expect(preservedUrlSuffix("", "#/notes/a.md", true)).toBe("");
    expect(preservedUrlSuffix("", "#/", true)).toBe("");
  });
});

describe("spaceForLocation", () => {
  it("maps the primary space to null so it has one internal name", () => {
    expect(spaceForLocation("leetcode", "leetcode")).toBeNull();
    expect(spaceForLocation(null, "leetcode")).toBeNull();
  });

  it("keeps other spaces", () => {
    expect(spaceForLocation("system-design", "leetcode")).toBe("system-design");
  });

  it("keeps the space when the primary is not known yet", () => {
    expect(spaceForLocation("system-design", null)).toBe("system-design");
  });
});

describe("planHistoryWrite", () => {
  const loc = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

  it("does nothing when the URL already matches", () => {
    expect(
      planHistoryWrite({
        space: null,
        path: "a/b.md",
        primary: "leetcode",
        location: loc("/page/a/b.md"),
        normalising: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("pushes a new entry for an in-app navigation", () => {
    expect(
      planHistoryWrite({
        space: null,
        path: "a/c.md",
        primary: "leetcode",
        location: loc("/page/a/b.md"),
        normalising: false,
      }),
    ).toEqual({ kind: "push", url: "/page/a/c.md" });
  });

  it("replaces rather than stacks when following back/forward", () => {
    expect(
      planHistoryWrite({
        space: "system-design",
        path: "a/b.md",
        primary: "leetcode",
        location: loc("/page/system-design/a/b.md"),
        normalising: true,
      }),
    ).toEqual({ kind: "replace", url: "/s/system-design/page/a/b.md" });
  });

  it("pushes when switching space, so the previous page stays in history", () => {
    // Regression: this was replacing the entry the user navigated from
    // whenever the switch happened before /api/spaces returned.
    expect(
      planHistoryWrite({
        space: "system-design",
        path: null,
        primary: "leetcode",
        location: loc("/page/10-trees/same-tree.md"),
        normalising: false,
      }),
    ).toEqual({ kind: "push", url: "/s/system-design/" });
  });

  it("keeps a deep-linked fragment when normalising the entry URL", () => {
    expect(
      planHistoryWrite({
        space: "system-design",
        path: "a/b.md",
        primary: "leetcode",
        location: loc("/page/system-design/a/b.md", "", "#?step=4"),
        normalising: true,
      }),
    ).toEqual({ kind: "replace", url: "/s/system-design/page/a/b.md#?step=4" });
  });

  it("drops the previous page's fragment when navigating", () => {
    expect(
      planHistoryWrite({
        space: null,
        path: "a/c.md",
        primary: "leetcode",
        location: loc("/page/a/b.md", "", "#?step=4"),
        normalising: false,
      }),
    ).toEqual({ kind: "push", url: "/page/a/c.md" });
  });
});

describe("parseLegacySpaceLocation", () => {
  const names = ["leetcode", "system-design"];

  it("recognises the superseded /page/{space}/{path} form", () => {
    expect(parseLegacySpaceLocation("/page/system-design/a/b.md", names, "leetcode")).toEqual({
      space: "system-design",
      path: "a/b.md",
    });
  });

  it("ignores a path whose first segment is only a folder", () => {
    expect(parseLegacySpaceLocation("/page/01-math/a.md", names, "leetcode")).toBeNull();
  });

  it("ignores the primary space name so real folders win", () => {
    expect(parseLegacySpaceLocation("/page/leetcode/a.md", names, "leetcode")).toBeNull();
  });

  it("ignores single-segment paths", () => {
    expect(parseLegacySpaceLocation("/page/system-design", names, "leetcode")).toBeNull();
  });
});
