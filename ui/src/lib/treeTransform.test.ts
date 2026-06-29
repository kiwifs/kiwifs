import { describe, expect, it } from "vitest";
import { buildFlatTree } from "./treeTransform";
import type { TreeEntry } from "./api";

describe("treeTransform ordering", () => {
  it("sorts siblings by natural sort order", () => {
    const root: TreeEntry = {
      path: "",
      name: "/",
      isDir: true,
      children: [
        { path: "zeta.md", name: "zeta.md", isDir: false },
        { path: "10-graphs/", name: "10-graphs", isDir: true, children: [] },
        { path: "2-arrays/", name: "2-arrays", isDir: true, children: [] },
        { path: "alpha.md", name: "alpha.md", isDir: false },
        { path: "1-math/", name: "1-math", isDir: true, children: [] },
      ],
    };

    expect(buildFlatTree(root, { enableFileNesting: false }).map((n) => n.id)).toEqual([
      "1-math",
      "2-arrays",
      "10-graphs",
      "alpha.md",
      "zeta.md",
    ]);
  });
});
