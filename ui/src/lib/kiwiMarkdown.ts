/**
 * Pre-configured remark + rehype plugin chains that produce KiwiFS-quality
 * markdown rendering.  Consumers can plug these into any `react-markdown`
 * instance:
 *
 *   import { kiwiRemarkPlugins, kiwiRehypePlugins } from "@kiwifs/ui";
 *   <ReactMarkdown remarkPlugins={kiwiRemarkPlugins} rehypePlugins={kiwiRehypePlugins}>
 *     {content}
 *   </ReactMarkdown>
 */

import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkEmoji from "remark-emoji";
import remarkSupersub from "remark-supersub";
import remarkDefinitionList from "remark-definition-list";
import remarkDirective from "remark-directive";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

import { remarkMark, remarkInlineTags, rehypeCodeMeta } from "./remarkPlugins";
import { CLAIM_DATA_ATTRIBUTES, remarkKiwiDirectives } from "./remarkDirectives";
import { remarkWikiLinks, type LinkResolver } from "./wikiLinks";

export { stripObsidianComments } from "./remarkPlugins";

export const kiwiSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "details", "summary", "kbd", "mark", "span", "div", "figure", "figcaption",
    "video", "audio", "source", "iframe", "section", "sup", "sub", "dl", "dt", "dd", "abbr",
    "svg", "path", "circle", "rect", "ellipse", "line", "polyline", "polygon",
    "g", "defs", "use", "text", "tspan", "clipPath", "mask", "pattern",
    "linearGradient", "radialGradient", "stop", "filter",
    "animate", "animateTransform", "animateMotion", "set",
    "foreignObject", "marker", "symbol", "title", "desc", "metadata",
    "feGaussianBlur", "feOffset", "feMerge", "feMergeNode", "feBlend",
    "feColorMatrix", "feComposite", "feFlood", "feMorphology",
    "style",
  ],
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "irc", "ircs", "mailto", "xmpp", "kiwi", "kiwi-missing"],
  },
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className", "style", "role", "id",
      "data-footnotes", "data-footnote-ref", "data-footnote-backref",
      "data-tag", "metastring",
      "data-kiwi-directive", "data-label", "data-ratio", "data-cols",
      // Claim provenance, shared with the copy of this schema in
      // components/KiwiPage.tsx so the two cannot disagree.
      ...CLAIM_DATA_ATTRIBUTES,
      "aria-describedby", "aria-label"],
    a: [...(defaultSchema.attributes?.a || []), "className", "data-kiwi-target", "data-kiwi-missing"],
    iframe: ["src", "title", "className", "style"],
    video: ["controls", "preload", "className"],
    audio: ["controls", "preload", "className"],
    source: ["src", "type"],
    img: [...(defaultSchema.attributes?.img || []), "width", "height"],
    abbr: ["title"],
    svg: ["viewBox", "xmlns", "xmlnsXlink", "width", "height", "fill", "stroke",
      "className", "preserveAspectRatio", "overflow"],
    path: ["d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin",
      "opacity", "transform", "fillRule", "clipRule", "strokeDasharray", "strokeDashoffset"],
    circle: ["cx", "cy", "r", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    line: ["x1", "y1", "x2", "y2", "stroke", "strokeWidth", "strokeLinecap", "opacity", "transform"],
    polyline: ["points", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "opacity", "transform"],
    polygon: ["points", "fill", "stroke", "strokeWidth", "opacity", "transform"],
    g: ["fill", "stroke", "strokeWidth", "opacity", "transform", "clipPath", "mask", "filter"],
    defs: [],
    use: ["href", "xlinkHref", "x", "y", "width", "height", "transform"],
    text: ["x", "y", "dx", "dy", "textAnchor", "dominantBaseline", "fontSize",
      "fontFamily", "fontWeight", "fill", "opacity", "transform"],
    tspan: ["x", "y", "dx", "dy", "textAnchor", "dominantBaseline", "fontSize",
      "fontFamily", "fontWeight", "fill"],
    clipPath: ["id"],
    mask: ["id", "x", "y", "width", "height", "maskUnits"],
    pattern: ["id", "x", "y", "width", "height", "patternUnits", "patternTransform"],
    linearGradient: ["id", "x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform"],
    radialGradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits", "gradientTransform"],
    stop: ["offset", "stopColor", "stopOpacity"],
    filter: ["id", "x", "y", "width", "height", "filterUnits"],
    animate: ["attributeName", "from", "to", "values", "dur", "repeatCount",
      "begin", "end", "fill", "keyTimes", "keySplines", "calcMode"],
    animateTransform: ["attributeName", "type", "from", "to", "values", "dur",
      "repeatCount", "begin", "end", "fill", "additive", "accumulate"],
    animateMotion: ["path", "dur", "repeatCount", "begin", "end", "fill", "rotate", "keyPoints", "keyTimes"],
    set: ["attributeName", "to", "begin", "dur", "end", "fill"],
    foreignObject: ["x", "y", "width", "height"],
    marker: ["id", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits"],
    symbol: ["id", "viewBox", "preserveAspectRatio"],
    feGaussianBlur: ["in", "stdDeviation", "result"],
    feOffset: ["in", "dx", "dy", "result"],
    feMerge: [],
    feMergeNode: ["in"],
    feBlend: ["in", "in2", "mode", "result"],
    feColorMatrix: ["in", "type", "values", "result"],
    feComposite: ["in", "in2", "operator", "k1", "k2", "k3", "k4", "result"],
    feFlood: ["floodColor", "floodOpacity", "result"],
    feMorphology: ["in", "operator", "radius", "result"],
  },
};

/**
 * Build the standard KiwiFS remark plugin array.
 *
 * Pass a `resolver` to enable wiki-link resolution (`[[page]]` → real path).
 * Without a resolver, wiki links render as plain text.
 */
export function kiwiRemarkPlugins(resolver?: LinkResolver, fromPath?: string): any[] {
  const plugins: any[] = [
    remarkGfm,
    remarkMath,
    remarkMark,
    remarkInlineTags,
    remarkEmoji,
    remarkSupersub,
    remarkDefinitionList,
    remarkDirective,
    remarkKiwiDirectives,
  ];
  if (resolver) {
    plugins.push([remarkWikiLinks, { resolver, fromPath }]);
  }
  return plugins;
}

/**
 * Build the standard KiwiFS rehype plugin array.
 *
 * @param autolinkHeadings  If true, headings get wrapped in anchor links.
 */
export function kiwiRehypePlugins(autolinkHeadings = true): any[] {
  const plugins: any[] = [
    rehypeCodeMeta,
    rehypeRaw,
    [rehypeSanitize, kiwiSanitizeSchema],
    rehypeKatex,
    rehypeSlug,
  ];
  if (autolinkHeadings) {
    plugins.push([rehypeAutolinkHeadings, { behavior: "wrap" }]);
  }
  return plugins;
}
