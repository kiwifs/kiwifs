/// <reference types="vite/client" />
/**
 * Real-world markdown pages used to pin editor round-trip behaviour. Loaded as
 * raw strings so CRLF and BOM bytes reach the tests untouched.
 */
const raw = import.meta.glob("./fixtures/markdown/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type MarkdownFixture = { name: string; content: string };

export const markdownFixtures: MarkdownFixture[] = Object.entries(raw)
  .map(([file, content]) => ({
    name: file.replace(/^.*\//, "").replace(/\.md$/, ""),
    content,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
