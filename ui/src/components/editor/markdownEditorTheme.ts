import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export function markdownEditorTheme({ dark }: { dark: boolean }) {
  const highlight = HighlightStyle.define([
    { tag: t.heading, color: dark ? "#f8fafc" : "#0f172a", fontWeight: "700" },
    { tag: t.link, color: dark ? "#93c5fd" : "#2563eb" },
    { tag: t.monospace, color: dark ? "#fbbf24" : "#92400e" },
    { tag: t.processingInstruction, color: dark ? "#a78bfa" : "#7c3aed" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "700" },
  ]);

  return [
    EditorView.theme(
      {
        "&": {
          backgroundColor: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
          fontSize: "0.875rem",
        },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        },
        ".cm-content": {
          lineHeight: "1.65",
          padding: "1rem",
        },
        ".cm-gutters": {
          backgroundColor: "hsl(var(--muted))",
          color: "hsl(var(--muted-foreground))",
          borderRight: "1px solid hsl(var(--border))",
        },
        ".cm-activeLine": {
          backgroundColor: dark ? "rgba(148, 163, 184, 0.10)" : "rgba(15, 23, 42, 0.04)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: dark ? "rgba(148, 163, 184, 0.12)" : "rgba(15, 23, 42, 0.06)",
        },
        "&.cm-focused": {
          outline: "1px solid hsl(var(--ring))",
        },
        ".cm-kiwi-quiz": {
          backgroundColor: dark ? "rgba(167, 139, 250, 0.12)" : "rgba(124, 58, 237, 0.08)",
        },
      },
      { dark },
    ),
    syntaxHighlighting(highlight),
    EditorView.lineWrapping,
  ];
}
