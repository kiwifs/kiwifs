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

import { SKIP, visit } from "unist-util-visit";
import type { Root } from "mdast";
import { parseFigureAttrs } from "./figureLayout";

/**
 * Attribute names a claim carries through to the DOM.
 *
 * rehype-sanitize strips anything not allow-listed, so an attribute missing
 * from a schema does not fail loudly — the claim renders as an unmarked div
 * with none of the metadata that makes it a claim. `kiwiSanitizeSchema` in
 * `lib/kiwiSanitizeSchema.ts` splices this in; it is the only schema.
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
 *
 * Unknown inline and leaf directives are restored to literal text first; see
 * `remarkLiteralDirectives`.
 */
export function remarkKiwiDirectives() {
  return (tree: Root, file?: { value?: unknown }) => {
    restoreLiteralDirectives(tree, String(file?.value ?? ""));
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

const TEXT_DIRECTIVES = new Set(["claim"]);
const LEAF_DIRECTIVES = new Set(["tab", "col"]);

/**
 * remarkLiteralDirectives — put unknown inline and leaf directives back as
 * the text they were written as.
 *
 * `remark-directive` reads any `:word` as an inline directive, so the `:00` in
 * `09:00`, `Note:important` or `fe80::1ff:fe23:4567` become nodes that
 * remark-rehype renders as empty divs, splitting the paragraph and hiding the
 * text. Run this before the other transforms: `==mark==`, `#tags` and
 * `{% controls %}` match within a single text node, and the restored pieces are
 * merged back into their neighbours.
 */
export function remarkLiteralDirectives() {
  return (tree: Root, file?: { value?: unknown }) => {
    restoreLiteralDirectives(tree, String(file?.value ?? ""));
  };
}

function restoreLiteralDirectives(tree: Root, source: string) {
  const touched = new Set<any>();
  visit(tree, (node: any, index, parent: any) => {
    if (!parent || index === undefined) return;
    if (node.type === "textDirective" && !TEXT_DIRECTIVES.has(node.name)) {
      parent.children[index] = { type: "text", value: directiveSource(node, source, ":"), position: node.position };
      touched.add(parent);
      return SKIP;
    }
    if (node.type === "leafDirective" && !LEAF_DIRECTIVES.has(node.name)) {
      const text = { type: "text", value: directiveSource(node, source, "::"), position: node.position };
      parent.children[index] = { type: "paragraph", children: [text], position: node.position };
      return SKIP;
    }
  });
  for (const parent of touched) mergeAdjacentText(parent.children);
}

function directiveSource(node: any, source: string, marker: string): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (source && typeof start === "number" && typeof end === "number" && end > start) {
    return source.slice(start, end);
  }
  const label = node.children?.length ? `[${literalDirectiveChildren(node.children)}]` : "";
  const attrs = Object.entries(node.attributes || {})
    .map(([key, value]) => {
      if (value === "") return key;
      return /^[^\s"'=<>`{}]+$/.test(String(value)) ? `${key}=${value}` : `${key}=${JSON.stringify(value)}`;
    })
    .join(" ");
  return `${marker}${node.name}${label}${attrs ? `{${attrs}}` : ""}`;
}

function mergeAdjacentText(children: any[]) {
  for (let i = children.length - 1; i > 0; i--) {
    const prev = children[i - 1];
    const node = children[i];
    if (prev.type !== "text" || node.type !== "text") continue;
    prev.value += node.value;
    if (prev.position && node.position) prev.position = { start: prev.position.start, end: node.position.end };
    else delete prev.position;
    children.splice(i, 1);
  }
}

function literalDirectiveChildren(children: any[]): string {
  return children.map((child) => {
    if (child.type === "text") return child.value;
    return child.children ? literalDirectiveChildren(child.children) : "";
  }).join("");
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
