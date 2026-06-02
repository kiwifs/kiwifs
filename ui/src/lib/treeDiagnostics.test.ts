import { describe, expect, it } from "vitest";
import { buildFlatTree } from "./treeTransform";
import type { TreeEntry } from "./api";

describe("tree diagnostics", () => {
  it("carries frontmatter validation errors into flat nodes", () => {
    const root: TreeEntry = {
      path: "",
      name: "/",
      isDir: true,
      children: [
        {
          path: "00 Inbox/broken.md",
          name: "broken.md",
          isDir: false,
          frontmatterError: "frontmatter-yaml-invalid: duplicate key",
        },
      ],
    };

    const [node] = buildFlatTree(root, { enableFileNesting: false });

    expect(node.frontmatterError).toContain("duplicate key");
  });
});
