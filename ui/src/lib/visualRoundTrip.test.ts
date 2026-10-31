// @vitest-environment happy-dom
import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { markdownFixtures } from "@kw/test/markdownFixtures";
import { joinFrontmatter } from "./frontmatter";
import { sourceToVisualParts } from "./editorMode";
import { parseMarkdownToBlocks } from "./blockNoteMarkdown";

// What Visual mode writes for a page opened and saved with no edits, before
// any merge layer. These snapshots exist to make BlockNote upgrades reviewable:
// a serializer change shows up as a diff here, one file per fixture.
describe("visual mode lossy round trip", () => {
  const editor = BlockNoteEditor.create();

  it("covers every fixture", () => {
    expect(markdownFixtures.length).toBeGreaterThanOrEqual(15);
  });

  it.each(markdownFixtures.map((f) => [f.name, f.content]))("%s", async (name, content) => {
    const { fmText, body } = sourceToVisualParts(content);
    const blocks = parseMarkdownToBlocks(editor, body);
    const out = joinFrontmatter(fmText, editor.blocksToMarkdownLossy(blocks));
    await expect(out).toMatchFileSnapshot(`./__snapshots__/visualRoundTrip/${name}.md`);
  });
});
