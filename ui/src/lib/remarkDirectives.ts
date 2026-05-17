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

/**
 * remarkKiwiDirectives — Transform directive AST nodes into renderable HTML.
 *
 * Handles:
 * - :::tabs / ::tab[Label] — tabbed content panels
 * - :::columns / ::col — side-by-side column layouts
 */
export function remarkKiwiDirectives() {
  return (tree: Root) => {
    visit(tree, (node: any) => {
      // Container directives: :::name
      if (node.type === "containerDirective") {
        const name = node.name as string;

        if (name === "tabs") {
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
