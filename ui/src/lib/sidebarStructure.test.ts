import { describe, expect, it } from "vitest";
import type { TreeEntry } from "./api";
import {
  collectSectionPrefixes,
  filterPathsByQuery,
  filterTreeForExclude,
  filterTreeForInclude,
  mergeSidebarExcludePatterns,
  pathUnderPrefix,
} from "./sidebarStructure";

const sampleRoot: TreeEntry = {
  path: "",
  name: "/",
  isDir: true,
  children: [
    { path: "index.md", name: "index.md", isDir: false },
    { path: "getting-started.md", name: "getting-started.md", isDir: false },
    {
      path: "architecture/",
      name: "architecture",
      isDir: true,
      children: [
        { path: "architecture/overview.md", name: "overview.md", isDir: false },
      ],
    },
    {
      path: "api/",
      name: "api",
      isDir: true,
      children: [{ path: "api/rest.md", name: "rest.md", isDir: false }],
    },
    {
      path: "team/",
      name: "team",
      isDir: true,
      children: [{ path: "team/handbook.md", name: "handbook.md", isDir: false }],
    },
    {
      path: "templates/",
      name: "templates",
      isDir: true,
      children: [{ path: "templates/page.md", name: "page.md", isDir: false }],
    },
  ],
};

describe("sidebarStructure", () => {
  it("matches paths under configured prefixes", () => {
    expect(pathUnderPrefix("architecture/overview.md", "architecture/")).toBe(true);
    expect(pathUnderPrefix("api", "api/")).toBe(true);
    expect(pathUnderPrefix("team/handbook.md", "architecture/")).toBe(false);
  });

  it("includes only section prefixes in filtered tree", () => {
    const filtered = filterTreeForInclude(sampleRoot, ["architecture/", "api/"]);
    expect(filtered?.children?.map((c) => c.path)).toEqual(["architecture/", "api/"]);
  });

  it("excludes pinned files and section prefixes from main tree", () => {
    const filtered = filterTreeForExclude(
      sampleRoot,
      collectSectionPrefixes([{ label: "Core", paths: ["architecture/", "api/"] }]),
      ["index.md", "getting-started.md"],
    );
    expect(filtered?.children?.map((c) => c.path)).toEqual(["team/", "templates/"]);
  });

  it("filters pinned paths by sidebar search query", () => {
    expect(filterPathsByQuery(["index.md", "team/handbook.md"], "hand")).toEqual(["team/handbook.md"]);
  });

  it("merges hidden patterns with default tree exclusions", () => {
    expect(mergeSidebarExcludePatterns(["templates"])).toEqual(
      expect.arrayContaining(["**/.gitkeep", "templates"]),
    );
  });
});
