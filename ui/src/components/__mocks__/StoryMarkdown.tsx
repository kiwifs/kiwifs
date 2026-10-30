import { useMemo, type RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { buildResolver } from "@kw/lib/wikiLinks";
import { kiwiRehypePlugins, kiwiRemarkPlugins, useKiwiMarkdownComponents } from "@kw/lib/markdownPipeline";
import { stripObsidianComments } from "@kw/lib/remarkPlugins";
import { mockTree } from "./data";

const resolver = buildResolver(mockTree);
const remarkPlugins = kiwiRemarkPlugins({ resolver });
const rehypePlugins = kiwiRehypePlugins();
const noop = () => {};

/**
 * Stories have no file server, so images render as a labelled placeholder;
 * everything else is the page's own element map.
 */
const storyImg: Components["img"] = ({ src, alt, node: _node, ...rest }) => (
  <span
    className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    {...rest}
  >
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
    </svg>
    {alt || String(src ?? "")}
  </span>
);

/**
 * Markdown in stories, through the same pipeline as KiwiPage: fences,
 * directives, admonitions, quizzes, sanitizing and code meta all run.
 * Pass body-only markdown (frontmatter already stripped).
 */
export function StoryMarkdown({
  children,
  innerRef,
  className = "kiwi-prose",
  path = "",
  onNavigate = noop,
}: {
  children: string;
  innerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  /** The page the markdown pretends to live on, for relative links and `src=`. */
  path?: string;
  onNavigate?: (path: string) => void;
}) {
  const base = useKiwiMarkdownComponents({ path, navigate: onNavigate });
  const components = useMemo(() => ({ ...base, img: storyImg }), [base]);
  return (
    <div ref={innerRef as React.Ref<HTMLDivElement>} className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {stripObsidianComments(children)}
      </ReactMarkdown>
    </div>
  );
}
