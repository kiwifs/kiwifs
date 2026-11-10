import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fitFontSize, fitInCircle, labelWidth, truncateLabel } from "./textFit";
import { autoCellWidth } from "./ArrayView";
import { measureNode } from "./graphGeometry";
import { TreeView } from "./TreeView";
import { LinkedListView } from "./LinkedListView";
import { BarView } from "./BarView";

describe("fitFontSize", () => {
  it("keeps the base size when the text fits", () => {
    expect(fitFontSize("7", 40, 16)).toBe(16);
  });

  it("shrinks long text until it fits", () => {
    const px = fitFontSize("1000000", 38, 16);
    expect(px).toBeLessThan(16);
    expect(labelWidth("1000000", px)).toBeLessThanOrEqual(38);
  });

  it("never goes below the floor", () => {
    expect(fitFontSize("a very long label indeed", 20, 14, { min: 9 })).toBe(9);
  });

  it("ignores math delimiters when measuring", () => {
    expect(fitFontSize("$x$", 20, 14)).toBe(14);
  });
});

describe("truncateLabel", () => {
  it("leaves short labels alone", () => {
    expect(truncateLabel("abc", 100, 12)).toBe("abc");
  });

  it("cuts with an ellipsis to fit", () => {
    const cut = truncateLabel("supercalifragilistic", 40, 12, { mono: true });
    expect(cut.endsWith("…")).toBe(true);
    expect(labelWidth(cut, 12, { mono: true })).toBeLessThanOrEqual(40);
  });

  it("never cuts math", () => {
    expect(truncateLabel("$\\sum_{i=0}^{n} a_i$", 10, 12)).toBe("$\\sum_{i=0}^{n} a_i$");
  });
});

describe("fitInCircle", () => {
  it("shrinks before it truncates, and reports the full text when cut", () => {
    const short = fitInCircle("100", 40, 14, { mono: true });
    expect(short).toEqual({ text: "100", fontSize: 14 });
    const medium = fitInCircle("12345", 40, 14, { mono: true });
    expect(medium.text).toBe("12345");
    expect(medium.fontSize).toBeLessThan(14);
    const long = fitInCircle("hello world", 40, 14, { mono: true });
    expect(long.full).toBe("hello world");
    expect(long.text.endsWith("…")).toBe(true);
  });
});

describe("autoCellWidth", () => {
  it("keeps short values square", () => {
    expect(autoCellWidth(48, ["1", "23", "-4"])).toBe(48);
  });

  it("widens for words, capped", () => {
    const w = autoCellWidth(48, ["banana", "kiwi"]);
    expect(w).toBeGreaterThan(48);
    expect(autoCellWidth(48, ["x".repeat(200)])).toBe(96);
  });
});

describe("measureNode circle", () => {
  it("shrinks the label once the circle stops growing", () => {
    const box = measureNode({ label: "a-long-node-label", shape: "circle", nodeSize: 36 });
    expect(box.w).toBeLessThanOrEqual(36 * 2.2);
    expect(box.fontSize).toBeLessThan(13);
  });

  it("keeps short labels at full size", () => {
    expect(measureNode({ label: "A", shape: "circle", nodeSize: 36 }).fontSize).toBe(13);
  });
});

describe("TreeView labels", () => {
  it("fits a long value into its node and keeps the full value as a tooltip", () => {
    const html = renderToStaticMarkup(
      <TreeView root={{ value: "a-very-long-value", left: { value: 1 } }} animate={false} />,
    );
    expect(html).toContain("<title>a-very-long-value</title>");
    expect(html).toContain("…");
  });

  it("is centred: equal space either side of a lone node", () => {
    const html = renderToStaticMarkup(<TreeView root={{ value: 1 }} animate={false} />);
    const w = Number(html.match(/<svg[^>]*width="([\d.]+)"/)![1]);
    const cx = Number(html.match(/<circle cx="([\d.]+)"/)![1]);
    expect(cx).toBeCloseTo(w / 2, 5);
  });
});

describe("LinkedListView", () => {
  it("widens boxes for long values", () => {
    const narrow = renderToStaticMarkup(<LinkedListView nodes={[{ value: 1 }, { value: 2 }]} />);
    const wide = renderToStaticMarkup(<LinkedListView nodes={[{ value: "alpha-beta" }, { value: 2 }]} />);
    const width = (html: string) => Number(html.match(/<svg[^>]*width="([\d.]+)"/)![1]);
    expect(width(wide)).toBeGreaterThan(width(narrow));
  });

  it("makes room above for stacked pointers", () => {
    const html = renderToStaticMarkup(
      <LinkedListView
        nodes={[{ value: 1 }, { value: 2 }]}
        pointers={[
          { index: 0, label: "head" },
          { index: 0, label: "slow" },
          { index: 0, label: "fast" },
        ]}
      />,
    );
    const ys = [...html.matchAll(/<text[^>]*y="(-?[\d.]+)"[^>]*>(?:head|slow|fast)</g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    expect(Math.min(...ys)).toBeGreaterThan(8);
  });

  it("gives each list its own arrow markers", () => {
    const html = renderToStaticMarkup(
      <>
        <LinkedListView nodes={[{ value: 1 }]} activeColor="red" />
        <LinkedListView nodes={[{ value: 1 }]} activeColor="blue" />
      </>,
    );
    const ids = [...html.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("BarView labels", () => {
  const widthOf = (html: string) => Number(/<svg[^>]*width="([\d.]+)"/.exec(html)![1]);

  it("widens the gap so long category labels don't overlap", () => {
    const short = renderToStaticMarkup(<BarView values={[3, 1, 2]} labels={["a", "b", "c"]} />);
    const long = renderToStaticMarkup(
      <BarView values={[3, 1, 2]} labels={["a (remaining)", "b (divisor)", "value (doubled)"]} />,
    );
    expect(widthOf(long)).toBeGreaterThan(widthOf(short));
    expect(long).not.toContain("…");
  });

  it("truncates labels past the cap, with the full text as a tooltip", () => {
    const label = "an extremely long category label that cannot fit";
    const html = renderToStaticMarkup(<BarView values={[1, 2]} labels={[label, "b"]} />);
    expect(html).toContain("…");
    expect(html).toContain(`<title>${label}</title>`);
  });
});
