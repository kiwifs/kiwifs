// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kiwiRehypePlugins, kiwiRemarkPlugins, useKiwiMarkdownComponents } from "./markdownPipeline";
import { kiwiSanitizeSchema } from "./kiwiMarkdown";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const remark = kiwiRemarkPlugins();
const rehype = kiwiRehypePlugins();

function Page({ md, onNavigate }: { md: string; onNavigate: (p: string) => void }) {
  const components = useKiwiMarkdownComponents({ path: "guides/a.md", navigate: onNavigate });
  return (
    <div className="kiwi-prose">
      <ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("useKiwiMarkdownComponents", () => {
  it("keeps one element map across renders with a fresh onNavigate", async () => {
    const seen: unknown[] = [];
    function Probe({ nav }: { nav: (p: string) => void }) {
      seen.push(useKiwiMarkdownComponents({ path: "a.md", navigate: nav }));
      return null;
    }
    await act(async () => root.render(<Probe nav={() => {}} />));
    await act(async () => root.render(<Probe nav={() => {}} />));
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("does not remount a kiwi-app when the page re-renders", async () => {
    const md = "```kiwi-app id=x\n<p>a</p>\n<p>b</p>\n```\n";
    await act(async () => root.render(<Page md={md} onNavigate={() => {}} />));
    await settle();
    const before = container.querySelector("iframe");
    expect(before).not.toBeNull();

    await act(async () => root.render(<Page md={md} onNavigate={() => {}} />));
    await settle();
    expect(container.querySelector("iframe")).toBe(before);
  });

  it("renders fences, directives and admonitions", async () => {
    const md = [
      "> [!NOTE]",
      "> Heads up.",
      "",
      ":::tabs",
      "::::tab{label=One}",
      "first",
      "::::",
      ":::",
      "",
      "```mermaid",
      "graph LR",
      "  A --> B",
      "```",
    ].join("\n");
    await act(async () => root.render(<Page md={md} onNavigate={() => {}} />));
    await settle();
    expect(container.querySelector(".kiwi-admonition-note")).not.toBeNull();
    expect(container.innerHTML).not.toContain("language-mermaid");
  });
});

describe("kiwiSanitizeSchema", () => {
  it("keeps the page-control attributes the page schema used to add", () => {
    const star = (kiwiSanitizeSchema.attributes as Record<string, unknown[]>)["*"]!;
    for (const name of ["data-control", "data-control-attrs", "data-var"]) {
      expect(star.some((a) => a === name || (Array.isArray(a) && a[0] === name) || a === name.replace(/-(\w)/g, (_, c) => c.toUpperCase()))).toBe(true);
    }
  });
});
