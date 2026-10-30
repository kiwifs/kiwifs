// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kiwiRehypePlugins, kiwiRemarkPlugins, useKiwiMarkdownComponents } from "@kw/lib/markdownPipeline";
import { resetClocks } from "@kw/widgets/playbackClock";
import { AUTHORING_EXAMPLES } from "./docs/authoringExamples";
import { BROKEN, PENDING } from "./showcase/checks";
import { SHOWCASE_QUERY_ROWS } from "./showcase/queryRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dir = path.join(__dirname, "showcase");

function body(name: string): string {
  const raw = readFileSync(path.join(dir, `${name}.md`), "utf8");
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "");
}

const remark = kiwiRemarkPlugins();
const rehype = kiwiRehypePlugins();

function Page({ md, pagePath }: { md: string; pagePath: string }) {
  const components = useKiwiMarkdownComponents({ path: pagePath, navigate: () => {} });
  return (
    <div className="kiwi-prose">
      <ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const TRACKER_TREE = {
  path: "",
  name: "workspace",
  isDir: true,
  children: [
    {
      path: "01-setup",
      name: "01-setup",
      isDir: true,
      children: [{ path: "01-setup/install.md", name: "install.md", isDir: false, size: 100 }],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetClocks();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/query")) {
      const rows = SHOWCASE_QUERY_ROWS;
      return json({ columns: Object.keys(rows[0]!), rows, total: rows.length, has_more: false });
    }
    if (url.includes("/tree")) return json(TRACKER_TREE);
    if (url.includes("/meta")) return json({ results: [] });
    return new Response("{}", { status: 404 });
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(name: string) {
  await renderMarkdown(body(name), `showcase/${name}.md`);
}

async function renderMarkdown(md: string, pagePath: string) {
  await act(async () => root.render(<Page md={md} pagePath={pagePath} />));
  for (let i = 0; i < 200; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    if (i > 2 && !container.querySelector(PENDING)) break;
  }
}

function count(selector: string): number {
  return container.querySelectorAll(selector).length;
}

function expectNoBrokenBlocks() {
  const text = container.textContent ?? "";
  expect(text).not.toContain("Something went wrong rendering this content");
  expect(text).not.toContain("fence could not be rendered");
  expect(text).not.toMatch(/Steps error|Could not load app/);
  expect(container.querySelector(BROKEN)).toBeNull();
  expect(container.querySelector(PENDING)).toBeNull();
  expect(container.querySelector("code[class*='language-kiwi-'], code[class*='language-widget:']")).toBeNull();
}

describe("showcase fixtures", { timeout: 30_000 }, () => {
  it("architecture-walkthrough", async () => {
    await render("architecture-walkthrough");
    expectNoBrokenBlocks();
    expect(count("figure.kiwi-app")).toBe(1);
    expect(container.querySelector("figure.kiwi-app#lease.kiwi-figure-wide iframe[sandbox='allow-scripts']")).not.toBeNull();
    expect(count(".kiwi-widget")).toBe(2);
    expect(count("figure.kiwi-widget#lease-flow")).toBe(1);
    expect(count("figure.kiwi-widget#lease-messages")).toBe(1);
    expect(count(".kiwi-tabs [role='tab']")).toBe(3);
    expect(count(".kiwi-calc")).toBe(1);
    expect(count(".kiwi-figure-media table")).toBe(1);
    // `kiwi-steps` renders through the typed steps spec; `.kiwi-steps` is the legacy fallback it must not hit.
    expect(count(".kiwi-steps")).toBe(0);
    expect(count("figure.kiwi-widget .kiwi-mermaid")).toBe(1);
    expect(count(".kiwi-admonition")).toBe(3);
  });

  it("algorithm-lesson", async () => {
    await render("algorithm-lesson");
    expectNoBrokenBlocks();
    expect(count(".kiwi-widget")).toBe(3);
    expect(count("figure.kiwi-widget#prefix")).toBe(1);
    expect(count("figure.kiwi-widget#summed-area")).toBe(1);
    expect(count(".kiwi-code-runner")).toBe(1);
    expect(count(".kiwi-quiz")).toBe(1);
    expect(count(".katex-display")).toBe(2);
    expect(count(".katex")).toBeGreaterThan(5);
  });

  it("incident-runbook", async () => {
    await render("incident-runbook");
    expectNoBrokenBlocks();
    expect(count(".kiwi-widget")).toBe(2);
    expect(count("figure.kiwi-widget#response")).toBe(1);
    expect(count("figure.kiwi-widget#last-incident.kiwi-figure-wide")).toBe(1);
    // `kiwi-steps` renders through the typed steps spec; `.kiwi-steps` is the legacy fallback it must not hit.
    expect(count(".kiwi-steps")).toBe(0);
    expect(count("figure.kiwi-widget .kiwi-mermaid")).toBe(1);
    expect(count(".kiwi-diff")).toBe(1);
    expect(count("input[type='checkbox']")).toBe(7);
    expect(count("input[type='checkbox']:not([aria-label])")).toBe(0);
    expect(count(".kiwi-claim-block")).toBe(2);
  });

  it("adr", async () => {
    await render("adr");
    expectNoBrokenBlocks();
    expect(count(".kiwi-columns > .kiwi-col")).toBe(3);
    expect(count(".kiwi-chart")).toBe(1);
    expect(count(".kiwi-claim-block")).toBe(2);
  });

  it("team-dashboard", async () => {
    await render("team-dashboard");
    expectNoBrokenBlocks();
    expect(count(".kiwi-query table tbody tr")).toBe(SHOWCASE_QUERY_ROWS.length);
    expect(count(".kiwi-progress")).toBe(1);
    expect(count(".kiwi-chart")).toBe(1);
    expect(count(".kiwi-kanban-block .kiwi-kanban-column")).toBe(4);
    expect(count(".kiwi-data")).toBe(1);
  });
});

const AUTHORING_CHECKS: Record<string, () => void> = {
  Tabs: () => {
    expect(count(".kiwi-tabs [role='tab']")).toBe(2);
    const panels = Array.from(container.querySelectorAll(".kiwi-tabs [role='tabpanel']"), (p) => p.textContent);
    expect(panels).toEqual([
      expect.stringContaining("acks the job"),
      expect.stringContaining("another worker picks the job up"),
    ]);
  },
  Columns: () => {
    expect(count(".kiwi-columns > .kiwi-col")).toBe(2);
    expect(count(".kiwi-col .kiwi-col")).toBe(0);
  },
  Figure: () => {
    expect(count(".kiwi-figure-media table")).toBe(1);
    expect(count(".kiwi-figure-body table")).toBe(0);
  },
  Claim: () => expect(count(".kiwi-claim-block")).toBe(1),
  "kiwi-playground": () => expect(container.textContent).toContain("Retry policy"),
  "widget:tracker": () => expect(container.textContent).toContain("0/1"),
};

describe("authoring examples", { timeout: 30_000 }, () => {
  it.each(AUTHORING_EXAMPLES.map((ex) => [ex.title, ex] as const))("%s", async (_, ex) => {
    await renderMarkdown(ex.md, "authoring.md");
    const text = container.textContent ?? "";
    expect(text).not.toContain("Something went wrong rendering this content");
    expect(text).not.toContain("fence could not be rendered");
    expect(container.querySelector(BROKEN)).toBeNull();
    AUTHORING_CHECKS[ex.title]?.();
  });
});
