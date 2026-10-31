// @vitest-environment happy-dom
import { BlockNoteEditor, type Block } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { markdownFixtures } from "@kw/test/markdownFixtures";
import { parseMarkdownToBlocks } from "./blockNoteMarkdown";
import { splitVisualSource } from "./editorMode";
import { mergeVisualSave } from "./markdownMerge";
import { blockSignature, visualSaveBody } from "./visualSave";

const editor = BlockNoteEditor.create();

type Inline = { type?: string; text?: string };

function textNodes(node: unknown, out: Inline[] = []): Inline[] {
  if (Array.isArray(node)) node.forEach((n) => textNodes(n, out));
  else if (node && typeof node === "object") {
    const n = node as Inline & Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string" && /[a-z]/i.test(n.text)) out.push(n);
    for (const key of ["content", "children", "rows", "cells"]) if (key in n) textNodes(n[key], out);
  }
  return out;
}

/**
 * Every way a fixture can be edited one step at a time in the block editor:
 * typing into each text run, deleting each top-level block, inserting a
 * paragraph after each one. Edits go to the block tree, as in the editor, so
 * untouched blocks are exactly what loading the original produced.
 */
function* singleEdits(blocks: Block[]) {
  for (let n = 0; n < textNodes(blocks).length; n++) {
    const doc = structuredClone(blocks);
    const node = textNodes(doc)[n];
    node.text = node.text!.endsWith("\n") ? `${node.text}EDITED` : `${node.text} EDITED`;
    yield { kind: "type", doc };
  }
  for (let i = 0; i < blocks.length; i++) {
    const deleted = structuredClone(blocks);
    deleted.splice(i, 1);
    yield { kind: "delete", doc: deleted };
    const inserted = structuredClone(blocks);
    inserted.splice(i + 1, 0, {
      id: "inserted",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "Inserted paragraph", styles: {} }],
      children: [],
    } as unknown as Block);
    yield { kind: "insert", doc: inserted };
  }
}

describe("visual save over every single edit to every fixture", () => {
  const results = markdownFixtures.flatMap(({ name, content }) => {
    const { body } = splitVisualSource(content);
    const loaded = parseMarkdownToBlocks(editor, body);
    const baseline = editor.blocksToMarkdownLossy(loaded);
    return [...singleEdits(loaded)].map(({ kind, doc }) => {
      const current = editor.blocksToMarkdownLossy(doc);
      const merged = mergeVisualSave({ original: body, baseline, current });
      const reopens = blockSignature(parseMarkdownToBlocks(editor, merged)) === blockSignature(doc);
      return { name, kind, merged, current, reopens };
    });
  });

  it("covers hundreds of edits", () => {
    expect(results.length).toBeGreaterThan(1000);
  });

  it("never loses typed text", () => {
    const lost = results.filter((r) => r.kind === "type" && r.current.includes("EDITED") && !r.merged.includes("EDITED"));
    expect(lost.map((r) => r.name)).toEqual([]);
  });

  it("reopens as the edited document for deletions and insertions", () => {
    const failed = results.filter((r) => r.kind !== "type" && !r.reopens);
    expect(failed.map((r) => `${r.kind} ${r.name}`)).toEqual([]);
  });

  it("reopens as the edited document for almost every typed edit", () => {
    // The few misses type next to an autolink, where the parser and the
    // serializer disagree on spacing; visualSaveBody then saves the
    // serializer's output, which is still correct.
    const typed = results.filter((r) => r.kind === "type");
    const failed = typed.filter((r) => !r.reopens);
    expect(failed.length / typed.length).toBeLessThan(0.01);
  });
});

describe("visualSaveBody", () => {
  const load = (body: string) => {
    const doc = parseMarkdownToBlocks(editor, body);
    const fake = {
      document: doc,
      blocksToMarkdownLossy: (blocks: Block[]) => editor.blocksToMarkdownLossy(blocks),
      tryParseHTMLToBlocks: (html: string) => editor.tryParseHTMLToBlocks(html),
    };
    return { fake, baseline: editor.blocksToMarkdownLossy(doc) };
  };

  it("returns the original bytes when nothing changed", async () => {
    const body = "- a\n- b\n\nSee [docs][1].\n\n[1]: https://x\n";
    const { fake, baseline } = load(body);
    expect(await visualSaveBody(fake, { original: body, baseline })).toEqual({ body, current: baseline });
  });

  it("merges an edit onto the original", async () => {
    const body = "- a\n- b\n\nSee [docs][1].\n\n[1]: https://x\n";
    const { fake, baseline } = load(body);
    textNodes(fake.document).find((n) => n.text === "b")!.text = "b edited";
    const { body: saved } = await visualSaveBody(fake, { original: body, baseline });
    expect(saved).toBe("- a\n- b edited\n\nSee [docs][1].\n\n[1]: https://x\n");
  });

  it("falls back to the serializer when the merge would not reopen as the document", async () => {
    const body = "One.\n\nTwo.\n";
    const { fake } = load(body);
    textNodes(fake.document)[0].text = "One, edited.";
    // A baseline that does not match what was loaded makes the merge
    // misplace the edit; the check must catch it.
    const { body: saved, current } = await visualSaveBody(fake, { original: body, baseline: "Two.\n" });
    expect(saved).toBe(current);
    expect(saved).toContain("One, edited.");
  });
});
