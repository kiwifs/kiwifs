import type { Element, Root, RootContent } from "hast";
import type { Blockquote } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype, { type Options as RemarkRehypeOptions } from "remark-rehype";
import { unified } from "unified";

/*
 * BlockNote 0.51 replaced its remark-based markdown parser with a small
 * hand-written one. That parser turns soft line breaks into hard breaks, drops
 * lazy continuation lines out of list items (which restarts ordered-list
 * numbering) and reads indented code as a paragraph, all verified in Chromium
 * and WebKit against 0.57. Its docs name the escape hatch used here: render
 * markdown to HTML ourselves and hand that to `tryParseHTMLToBlocks`.
 */

// mdast-util-to-hast wraps blockquote children in "\n" text nodes, which
// BlockNote's HTML parser keeps as hard breaks inside the quote.
type Handler = NonNullable<NonNullable<RemarkRehypeOptions["handlers"]>["blockquote"]>;

const blockquote: Handler = (state, node: Blockquote) => {
  const result = {
    type: "element" as const,
    tagName: "blockquote",
    properties: {},
    children: state.wrap(state.all(node), false),
  };
  state.patch(node, result);
  return state.applyData(node, result);
};

const BLOCK_TAGS = new Set([
  "blockquote", "details", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li",
  "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "ul",
]);

const isBlock = (node: RootContent | undefined) =>
  node?.type === "element" && BLOCK_TAGS.has(node.tagName);

// remark-rehype emits "\n" text between block elements, after <br>, and for
// soft line breaks. BlockNote keeps every "\n" as a hard break, so layout
// newlines are dropped and soft breaks become the space HTML renders them as.
function normalizeLayoutWhitespace() {
  const visit = (node: Root | Element) => {
    if (node.type === "element" && (node.tagName === "pre" || node.tagName === "code")) return;
    const children = node.children as RootContent[];
    const kept: RootContent[] = [];
    children.forEach((child, i) => {
      if (child.type === "element") visit(child);
      if (child.type !== "text") {
        kept.push(child);
        return;
      }
      const prev = kept[kept.length - 1];
      let value = child.value;
      if (prev?.type === "element" && prev.tagName === "br") value = value.replace(/^\n/, "");
      if (/^\s*$/.test(value) && value.includes("\n")) {
        const atEdge = prev === undefined || i === children.length - 1;
        if (atEdge || isBlock(prev) || isBlock(children[i + 1])) return;
      }
      value = value.replace(/\n/g, " ");
      if (value === "") return;
      child.value = value;
      kept.push(child);
    });
    (node as Element).children = kept as Element["children"];
  };
  return (tree: Root) => visit(tree);
}

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// hast-util-to-html leaves ">" unescaped in text. happy-dom's parser then
// duplicates the start of a code block that contains "-->", which would make
// the round-trip tests disagree with real browsers. Raw nodes with every
// entity escaped serialize identically in both.
function escapeTextNodes() {
  const visit = (node: Root | Element) => {
    node.children.forEach((child, i) => {
      if (child.type === "text") {
        (node.children as unknown[])[i] = { type: "raw", value: escapeText(child.value) };
      } else if (child.type === "element") {
        visit(child);
      }
    });
  };
  return (tree: Root) => visit(tree);
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { handlers: { blockquote } })
  .use(normalizeLayoutWhitespace)
  .use(escapeTextNodes)
  // Only escapeTextNodes produces raw nodes: remark-rehype drops markdown's
  // own inline HTML because allowDangerousHtml is off there.
  .use(rehypeStringify, { allowDangerousHtml: true });

export function markdownToBlockNoteHTML(markdown: string): string {
  return String(processor.processSync(markdown));
}

type BlockParser<B> = { tryParseHTMLToBlocks(html: string): B[] };

/** Parse markdown into BlockNote blocks through the remark pipeline above. */
export function parseMarkdownToBlocks<B>(editor: BlockParser<B>, markdown: string): B[] {
  return editor.tryParseHTMLToBlocks(markdownToBlockNoteHTML(markdown));
}
