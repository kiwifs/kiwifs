import { describe, expect, it } from "vitest";
import {
  sourceToVisualParts,
  visualToSource,
  wikiPagesFromTree,
} from "./editorMode";
import type { TreeEntry } from "./api";

describe("editorMode", () => {
  it("visualToSource joins frontmatter with block-exported body", async () => {
    const full = await visualToSource("title: Hello", async () => "# Body\n");
    expect(full).toBe("---\ntitle: Hello\n---\n\n# Body\n");
  });

  it("sourceToVisualParts splits frontmatter and strips duplicate title H1", () => {
    const md = "---\ntitle: My Page\n---\n\n# My Page\n\nContent here.\n";
    expect(sourceToVisualParts(md)).toEqual({
      fmText: "title: My Page",
      body: "\nContent here.\n",
    });
  });

  it("sourceToVisualParts keeps body when no matching title H1", () => {
    const md = "# Heading\n\nParagraph.\n";
    expect(sourceToVisualParts(md)).toEqual({
      fmText: "",
      body: md,
    });
  });

  it("wikiPagesFromTree maps markdown paths to wiki completion entries", () => {
    const tree: TreeEntry = {
      name: "root",
      path: "",
      isDir: true,
      children: [
        { name: "a.md", path: "notes/a.md", isDir: false },
        { name: "b.txt", path: "notes/b.txt", isDir: false },
      ],
    };
    expect(wikiPagesFromTree(tree)).toEqual([
      { path: "notes/a.md", title: "A" },
    ]);
  });
});
