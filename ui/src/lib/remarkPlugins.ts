// Custom remark/rehype plugins for extended Obsidian-compatible markdown syntax.
//
// These follow the same pattern as `remarkWikiLinks`: walk text nodes with
// `unist-util-visit`, regex-match the target syntax, and splice replacement
// AST nodes into the parent.

import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import type { Root as HastRoot } from "hast";
import { KNOWN_INLINE_TAGS, parseInlineTags } from "./inlineTags";

// ── ==highlight== → <mark> ──────────────────────────────────────────────────
// Converts `==text==` syntax to emphasis-mark nodes that render as <mark>.
// The regex avoids matching inside code spans (those are never text nodes
// inside a `code` parent—the parser already isolates them).

export function remarkMark() {
  const re = /==((?:(?!==).)+)==/g;

  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes("==")) return;
      // Don't process text inside code/inlineCode nodes
      if ((parent as any).type === "code" || (parent as any).type === "inlineCode") return;

      const parts: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;

      while ((m = re.exec(node.value)) !== null) {
        if (m.index > last) {
          parts.push({ type: "text", value: node.value.slice(last, m.index) });
        }
        parts.push({
          type: "html",
          value: `<mark>${escapeHtml(m[1])}</mark>`,
        });
        last = m.index + m[0].length;
      }

      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      (parent as any).children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}

// ── %%comments%% → stripped ─────────────────────────────────────────────────
// Obsidian hides content between `%%` markers. We strip them before the
// markdown enters the AST so nothing downstream ever sees them.
//
// Applied as a pre-processor on the raw string, not as a remark plugin,
// because `%%` can span multiple lines / blocks.

export function stripObsidianComments(md: string): string {
  return md.replace(/%%[\s\S]*?%%/g, "");
}

// ── #tag → clickable badge ──────────────────────────────────────────────────
// Recognises `#tag-name` in text nodes and emits an inline HTML badge.
// Rules to avoid collisions with headings:
//   - Must be preceded by whitespace or be at the very start of a text node
//   - Must NOT be the start-of-line `# Heading` pattern (already parsed as heading)
//   - Must NOT appear inside code nodes
//   - Tag names: letters, digits, hyphens, underscores, forward slashes
//     (Obsidian allows nested tags like #project/alpha)

export function remarkInlineTags() {
  // Match #tag that is preceded by start-of-string or whitespace
  const re = /(?:^|(?<=\s))#([A-Za-z][A-Za-z0-9_/-]*)/g;

  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes("#")) return;
      // Skip code/inlineCode parents
      if ((parent as any).type === "code" || (parent as any).type === "inlineCode") return;
      // Skip heading nodes — `# Heading` is already parsed by the time we see text nodes,
      // but heading *content* nodes are children of heading elements.
      // Tags inside headings are valid in Obsidian, so we allow them.

      const parts: any[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;

      while ((m = re.exec(node.value)) !== null) {
        const tagStart = m.index;
        if (tagStart > last) {
          parts.push({ type: "text", value: node.value.slice(last, tagStart) });
        }
        const tag = m[1];
        parts.push({
          type: "html",
          value: `<span class="kiwi-inline-tag" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</span>`,
        });
        last = m.index + m[0].length;
      }

      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      (parent as any).children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}

// ── remarkPageControls ─────────────────────────────────────────────────────
// Turns `{% range name="n" min=1 max=20 /%}` and `{% value n /%}` into spans
// the page renderer swaps for live controls. Parsed from text nodes, so a tag
// inside a code fence or inline code is left alone — an example of the syntax
// must not become a control.

export function remarkPageControls() {
  return (tree: Root) => {
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const parentType = (parent as any).type;
      if (parentType === "code" || parentType === "inlineCode") return;
      const tags = parseInlineTags(node.value).filter((t) => KNOWN_INLINE_TAGS.has(t.name));
      if (tags.length === 0) return;

      const parts: any[] = [];
      let last = 0;
      for (const tag of tags) {
        if (tag.start > last) {
          parts.push({ type: "text", value: node.value.slice(last, tag.start) });
        }
        const attrs = { ...tag.attrs };
        if (tag.positional !== undefined && attrs.name === undefined) attrs.name = tag.positional;
        parts.push({
          type: "html",
          value: `<span data-kiwi-directive="control" data-control="${escapeAttr(tag.name)}" data-control-attrs="${escapeAttr(JSON.stringify(attrs))}"></span>`,
        });
        last = tag.end;
      }
      if (last < node.value.length) {
        parts.push({ type: "text", value: node.value.slice(last) });
      }
      (parent as any).children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}

// ── rehypeCodeMeta ──────────────────────────────────────────────────────────
// Preserves the code fence meta string (`title="..." {1,3}`) by copying
// `node.data.meta` to `node.properties.metastring` *before* rehype-raw
// runs and strips internal data fields.

export function rehypeCodeMeta() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: any) => {
      if (node.tagName === "code" && node.data?.meta) {
        node.properties = node.properties || {};
        node.properties.metastring = node.data.meta;
      }
    });
  };
}

// ── Task-list checkbox labels ───────────────────────────────────────────────
// GFM renders `- [ ] text` as a bare `<input type=checkbox>` beside the text,
// which screen readers announce as an unlabelled checkbox. Label each box
// with the text that follows it in its own item (nested lists excluded).

export function rehypeTaskListLabels() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: any) => {
      if (node.tagName !== "li" && node.tagName !== "p") return;
      const kids: any[] = node.children ?? [];
      const box = kids.find(
        (k) => k.type === "element" && k.tagName === "input" && k.properties?.type === "checkbox",
      );
      if (!box || box.properties.ariaLabel) return;
      const label = kids
        .filter((k) => k !== box)
        .map(hastText)
        .join("")
        .trim();
      if (label) box.properties.ariaLabel = label;
    });
  };
}

function hastText(node: any): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName === "ul" || node.tagName === "ol") return "";
  return (node.children ?? []).map(hastText).join("");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
