import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Table } from "@lezer/markdown";

const quizLine = Decoration.line({ class: "cm-kiwi-quiz" });

function quizDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let active = false;
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const line = view.state.doc.line(n);
    if (/^\s{0,3}>\s*\[!quiz\b/i.test(line.text)) active = true;
    if (active && /^\s{0,3}>/.test(line.text)) {
      builder.add(line.from, line.from, quizLine);
    } else if (active) {
      active = false;
    }
  }
  return builder.finish();
}

const quizCalloutHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = quizDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = quizDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function markdownEditorExtensions() {
  return [
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [Table],
    }),
    quizCalloutHighlight,
  ];
}
