/**
 * Pre-configured remark + rehype plugin chains that produce KiwiFS-quality
 * markdown rendering.  Consumers can plug these into any `react-markdown`
 * instance:
 *
 *   import { kiwiRemarkPlugins, kiwiRehypePlugins } from "@kiwifs/ui";
 *   <ReactMarkdown remarkPlugins={kiwiRemarkPlugins()} rehypePlugins={kiwiRehypePlugins()}>
 *     {content}
 *   </ReactMarkdown>
 */

import {
  kiwiRehypePlugins as pipelineRehypePlugins,
  kiwiRemarkPlugins as pipelineRemarkPlugins,
} from "./markdownPipeline";
import type { LinkResolver } from "./wikiLinks";

export { stripObsidianComments } from "./remarkPlugins";
export { kiwiSanitizeSchema } from "./kiwiSanitizeSchema";

/**
 * Build the standard KiwiFS remark plugin array.
 *
 * Pass a `resolver` to enable wiki-link resolution (`[[page]]` → real path).
 * Without a resolver, wiki links render as plain text.
 */
export function kiwiRemarkPlugins(resolver?: LinkResolver, fromPath?: string): any[] {
  return pipelineRemarkPlugins({ resolver, fromPath });
}

/**
 * Build the standard KiwiFS rehype plugin array.
 *
 * @param autolinkHeadings  If true, headings get wrapped in anchor links.
 */
export function kiwiRehypePlugins(autolinkHeadings = true): any[] {
  return pipelineRehypePlugins({ autolinkHeadings });
}
