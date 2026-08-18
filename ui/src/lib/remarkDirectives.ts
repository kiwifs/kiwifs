/**
 * remarkDirectives — Custom remark-directive transforms for KiwiFS.
 *
 * Transforms container directives (:::tabs, :::columns) into HAST nodes
 * that render as custom React components via react-markdown's `components` prop.
 *
 * Works with `remark-directive` which parses the :::name syntax into AST nodes.
 * This plugin then converts those AST nodes to HTML elements with specific
 * data attributes that React components can pick up.
 */

import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { parseFigureAttrs } from "./figureLayout";

/**
 * Attribute names a claim carries through to the DOM.
 *
 * rehype-sanitize strips anything not allow-listed, so an attribute missing
 * from a schema does not fail loudly — the claim renders as an unmarked div
 * with none of the metadata that makes it a claim. There are two copies of
 * the schema (`kiwiSanitizeSchema` in `lib/kiwiMarkdown.ts` and the one in
 * `components/KiwiPage.tsx`); both splice this constant in so at least the
 * claim attributes cannot drift apart.
 */
export const CLAIM_DATA_ATTRIBUTES: string[] = [
  "data-evidence",
  "data-confidence",
  "data-source",
];

/**
 * Normalise a claim's directive attributes into DOM data-attributes.
 *
 * `confidence` is emitted only when it parses as a number. A claim written
 * `{confidence=high}` renders as having no confidence rather than as the
 * literal string, which matches how the server indexes it — the two must
 * agree or the badge disagrees with the audit query.
 */
export function claimProperties(attrs: Record<string, string> = {}): Record<string, string> {
  const props: Record<string, string> = {
    "data-kiwi-directive": "claim",
  };
  if (attrs.evidence) props["data-evidence"] = attrs.evidence;
  if (attrs.source) props["data-source"] = attrs.source;
  if (attrs.confidence != null && attrs.confidence !== "") {
    const parsed = Number(attrs.confidence);
    if (Number.isFinite(parsed)) props["data-confidence"] = String(parsed);
  }
  return props;
}

/**
 * remarkKiwiDirectives — Transform directive AST nodes into renderable HTML.
 *
 * Handles:
 * - :::tabs / ::tab[Label] — tabbed content panels
 * - :::columns / ::col — side-by-side column layouts
 * - :::claim{...} / :claim[text]{...} — claim-level provenance
 * - :::figure{width=wide} — figure with optional caption, stacked
 */
export function remarkKiwiDirectives() {
  return (tree: Root) => {
    visit(tree, (node: any) => {
      // Inline directives: :name[label]{attrs}
      if (node.type === "textDirective" && node.name === "claim") {
        node.data = node.data || {};
        node.data.hName = "span";
        node.data.hProperties = {
          ...claimProperties(node.attributes || {}),
          className: "kiwi-claim kiwi-claim-inline",
        };
        return;
      }

      // Container directives: :::name
      if (node.type === "containerDirective") {
        const name = node.name as string;

        if (name === "claim") {
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            ...claimProperties(node.attributes || {}),
            className: "kiwi-claim kiwi-claim-block",
          };
        } else if (name === "tabs") {
          // Convert to a div with data-kiwi-tabs
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "tabs",
            className: "kiwi-tabs-container",
          };

          // Process child ::tab directives
          for (const child of node.children || []) {
            if (child.type === "containerDirective" && child.name === "tab") {
              // Extract label from the directive's label/children
              const label = extractDirectiveLabel(child);
              child.data = child.data || {};
              child.data.hName = "div";
              child.data.hProperties = {
                "data-kiwi-directive": "tab",
                "data-label": label,
                className: "kiwi-tab-panel",
              };
            }
          }
        } else if (name === "columns") {
          // Extract ratio from attributes: :::columns{ratio="2:1"}
          const attrs = node.attributes || {};
          const ratio = attrs.ratio || "";
          const cols = attrs.cols || "";

          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "columns",
            "data-ratio": ratio,
            "data-cols": cols,
            className: "kiwi-columns-container",
          };

          // Process child ::col directives
          for (const child of node.children || []) {
            if (child.type === "containerDirective" && child.name === "col") {
              child.data = child.data || {};
              child.data.hName = "div";
              child.data.hProperties = {
                "data-kiwi-directive": "col",
                className: "kiwi-col",
              };
            }
          }
        } else if (name === "figure") {
          const display = parseFigureAttrs(node.attributes || {});
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "figure",
            "data-width": display.width,
            ...(display.pin ? { "data-pin": "true" } : {}),
            ...(display.caption ? { "data-caption": display.caption } : {}),
            className: "kiwi-figure-directive",
          };
        } else if (name === "tab") {
          // Standalone ::tab inside a :::tabs — handled by parent
          // If orphaned (no parent tabs), render as-is
          const label = extractDirectiveLabel(node);
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "tab",
            "data-label": label,
            className: "kiwi-tab-panel",
          };
        } else if (name === "col") {
          // Standalone ::col inside a :::columns — handled by parent
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "col",
            className: "kiwi-col",
          };
        }
      }

      // Leaf directives: ::name[label]{attrs}
      if (node.type === "leafDirective") {
        const name = node.name as string;

        if (name === "tab") {
          const label = extractDirectiveLabel(node);
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "tab",
            "data-label": label,
            className: "kiwi-tab-panel",
          };
        } else if (name === "col") {
          node.data = node.data || {};
          node.data.hName = "div";
          node.data.hProperties = {
            "data-kiwi-directive": "col",
            className: "kiwi-col",
          };
        }
      }
    });
  };
}

/**
 * Extract the label text from a directive node.
 * Directive labels come from [Label] syntax: ::tab[My Label]
 */
function extractDirectiveLabel(node: any): string {
  // remark-directive puts [Label] content in node.children as text/phrasing nodes
  if (node.children && node.children.length > 0) {
    // If the first child is a paragraph with text content, use that as label
    // Otherwise just stringify all text nodes
    const texts: string[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        texts.push(child.value);
      } else if (child.type === "paragraph" && child.children) {
        for (const pc of child.children) {
          if (pc.type === "text") texts.push(pc.value);
        }
      }
    }
    // The label is stored differently: for leaf directives ::tab[Label],
    // the label is in the first child text before any body content
    // For container directives, we look at the attributes
  }

  // The label for ::tab[Label] is stored in node.children[0].value
  // but for container directives, remark-directive stores it differently
  // Let's check the attributes and the label property
  if (node.attributes?.label) return node.attributes.label;

  // For leaf directives, the label comes from the [bracketed] content
  // remark-directive stores this in node.children for inline content
  if (node.children && node.children.length > 0) {
    return flattenDirectiveText(node.children);
  }

  return node.name || "Tab";
}

function flattenDirectiveText(children: any[]): string {
  const parts: string[] = [];
  for (const child of children) {
    if (child.type === "text") {
      parts.push(child.value);
    } else if (child.children) {
      parts.push(flattenDirectiveText(child.children));
    }
  }
  return parts.join("") || "Tab";
}
