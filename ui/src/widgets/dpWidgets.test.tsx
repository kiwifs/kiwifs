import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cellKey, toCellSet, toSet } from "./sets";
import { formatCell, linkPath, rectExit } from "./cellOverlay";
import { ArrayStack, ArrayView, autoCellSize } from "./ArrayView";
import { MatrixView } from "./MatrixView";
import { BitsView } from "./BitsView";
import { BarView } from "./BarView";
import { CodeHighlight } from "./CodeHighlight";
import { PlaybackControls } from "./PlaybackControls";
import { usePlayback } from "./usePlayback";

const cells = (html: string) => [...html.matchAll(/data-cell="([^"]+)"/g)].map((m) => m[1]);

describe("highlight props", () => {
  it("accept a Set, an array, or a single value", () => {
    expect([...toSet(new Set([1, 2]))]).toEqual([1, 2]);
    expect([...toSet([3, 4])]).toEqual([3, 4]);
    expect([...toSet(5)]).toEqual([5]);
    expect(toSet(undefined).size).toBe(0);
  });

  it("normalise matrix cells from strings, pairs, and objects", () => {
    expect(cellKey("1, 2")).toBe("1,2");
    expect([...toCellSet([1, 2])]).toEqual(["1,2"]);
    expect([...toCellSet([[0, 1], "2,3", { r: 4, c: 5 }])]).toEqual(["0,1", "2,3", "4,5"]);
    expect([...toCellSet(new Set(["0,0"]))]).toEqual(["0,0"]);
  });

  it("no longer crash BarView when given arrays", () => {
    const html = renderToStaticMarkup(<BarView values={[3, 1, 4]} activeIndices={[1] as never} highlightIndices={2 as never} />);
    expect(html).toContain("<svg");
  });
});

describe("formatCell", () => {
  it("renders unfilled, infinite, and boolean cells", () => {
    expect(formatCell(null)).toEqual({ text: "", empty: true });
    expect(formatCell(Infinity).text).toBe("∞");
    expect(formatCell(-Infinity).text).toBe("−∞");
    expect(formatCell(true)).toMatchObject({ text: "T", bool: true });
    expect(formatCell(".", ["."]).empty).toBe(true);
    expect(formatCell(".").empty).toBe(false);
  });
});

describe("overlay geometry", () => {
  const a = { x: 0, y: 0, w: 40, h: 40 };
  const b = { x: 40, y: 0, w: 40, h: 40 };

  it("leaves a rect on the side facing the target", () => {
    expect(rectExit(a, 100, 20, 0)).toEqual({ x: 40, y: 20 });
  });

  it("keeps arrows between touching cells visible with an inset", () => {
    const plain = linkPath(a, b, { bend: 0 }).d;
    const inset = linkPath(a, b, { bend: 0, inset: [0.5, 0.4] }).d;
    const len = (d: string) => {
      const n = d.match(/-?[\d.]+/g)!.map(Number);
      return Math.hypot(n[4]! - n[0]!, n[5]! - n[1]!);
    };
    expect(len(inset)).toBeGreaterThan(len(plain) + 10);
  });
});

describe("ArrayView", () => {
  it("shows unfilled cells dashed and ∞ for infinity", () => {
    const html = renderToStaticMarkup(<ArrayView values={[0, null, Infinity]} />);
    expect(html).toContain("dashed");
    expect(html).toContain("∞");
    expect(cells(html)).toEqual(["0:0", "0:1", "0:2"]);
  });

  it("marks several active cells and reads", () => {
    const html = renderToStaticMarkup(<ArrayView values={[1, 2, 3, 4]} activeIndex={[1, 3]} readIndices={[0]} />);
    expect((html.match(/data-active=""/g) ?? []).length).toBe(2);
  });

  it("puts a row label in a gutter and custom index captions under cells", () => {
    const html = renderToStaticMarkup(<ArrayView label="dp" values={[1, 2]} indexLabels={["∅", "a"]} />);
    expect(html).toContain(">dp<");
    expect(html).toContain("∅");
  });

  it("scrolls instead of wrapping by default", () => {
    expect(renderToStaticMarkup(<ArrayView values={[1, 2]} />)).toContain("overflow-x:auto");
    expect(renderToStaticMarkup(<ArrayView values={[1, 2]} wrap />)).toContain("flex-wrap:wrap");
  });

  it("shrinks cells for long arrays", () => {
    expect(autoCellSize(8)).toBe(48);
    expect(autoCellSize(40)).toBe(32);
  });

  it("draws pointers below when asked", () => {
    const html = renderToStaticMarkup(
      <ArrayView values={[1, 2, 3]} pointers={[{ index: 0, label: "lo" }, { index: 2, label: "hi", side: "bottom" }]} />,
    );
    expect(html.indexOf(">lo<")).toBeLessThan(html.indexOf('data-cell="0:0"'));
    expect(html.indexOf(">hi<")).toBeGreaterThan(html.indexOf('data-cell="0:2"'));
  });
});

describe("ArrayStack", () => {
  it("aligns rows on one axis with indices under the last row only", () => {
    const html = renderToStaticMarkup(
      <ArrayStack rows={[{ label: "hold", values: [1, 2] }, { label: "free", values: [3, null] }]} indexLabels={["d0", "d1"]} />,
    );
    expect(cells(html)).toEqual(["0:0", "0:1", "1:0", "1:1"]);
    expect((html.match(/>d0</g) ?? []).length).toBe(1);
  });
});

describe("MatrixView", () => {
  it("masks the lower triangle and hides its values", () => {
    const html = renderToStaticMarkup(<MatrixView values={[[1, 2], [99, 3]]} mask="lower" />);
    expect(html).not.toContain(">99<");
    expect(html).toContain(">3<");
  });

  it("accepts several active cells as pairs or strings", () => {
    const html = renderToStaticMarkup(<MatrixView values={[[1, 2], [3, 4]]} activeCell={[[0, 0], [1, 1]]} readCells="0,1" />);
    expect((html.match(/--kw-widget-active-foreground/g) ?? []).length).toBe(2);
  });

  it("still takes a single [r, c] active cell", () => {
    const html = renderToStaticMarkup(<MatrixView values={[[1, 2], [3, 4]]} activeCell={[1, 0]} />);
    expect((html.match(/--kw-widget-active-foreground/g) ?? []).length).toBe(1);
  });

  it("shows the chosen layer of a 3D table with tabs", () => {
    const html = renderToStaticMarkup(
      <MatrixView layers={[{ label: "k0", values: [[1]] }, { label: "k1", values: [[42]] }]} layer={1} />,
    );
    expect(html).toContain('role="tab"');
    expect(html).toContain(">42<");
    expect(html).not.toContain(">1</");
  });

  it("accepts rows given as strings", () => {
    const html = renderToStaticMarkup(<MatrixView values={["AB", "C"] as never} centerRows />);
    expect(cells(html)).toEqual(["0,0", "0,1", "1,0"]);
  });

  it("renders sublabels and shades a heatmap", () => {
    const html = renderToStaticMarkup(<MatrixView values={[[0, 10]]} sublabels={[["↖", null]]} heatmap />);
    expect(html).toContain("↖");
    expect(html).toContain("58%");
  });
});

describe("BitsView", () => {
  it("lays bits out most significant first with a summary", () => {
    const html = renderToStaticMarkup(<BitsView value={5} bits={4} />);
    expect(html).toContain("0b0101");
    expect(html).toContain("2 bits set");
    const order = [...html.matchAll(/data-cell="0:(\d)"[^>]*>.*?<span>(?:<span>)?(\d)/g)].map((m) => m[2]);
    expect(order.join("")).toBe("0101");
  });
});

describe("CodeHighlight", () => {
  it("highlights several lines and shows inline values", () => {
    const html = renderToStaticMarkup(
      <CodeHighlight code={["a", "b", "c"]} activeLine={[0, 2]} highlightLines={[1]} annotations={{ 2: "x = 3" }} />,
    );
    expect(html).toContain("← x = 3");
    expect((html.match(/3px solid var\(--kw-widget-active/g) ?? []).length).toBe(2);
  });
});

describe("usePlayback", () => {
  function Probe({ steps }: { steps: unknown[] }) {
    const pb = usePlayback(steps as never);
    const cur = pb.current as unknown as { arr?: number[]; label: string; state: { arr?: number[] } };
    return <span>{`${cur.arr?.join(",")}|${cur.state?.arr?.join(",")}|${cur.label}|${pb.totalSteps}`}</span>;
  }

  it("reads flat steps both directly and through .state", () => {
    const html = renderToStaticMarkup(<Probe steps={[{ arr: [1, 2], label: "go" }]} />);
    expect(html).toContain("1,2|1,2|go|1");
  });

  it("keeps wrapped steps as they are", () => {
    const html = renderToStaticMarkup(<Probe steps={[{ state: { arr: [3] }, label: "x" }]} />);
    expect(html).toContain("|3|x|1");
  });

  it("survives an empty step list", () => {
    expect(renderToStaticMarkup(<Probe steps={[]} />)).toContain("||1");
  });
});

describe("PlaybackControls", () => {
  it("takes the whole playback object", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      <PlaybackControls
        pb={{
          controls: {
            currentStep: 2, totalSteps: 5, playing: false, speed: 2,
            onPlay: noop, onStop: noop, onStepForward: noop, onStepBack: noop, onReset: noop, onSeek: noop, onCycleSpeed: noop,
          },
        }}
      />,
    );
    expect(html).toContain("3/5");
    expect(html).toContain("2x");
  });
});
