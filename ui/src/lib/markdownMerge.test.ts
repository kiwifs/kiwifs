// @vitest-environment happy-dom
import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { markdownFixtures } from "@kw/test/markdownFixtures";
import { parseMarkdownToBlocks } from "./blockNoteMarkdown";
import { sourceToVisualParts } from "./editorMode";
import { matchLines, mergeLines, mergeVisualSave } from "./markdownMerge";

const editor = BlockNoteEditor.create();
const canonical = (body: string) => editor.blocksToMarkdownLossy(parseMarkdownToBlocks(editor, body));

/** What Visual mode saves when the user's edit turns `baseline` into `current`. */
function save(original: string, edit: (baseline: string) => string) {
  const baseline = canonical(original);
  const current = edit(baseline);
  expect(current, "the edit must change the canonical text").not.toBe(baseline);
  return mergeVisualSave({ original, baseline, current });
}

function replaceOnce(text: string, from: string, to: string) {
  expect(text).toContain(from);
  return text.replace(from, to);
}

describe("matchLines", () => {
  it("matches a monotonic subsequence", () => {
    const m = matchLines([1, 2, 3, 4, 5], [1, 9, 3, 4, 8, 5]);
    expect([...m]).toEqual([0, -1, 2, 3, 5]);
  });

  it("anchors on unique lines around repeated blank lines", () => {
    const a = [0, 1, 0, 2, 0, 3, 0];
    const b = [0, 1, 0, 0, 7, 0, 3, 0];
    const m = [...matchLines(a, b)];
    expect(m[1]).toBe(1);
    expect(m[5]).toBe(6);
    const matched = m.filter((j) => j >= 0);
    expect(matched).toEqual([...matched].sort((x, y) => x - y));
  });
});

describe("mergeLines", () => {
  it("applies the user's change and keeps the original elsewhere", () => {
    expect(mergeLines("- a\n- b\n- c", "* a\n* b\n* c", "* a\n* B\n* c")).toBe("- a\n- B\n- c");
  });

  it("keeps text the serializer dropped when the user inserts next to it", () => {
    const ours = "See [docs][1].\n\n[1]: https://x";
    const base = "See [docs](https://x).";
    const theirs = "See [docs](https://x).\n\nNew paragraph.";
    expect(mergeLines(ours, base, theirs)).toBe("See [docs][1].\n\n[1]: https://x\n\nNew paragraph.");
  });

  it("takes the user's side when both sides changed the same lines", () => {
    expect(mergeLines("x\n- one\ny", "x\n* one\ny", "x\n* uno\ny")).toBe("x\n- uno\ny");
  });

  it("handles deletion at the start and insertion at the end", () => {
    expect(mergeLines("a\nb\nc", "a\nb\nc", "b\nc\nd")).toBe("b\nc\nd");
  });

  describe("on random pages", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const anyLines = ["para one", "para two", "", "# Head", "- item a", "- item b", "1. first", "```ts", "code", "```", "> quote", "| a | b |", "[1]: http://x"];
    const anyText = () =>
      Array.from({ length: rand(10) }, () => anyLines[rand(anyLines.length)]).join("\n") + (rand(2) ? "\n" : "");
    // What BlockNote writes: blocks separated by one blank line.
    const serializedBlocks = ["para one", "para two", "# Head", "* item a", "* item b", "1. first", "```ts\ncode\n```", "> quote", "| a | b |\n| - | - |"];
    const serializedText = () =>
      Array.from({ length: rand(8) }, () => serializedBlocks[rand(serializedBlocks.length)]).join("\n\n") + "\n";

    it("writes the user's text exactly when the file was already in the serializer's form", () => {
      for (let n = 0; n < 2000; n++) {
        const base = serializedText();
        const theirs = serializedText();
        expect(mergeLines(base, base, theirs), JSON.stringify({ base, theirs })).toBe(theirs);
      }
    });

    it("writes the file back unchanged when the user changed nothing", () => {
      for (let n = 0; n < 2000; n++) {
        const base = anyText();
        const ours = anyText();
        expect(mergeLines(ours, base, base), JSON.stringify({ ours, base })).toBe(ours);
      }
    });
  });
});

describe("mergeVisualSave", () => {
  it.each(markdownFixtures.map((f) => [f.name, f.content]))(
    "%s: a save with no edits returns the original bytes",
    (_name, content) => {
      const { body } = sourceToVisualParts(content);
      const baseline = canonical(body);
      expect(mergeVisualSave({ original: body, baseline, current: baseline })).toBe(body);
    },
  );

  it.each(markdownFixtures.map((f) => [f.name, f.content]))(
    "%s: appending a paragraph changes nothing else",
    (_name, content) => {
      const { body } = sourceToVisualParts(content);
      const saved = save(body, (b) => `${b.replace(/\n*$/, "")}\n\nAppended paragraph.\n`);
      const endings = /\r\n/.test(body) ? "\r\n" : "\n";
      expect(saved.startsWith(body.replace(/(\r?\n)*$/, ""))).toBe(true);
      expect(saved).toContain(`${endings}Appended paragraph.`);
    },
  );

  it("an edited paragraph is the only difference from the original", () => {
    const body = markdownFixtures.find((f) => f.name === "knowledge-playbook")!.content;
    const saved = save(body, (b) =>
      replaceOnce(b, "When given new information to add:", "When given NEW information to add:"));
    expect(saved).toBe(replaceOnce(body, "When given new information to add:", "When given NEW information to add:"));
  });

  it("untouched items of a dash list keep their markers", () => {
    const body = "Intro.\n\n- one\n- two\n- three\n\nOutro.\n";
    const saved = save(body, (b) => replaceOnce(b, "two", "two edited"));
    expect(saved).toBe("Intro.\n\n- one\n- two edited\n- three\n\nOutro.\n");
  });

  it("deleting a block removes only that block", () => {
    const body = "# Title\n\n- one\n- two\n\nKeep me.\n\nDelete me.\n\n[ref]: https://example.com\n";
    const saved = save(body, (b) => replaceOnce(b, "\n\nDelete me.", ""));
    expect(saved).toBe("# Title\n\n- one\n- two\n\nKeep me.\n\n[ref]: https://example.com\n");
  });

  it("inserting a block at the start keeps the rest byte-identical", () => {
    const body = "- one\n- two\n\nTail with  \nhard break.\n";
    const saved = save(body, (b) => `New first paragraph.\n\n${b}`);
    expect(saved).toBe(`New first paragraph.\n\n${body}`);
  });

  it("restores CRLF line endings and a BOM", () => {
    const body = "﻿First line.\r\n\r\n- a\r\n- b\r\n";
    const saved = save(body, (b) => replaceOnce(b, "First line.", "First line, edited."));
    expect(saved).toBe("﻿First line, edited.\r\n\r\n- a\r\n- b\r\n");
  });

  it("merges a 150 KB page in under 50 ms", () => {
    const original = largePage(150_000);
    const baseline = canonical(original);
    const current = replaceOnce(baseline, "Paragraph 7 of section 42", "Edited paragraph of section 42");

    // Best of three after a warm-up, so the test measures the algorithm and
    // not a busy CI machine running other test files in parallel.
    mergeVisualSave({ original, baseline, current });
    let best = Infinity;
    let saved = "";
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      saved = mergeVisualSave({ original, baseline, current });
      best = Math.min(best, performance.now() - started);
    }
    expect(best).toBeLessThan(50);
    // Only the edited paragraph is normalised: its soft wrap joined, `_` -> `*`.
    expect(saved).toBe(replaceOnce(
      original,
      "Paragraph 7 of section 42 explains _one_ idea and links [[page-42-7]].\nIt wraps onto a second line.",
      "Edited paragraph of section 42 explains *one* idea and links [[page-42-7]]. It wraps onto a second line.",
    ));
  });
});

/** A long page with the shapes real pages have: dash lists, fences, tables, wrapped prose. */
function largePage(minLength: number): string {
  const parts: string[] = [];
  for (let s = 0; parts.join("").length < minLength; s++) {
    parts.push(
      `## Section ${s}\n\n`,
      ...[1, 2, 3, 4, 5, 6, 7].map(
        (p) => `Paragraph ${p} of section ${s} explains _one_ idea and links [[page-${s}-${p}]].\nIt wraps onto a second line.\n\n`,
      ),
      `- item ${s}a\n- item ${s}b\n  - nested ${s}\n\n`,
      "```ts\n", `const value${s} = ${s};\n`, "\n", "return value;\n", "```\n\n",
      `| key | value |\n|---|---|\n| k${s} | v${s} |\n\n`,
    );
  }
  return parts.join("");
}
