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
    { tag: t.strikethrough, textDecoration: "line-through" },
  ]);

  return [
    EditorView.theme(
      {
        "&": {
          backgroundColor: "var(--background)",
          color: "var(--foreground)",
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
          backgroundColor: "var(--muted)",
          color: "var(--muted-foreground)",
          borderRight: "1px solid var(--border)",
        },
        ".cm-activeLine": {
          backgroundColor: dark ? "rgba(148, 163, 184, 0.10)" : "rgba(15, 23, 42, 0.04)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: dark ? "rgba(148, 163, 184, 0.12)" : "rgba(15, 23, 42, 0.06)",
        },
        "&.cm-focused": {
          outline: "1px solid var(--ring)",
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

/**
 * Live preview: prose type, no gutters, and the classes the livePreview
 * extensions put on headings, links, lists, quotes and widgets.
 */
export function livePreviewTheme({ dark }: { dark: boolean }) {
  const link = dark ? "#93c5fd" : "#2563eb";
  const muted = "var(--muted-foreground)";
  const border = "var(--border)";
  return EditorView.theme(
    {
      // "&.cm-editor" outranks the source theme's rules these override, which
      // CodeMirror scopes to the same specificity as a plain "& ...".
      "&": { fontSize: "1rem" },
      "&.cm-editor .cm-scroller": {
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif)",
      },
      "&.cm-editor .cm-content": { lineHeight: "1.7", padding: "1rem 0.25rem", maxWidth: "48rem" },
      "&.cm-focused": { outline: "none" },
      "&.cm-editor .cm-activeLine": { backgroundColor: "transparent" },
      // Code keeps its monospace face inside prose.
      ".cm-lp-frontmatter, .cm-lp-codeblock, .cm-lp-code": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "0.9em",
      },
      ".cm-lp-codeblock": { backgroundColor: "var(--muted)", paddingLeft: "0.75em !important" },
      ".cm-lp-code": { backgroundColor: "var(--muted)", borderRadius: "0.25rem", padding: "0.1em 0.25em" },
      ".cm-lp-heading": { fontWeight: "700", lineHeight: "1.3" },
      ".cm-lp-h1": { fontSize: "1.875em", paddingTop: "0.6em" },
      ".cm-lp-h2": { fontSize: "1.5em", paddingTop: "0.5em" },
      ".cm-lp-h3": { fontSize: "1.25em", paddingTop: "0.4em" },
      ".cm-lp-h4": { fontSize: "1.1em" },
      ".cm-lp-h5, .cm-lp-h6": { fontSize: "1em" },
      ".cm-lp-link, .cm-lp-link *": { color: link, textDecoration: "underline", textUnderlineOffset: "2px" },
      ".cm-lp-wikilink, .cm-lp-wikilink *": { color: link, cursor: "pointer", textDecoration: "none" },
      ".cm-lp-wikilink:hover": { textDecoration: "underline" },
      ".cm-lp-wikilink-broken, .cm-lp-wikilink-broken *": { color: dark ? "#f87171" : "#dc2626" },
      ".cm-lp-bullet": { color: muted, display: "inline-block", minWidth: "0.9em" },
      ".cm-lp-task": { display: "inline-flex", alignItems: "center", marginRight: "0.35em", verticalAlign: "middle" },
      ".cm-lp-task input": { width: "1.05em", height: "1.05em", margin: "0", cursor: "pointer", accentColor: link },
      ".cm-lp-quote": {
        borderLeft: `3px solid ${border}`,
        paddingLeft: "0.9em !important",
        color: dark ? "#cbd5e1" : "#334155",
      },
      ".cm-lp-callout": {
        borderLeftColor: link,
        backgroundColor: dark ? "rgba(59, 130, 246, 0.08)" : "rgba(37, 99, 235, 0.05)",
      },
      ".cm-lp-callout-warning, .cm-lp-callout-caution": {
        borderLeftColor: "#d97706",
        backgroundColor: dark ? "rgba(217, 119, 6, 0.10)" : "rgba(217, 119, 6, 0.06)",
      },
      ".cm-lp-callout-danger, .cm-lp-callout-error": {
        borderLeftColor: "#dc2626",
        backgroundColor: dark ? "rgba(220, 38, 38, 0.10)" : "rgba(220, 38, 38, 0.05)",
      },
      ".cm-lp-callout-quiz": {
        borderLeftColor: dark ? "#a78bfa" : "#7c3aed",
        backgroundColor: dark ? "rgba(167, 139, 250, 0.12)" : "rgba(124, 58, 237, 0.08)",
      },
      ".cm-lp-hr": {
        display: "inline-block",
        width: "100%",
        verticalAlign: "middle",
        borderTop: `1px solid ${border}`,
      },
      ".cm-lp-callout-label": {
        fontSize: "0.7em",
        fontWeight: "700",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: muted,
      },
      ".cm-lp-image-source, .cm-lp-image-source *": { fontSize: "0.8em", color: muted, textDecoration: "none" },
      ".cm-lp-image": { padding: "0.25rem 0 0.75rem" },
      ".cm-lp-image img": { maxWidth: "100%", maxHeight: "28rem", borderRadius: "0.375rem" },
      ".cm-lp-image-broken": { display: "none" },
      ".cm-lp-fence": {
        margin: "0.5rem 0",
        border: `1px solid ${border}`,
        borderRadius: "0.5rem",
        overflow: "hidden",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      },
      ".cm-lp-fence-bar": {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.15rem 0.5rem",
        fontSize: "0.75rem",
        color: muted,
        backgroundColor: "var(--muted)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      ".cm-lp-fence-edit": {
        border: "none",
        background: "transparent",
        color: muted,
        cursor: "pointer",
        padding: "0.25rem 0.5rem",
        borderRadius: "0.25rem",
        font: "inherit",
      },
      ".cm-lp-fence-edit:hover, .cm-lp-fence-edit:focus-visible": { color: "var(--foreground)", outline: `1px solid ${border}` },
      ".cm-lp-fence-body": { padding: "0 0.5rem" },
      ".cm-lp-properties": {
        display: "inline-flex",
        gap: "0.5rem",
        alignItems: "center",
        maxWidth: "100%",
        margin: "0.25rem 0 0.5rem",
        padding: "0.25rem 0.6rem",
        border: `1px solid ${border}`,
        borderRadius: "999px",
        background: "var(--muted)",
        color: muted,
        fontSize: "0.75rem",
        cursor: "pointer",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      },
      ".cm-lp-properties-title": { fontWeight: "600", color: "var(--foreground)" },
      ".cm-lp-frontmatter": { fontSize: "0.85em", color: muted },
    },
    { dark },
  );
}
