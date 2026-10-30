import { ShikiCode } from "@kw/components/ShikiCode";
import { StoryMarkdown } from "@kw/components/__mocks__/StoryMarkdown";

/**
 * Markdown source on the left, the page's own rendering of it on the right.
 * The rendering goes through the same pipeline as a real page, so a block
 * that breaks here is broken in the product too.
 */
export function Example({ md, title }: { md: string; title?: string }) {
  const source = md.trim();
  return (
    <div
      className="not-prose"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
        gap: 16,
        alignItems: "start",
        margin: "16px 0 32px",
      }}
    >
      <ShikiCode code={source} lang="markdown" title={title ?? "Markdown"} />
      <div className="rounded-lg border border-border bg-background p-4 text-foreground">
        <StoryMarkdown>{source}</StoryMarkdown>
      </div>
    </div>
  );
}
