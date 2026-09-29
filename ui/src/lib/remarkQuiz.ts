import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { parseQuizCallout } from "./quizBlock";

export function remarkKiwiQuiz() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = String(file.value ?? "");
    if (!source) return;
    visit(tree, "blockquote", (node: any) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start == null || end == null) return;
      const spec = parseQuizCallout(source.slice(start, end));
      if (!spec) return;
      node.data = {
        hName: "div",
        hProperties: {
          "data-kiwi-directive": "quiz",
          "data-quiz": encodeURIComponent(JSON.stringify(spec)),
          className: "kiwi-quiz-host",
        },
      };
      node.children = [];
    });
  };
}
