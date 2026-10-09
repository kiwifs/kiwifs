import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphView } from "./GraphView";
import { SequenceView } from "./SequenceView";

describe("GraphView", () => {
  it("keeps the circle look by default and scales to its container", () => {
    const html = renderToStaticMarkup(
      <GraphView nodes={[{ id: 1 }, { id: 2 }]} edges={[{ from: 1, to: 2 }]} layout="circular" />,
    );
    expect((html.match(/<circle /g) ?? []).length).toBe(2);
    expect(html).toContain("max-width:100%");
    expect(html).toContain('viewBox="');
  });

  it("lays out shaped, grouped nodes with dagre and reserves edge labels", () => {
    const html = renderToStaticMarkup(
      <GraphView
        layout="dagre"
        directed
        shape="box"
        nodes={[
          { id: "app", label: "Mobile app", shape: "person" },
          { id: "api", label: "GraphQL API", group: "backend" },
          { id: "db", label: "Events DB", shape: "cylinder", group: "backend" },
        ]}
        groups={[{ id: "backend", label: "Backend" }]}
        edges={[
          { from: "app", to: "api", label: "one query" },
          { from: "api", to: "db", style: "dashed" },
        ]}
      />,
    );
    expect(html).toContain(">Mobile app<");
    expect(html).toContain(">Backend<");
    expect(html).toContain("<ellipse");
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain(">one query<");
  });

  it("uses per-instance arrow markers and fans out opposite edges", () => {
    const html = renderToStaticMarkup(
      <GraphView
        directed
        layout="circular"
        nodes={[{ id: "a" }, { id: "b" }]}
        edges={[{ from: "a", to: "b" }, { from: "b", to: "a" }]}
      />,
    );
    expect(html).not.toContain('id="kw-graph-arrow"');
    expect(html).toMatch(/marker id="kw-graph-[^"]+-arrow-0"/);
    expect((html.match(/ Q /g) ?? []).length).toBe(2);
  });

  it("places packets on an edge and draws badges", () => {
    const html = renderToStaticMarkup(
      <GraphView
        layout="circular"
        nodes={[{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }]}
        edges={[{ from: "a", to: "b" }]}
        packets={[{ edge: "a->b", t: 0.5, label: "GET" }]}
        badges={{ b: 7 }}
      />,
    );
    expect(html).toContain('<circle cx="50" cy="0" r="5.5"');
    expect(html).toContain(">GET<");
    expect(html).toContain(">7<");
  });
});

describe("SequenceView", () => {
  const participants = [
    { id: "c", label: "Client", shape: "person" as const },
    { id: "s", label: "Server" },
    { id: "d", label: "DB", shape: "cylinder" as const },
  ];
  const items = [
    { from: "c", to: "s", label: "POST /orders" },
    { from: "s", to: "d", label: "INSERT" },
    { from: "d", to: "s", label: "ok", kind: "reply" as const },
    { note: "idempotency key stored", over: "s" },
    { from: "s", to: "c", label: "201 Created", kind: "reply" as const },
  ];

  it("renders every item when no step is given", () => {
    const html = renderToStaticMarkup(<SequenceView participants={participants} items={items} />);
    for (const text of ["Client", "POST /orders", "INSERT", "idempotency key stored", "201 Created"]) {
      expect(html).toContain(`>${text}<`);
    }
  });

  it("hides future items and frames them", () => {
    const html = renderToStaticMarkup(
      <SequenceView participants={participants} items={items} step={2} future="hide" frames={[{ kind: "alt", label: "[new key]", from: 1, to: 2 }]} numbered />,
    );
    expect(html).toContain(">1. POST /orders<");
    expect(html).toContain(">2. INSERT<");
    expect(html).not.toContain("201 Created");
    expect(html).toContain(">alt<");
  });
});
