import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { type EditorView } from "@codemirror/view";

export type WikiPage = {
  path: string;
  title: string;
};

function wikiLinkTrigger(
  context: CompletionContext,
): { from: number; to: number; query: string } | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = before.match(/\[\[([^\]]*)?$/);
  if (!match || match.index === undefined) return null;

  const from = line.from + match.index;
  return { from, to: context.pos, query: (match[1] ?? "").toLowerCase() };
}

function stripMdExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

export function wikiLinkCompletionSource(pages: WikiPage[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const trigger = wikiLinkTrigger(context);
    if (!trigger) return null;

    const options = pages
      .filter(
        (p) =>
          p.title.toLowerCase().includes(trigger.query) ||
          p.path.toLowerCase().includes(trigger.query),
      )
      .slice(0, 30)
      .map((p) => {
        const pageName = stripMdExtension(p.path);
        return {
          label: `[[${pageName}]]`,
          displayLabel: p.title,
          detail: p.path,
          type: "text" as const,
          // Use CodeMirror's live range: the trigger captured above goes stale
          // as `validFor` lets the user keep typing without re-running this.
          apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
            const insert = `[[${pageName}]]`;
            // closeBrackets turns a typed `[[` into `[[]]`; swallow that `]]`.
            if (view.state.sliceDoc(to, to + 2) === "]]") to += 2;
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length },
              userEvent: "input.complete",
            });
          },
        };
      });

    return {
      from: trigger.from,
      to: trigger.to,
      options,
      validFor: /^\[\[[^\]]*$/,
    };
  };
}
