import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeView } from "./TreeView";

const circles = (html: string) =>
  [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="20"/g)].map((m) => `${m[1]},${m[2]}`);

describe("TreeView", () => {
  it("draws a forest from parent pointers with arrows toward the parent", () => {
    const html = renderToStaticMarkup(
      <TreeView parents={[0, 0, 0, 2, 4, 4]} edgeDirection="up" badges={[6, 1, 2, 1, 2, 1]} />,
    );
    expect(circles(html)).toHaveLength(6);
    expect((html.match(/marker-start=/g) ?? []).length).toBe(4);
    expect(html).toContain(">6<");
  });

  it("draws a ghost edge between existing nodes and skips unknown ones", () => {
    const html = renderToStaticMarkup(
      <TreeView parents={[0, 0, 0, 0]} ghostEdges={[{ from: 2, to: 3 }, { from: 9, to: 3 }]} />,
    );
    expect((html.match(/<path d="M [^"]+ Q [^"]+" fill="none"[^>]*stroke-dasharray="4 4"/g) ?? []).length).toBe(1);
  });

  it("keeps repeated values without ids at separate positions", () => {
    const html = renderToStaticMarkup(
      <TreeView root={{ value: 1, left: { value: 1 }, right: { value: 1 } }} />,
    );
    expect(new Set(circles(html)).size).toBe(3);
  });
});
