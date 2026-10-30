// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kiwiRehypePlugins, kiwiRemarkPlugins, useKiwiMarkdownComponents } from "./markdownPipeline";
import * as kiwiMarkdown from "./kiwiMarkdown";
import { kiwiSanitizeSchema } from "./kiwiMarkdown";
import { buildResolver } from "./wikiLinks";
import type { TreeEntry } from "./api";

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

// Lazily loaded blocks (kiwi-app, tabs content) resolve on their own schedule.
async function waitForElement(selector: string): Promise<Element> {
  return vi.waitFor(
    async () => {
      await act(async () => {});
      const el = container.querySelector(selector);
      if (!el) throw new Error(`${selector} did not render`);
      return el;
    },
    { timeout: 5000, interval: 20 },
  );
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
    const before = await waitForElement("iframe");

    await act(async () => root.render(<Page md={md} onNavigate={() => {}} />));
    expect(await waitForElement("iframe")).toBe(before);
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
    const tabs = await waitForElement(".kiwi-tabs");
    expect(tabs.querySelector('[role="tab"]')?.textContent).toBe("One");
    expect(tabs.textContent).toContain("first");
    expect(container.querySelector(".kiwi-admonition-note")).not.toBeNull();
    expect(container.innerHTML).not.toContain("language-mermaid");
  });
});

describe("kiwiRemarkPlugins + kiwiRehypePlugins", () => {
  it("keeps wiki-link hrefs and directive markers through sanitize", async () => {
    const tree: TreeEntry = {
      path: "",
      name: "",
      isDir: true,
      children: [{ path: "guides/target.md", name: "target.md", isDir: false }],
    };
    const md = ["See [[target]].", "", ":::columns", "left", ":::"].join("\n");
    await act(async () =>
      root.render(
        <ReactMarkdown
          remarkPlugins={kiwiRemarkPlugins({ resolver: buildResolver(tree), fromPath: "guides/a.md" })}
          rehypePlugins={rehype}
        >
          {md}
        </ReactMarkdown>,
      ),
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("#kiwi:guides/target.md");
    expect(container.querySelector("div")?.getAttribute("data-kiwi-directive")).toBe("columns");
  });
});

describe("@kiwifs/ui plugin exports", () => {
  it("are the pipeline's chains behind the positional signatures", () => {
    const resolver = buildResolver(null);
    expect(kiwiMarkdown.kiwiRemarkPlugins(resolver, "a.md")).toEqual(kiwiRemarkPlugins({ resolver, fromPath: "a.md" }));
    expect(kiwiMarkdown.kiwiRemarkPlugins()).toEqual(kiwiRemarkPlugins());
    expect(kiwiMarkdown.kiwiRehypePlugins()).toEqual(kiwiRehypePlugins());
    expect(kiwiMarkdown.kiwiRehypePlugins(false)).toEqual(kiwiRehypePlugins({ autolinkHeadings: false }));
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
