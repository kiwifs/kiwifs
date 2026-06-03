import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { cn } from "@kw/lib/cn";
import { markdownEditorExtensions } from "./markdownLanguage";
import { markdownEditorTheme } from "./markdownEditorTheme";
import { slashCompletionSource } from "./markdownSlashCommands";
import {
  wikiLinkCompletionSource,
  type WikiPage,
} from "./wikiLinkCompletion";

export type MarkdownSourceEditorProps = {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  dark?: boolean;
  minHeight?: string;
  className?: string;
  onSaveShortcut?: () => void;
  pages?: WikiPage[];
};

export function MarkdownSourceEditor({
  value,
  onChange,
  readOnly = false,
  dark = false,
  minHeight = "60vh",
  className,
  onSaveShortcut,
  pages = [],
}: MarkdownSourceEditorProps) {
  const extensions = useMemo(() => {
    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveShortcut?.();
          return true;
        },
      },
    ]);

    const completionSources: CompletionSource[] = [slashCompletionSource];
    if (pages.length > 0) {
      completionSources.push(wikiLinkCompletionSource(pages));
    }

    const exts: Extension[] = [
      history(),
      ...markdownEditorExtensions(),
      highlightSelectionMatches(),
      autocompletion({
        override: completionSources,
        activateOnTyping: true,
        closeOnBlur: true,
      }),
      EditorView.contentAttributes.of({
        "aria-label": "Markdown source editor",
        "aria-multiline": "true",
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      saveKeymap,
    ];
    return exts;
  }, [onSaveShortcut, pages]);

  const theme = useMemo(() => markdownEditorTheme({ dark }), [dark]);

  return (
    <div className={cn("overflow-hidden rounded-md border bg-background shadow-sm", className)} data-testid="markdown-source-editor">
      <CodeMirror
        value={value}
        height="auto"
        minHeight={minHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          defaultKeymap: false,
          history: false,
          searchKeymap: false,
        }}
        editable={!readOnly}
        readOnly={readOnly}
        theme={theme}
        extensions={extensions}
        onChange={onChange}
      />
    </div>
  );
}
