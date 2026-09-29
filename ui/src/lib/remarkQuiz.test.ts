import { describe, expect, it } from "vitest";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { VFile } from "vfile";
import { quizSpecFromAttr } from "./quizBlock";
import { remarkKiwiQuiz } from "./remarkQuiz";

function transform(markdown: string): any {
  const processor = unified().use(remarkParse).use(remarkKiwiQuiz);
  const file = new VFile(markdown);
  const tree = processor.parse(file);
  return processor.runSync(tree, file);
}

function quizzes(tree: any): any[] {
  const out: any[] = [];
  const walk = (node: any) => {
    if (node?.data?.hProperties?.["data-kiwi-directive"] === "quiz") out.push(node);
    for (const child of node?.children || []) walk(child);
  };
  walk(tree);
  return out;
}

describe("remarkKiwiQuiz", () => {
  it("replaces a quiz callout and leaves the answer out of the rendered children", () => {
    const tree = transform(`# Notes

> [!quiz] What comes first?
> - [ ] Drawing
> - [x] Requirements

> A normal quote.
`);
    const found = quizzes(tree);
    expect(found).toHaveLength(1);
    expect(found[0].children).toEqual([]);
    const spec = quizSpecFromAttr(found[0].data.hProperties["data-quiz"]);
    expect(spec?.kind).toBe("single");
    expect(spec?.options.find((o) => o.correct)?.text).toBe("Requirements");
    const quotes = JSON.stringify(tree);
    expect(quotes).toContain("A normal quote.");
  });
});
