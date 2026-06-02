import { describe, expect, it } from "vitest";
import { persistSiblingOrder } from "./treeOrderPersistence";
import type { FlatNode } from "./treeTransform";

const sibling = (id: string, order?: number): FlatNode => ({
  id,
  name: id.split("/").pop() ?? id,
  isDir: false,
  order,
});

describe("tree order persistence", () => {
  it("includes the failing markdown path when order frontmatter patch fails", async () => {
    const entries = [sibling("00 Inbox/a.md", 2), sibling("00 Inbox/broken.md", 1)];
    const api = {
      patchFrontmatter: async (path: string) => {
        if (path === "00 Inbox/broken.md") throw new Error("frontmatter-yaml-invalid");
        return { path, etag: "ok" };
      },
      patchTreeOrder: async () => ({ updated: 0 }),
    };

    await expect(persistSiblingOrder(entries, api)).rejects.toThrow(
      "00 Inbox/broken.md",
    );
  });
});
