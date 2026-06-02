import { describe, expect, it } from "vitest";
import { buildFlatTree } from "./treeTransform";
import type { TreeEntry } from "./api";

describe("treeTransform ordering", () => {
  it("sorts ordered siblings before unordered siblings, then by name", () => {
    const root: TreeEntry = {
      path: "",
      name: "/",
      isDir: true,
      children: [
        { path: "zeta.md", name: "zeta.md", isDir: false },
        { path: "beta.md", name: "beta.md", isDir: false, order: 2 },
        { path: "alpha.md", name: "alpha.md", isDir: false, order: 1 },
        { path: "folder/", name: "folder", isDir: true, children: [] },
      ],
    };

    expect(buildFlatTree(root, { enableFileNesting: false }).map((n) => n.id)).toEqual([
      "alpha.md",
      "beta.md",
      "folder",
      "zeta.md",
    ]);
  });
});
