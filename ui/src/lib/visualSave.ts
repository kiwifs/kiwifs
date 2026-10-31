import { parseMarkdownToBlocks } from "./blockNoteMarkdown";
import { mergeVisualSave } from "./markdownMerge";

type VisualEditor<B> = {
  document: B[];
  blocksToMarkdownLossy(blocks: B[]): string | Promise<string>;
  tryParseHTMLToBlocks(html: string): B[];
};

/**
 * Types and text of a block tree in document order, flattened, ignoring ids,
 * props, styles, nesting, and the empty paragraphs BlockNote keeps around the
 * cursor but never serializes. Nesting is left out on purpose: BlockNote's
 * own round trip lifts a code block out of the list item it sits in, so
 * comparing nesting would reject every merge near one. Lost, duplicated or
 * reordered text, which is what a bad merge produces, still shows.
 */
export function blockSignature(blocks: unknown[]): string {
  const text = (node: unknown, out: string[]) => {
    if (Array.isArray(node)) node.forEach((n) => text(n, out));
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if ((key === "text" || key === "href") && typeof value === "string") out.push(value);
        else if (key === "content" || key === "rows" || key === "cells") text(value, out);
      }
    }
  };
  const flat: [string | undefined, string][] = [];
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      const block = raw as { type?: string; content?: unknown; children?: unknown[] };
      const parts: string[] = [];
      text(block.content, parts);
      const inline = parts.join("").replace(/\s+/g, " ").trim();
      if (inline || (block.type ?? "paragraph") !== "paragraph") flat.push([block.type, inline]);
      walk(block.children ?? []);
    }
  };
  walk(blocks);
  return JSON.stringify(flat);
}

let warned = false;

/**
 * The body Visual mode should write: the user's edits merged onto the bytes
 * that were loaded. When the merged text would not reopen as the document on
 * screen (an edit inside syntax the serializer cannot represent, say), the
 * plain serializer output is written instead, as Orca does, so an edit is
 * never lost to a bad merge.
 */
export async function visualSaveBody<B>(
  editor: VisualEditor<B>,
  { original, baseline }: { original: string; baseline: string },
): Promise<{ body: string; current: string }> {
  const current = await editor.blocksToMarkdownLossy(editor.document);
  const merged = mergeVisualSave({ original, baseline, current });
  if (merged === original || merged === current) return { body: merged, current };
  const reopened = await parseMarkdownToBlocks(editor, merged);
  if (blockSignature(reopened) === blockSignature(editor.document)) return { body: merged, current };
  if (!warned) {
    warned = true;
    console.warn("kiwifs: visual save could not preserve the original formatting; saving normalised markdown");
  }
  return { body: current, current };
}
