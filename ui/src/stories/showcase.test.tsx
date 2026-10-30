// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kiwiRehypePlugins, kiwiRemarkPlugins, useKiwiMarkdownComponents } from "@kw/lib/markdownPipeline";
import { resetClocks } from "@kw/widgets/playbackClock";
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetClocks();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/query")) {
      const rows = SHOWCASE_QUERY_ROWS;
      return new Response(JSON.stringify({ columns: Object.keys(rows[0]!), rows, total: rows.length, has_more: false }), {
        headers: { "Content-Type": "application/json" },
      });
    }
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

const PENDING = ".my-4.h-24.animate-pulse, .kiwi-query-loading, .kiwi-chart-loading, .kiwi-kanban-loading";

async function render(name: string) {
  await act(async () => root.render(<Page md={body(name)} pagePath={`showcase/${name}.md`} />));
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

const BLOCK_ERRORS = [
  ".kiwi-calc-error",
  ".kiwi-chart-error",
  ".kiwi-progress-error",
  ".kiwi-kanban-error",
  ".kiwi-data-error",
  ".kiwi-query-error",
  ".kiwi-quiz-error",
].join(", ");

function expectNoBrokenBlocks() {
  const text = container.textContent ?? "";
  expect(text).not.toContain("Something went wrong rendering this content");
  expect(text).not.toContain("fence could not be rendered");
  expect(text).not.toMatch(/Steps error|Could not load app/);
  expect(container.querySelector(BLOCK_ERRORS)).toBeNull();
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
    expect(count(".kiwi-figure-wide table")).toBe(1);
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
    expect(count(".kiwi-diff")).toBe(1);
    expect(count("input[type='checkbox']")).toBe(7);
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
