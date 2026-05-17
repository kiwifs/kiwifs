import { type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { buildResolver, remarkWikiLinks } from "@kw/lib/wikiLinks";
import { mockTree } from "./data";

const resolver = buildResolver(mockTree);

/**
 * Shared markdown renderer for stories that matches the KiwiPage plugin chain.
 * Pass body-only markdown (frontmatter already stripped).
 */
export function StoryMarkdown({
  children,
  innerRef,
  className = "kiwi-prose",
}: {
  children: string;
  innerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <div ref={innerRef as React.Ref<HTMLDivElement>} className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, [remarkWikiLinks, { resolver }]]}
        rehypePlugins={[
          rehypeRaw,
          rehypeKatex,
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: "wrap" }],
        ]}
        components={{
          a: ({ href, children: kids, ...rest }) => {
            const h = href ?? "";
            if (h.startsWith("kiwi:")) {
              const target = h.slice("kiwi:".length);
              const exists = resolver(target) !== null;
              return (
                <a
                  href="#"
                  className={exists ? "wiki-link" : "wiki-link-missing"}
                  onClick={(e) => e.preventDefault()}
                  {...rest}
                >
                  {kids}
                </a>
              );
            }
            return <a href={h} {...rest}>{kids}</a>;
          },
          img: ({ src, alt, ...rest }) => (
            <span
              className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              {...rest}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
              {alt || src}
            </span>
          ),
          table: ({ children, node: _node, ...rest }: any) => (
            <div className="kiwi-table-wrapper">
              <table {...rest}>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
