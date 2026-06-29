import { describe, expect, it } from "vitest";
import { persistSiblingOrder } from "./treeOrderPersistence";
import type { FlatNode } from "./treeTransform";

const sibling = (id: string): FlatNode => ({
  id,
  name: id.split("/").pop() ?? id,
  isDir: false,
});

describe("tree order persistence", () => {
  it("is a no-op since natural sort handles ordering", async () => {
    const entries = [sibling("00 Inbox/a.md"), sibling("00 Inbox/b.md")];
    const api = {
      patchFrontmatter: async () => ({ path: "", etag: "ok" }),
    };
    await expect(persistSiblingOrder(entries, api)).resolves.toBeUndefined();
  });
});
