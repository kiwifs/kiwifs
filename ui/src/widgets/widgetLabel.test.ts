import { describe, expect, it } from "vitest";

import {
  headerGutterPx,
  hasMath,
  labelSegments,
  mathSource,
  plainHeaderLength,
} from "./widgetLabel";

function kinds(text: string): string {
  return labelSegments(text)
    .map((s) => (s.kind === "math" ? `[${s.value}]` : s.value))
    .join("");
}

describe("plainHeaderLength", () => {
  it("counts ordinary captions", () => {
    expect(plainHeaderLength("no replace")).toBe(10);
  });

  it("ignores math delimiters and TeX commands", () => {
    expect(plainHeaderLength("$n^k$")).toBe(3);
    expect(plainHeaderLength("$\\binom{n}{k}$")).toBe(3);
  });
});

describe("headerGutterPx", () => {
  it("is zero when there are no headers", () => {
    expect(headerGutterPx(undefined)).toBe(0);
    expect(headerGutterPx([])).toBe(0);
  });

  it("sizes the gutter to the longest caption so 'no replace' stays one line", () => {
    const w = headerGutterPx(["replace", "no replace"]);
    expect(w).toBeGreaterThanOrEqual(10 * 7.4);
    expect(w).toBeGreaterThan(headerGutterPx(["replace"]));
  });

  it("does not shrink below the minimum", () => {
    expect(headerGutterPx(["A"])).toBeGreaterThanOrEqual(36);
  });
});

describe("mathSource", () => {
  it("unwraps $...$ and $$...$$", () => {
    expect(mathSource("$n^k$")).toBe("n^k");
    expect(mathSource("$$\\binom{n}{k}$$")).toBe("\\binom{n}{k}");
  });

  it("treats caret, underscore, and TeX commands as math", () => {
    expect(mathSource("n^k")).toBe("n^k");
    expect(mathSource("n^{\\underline{k}}")).toBe("n^{\\underline{k}}");
    expect(mathSource("\\binom{n}{k}")).toBe("\\binom{n}{k}");
  });

  it("treats a factorial ratio as math", () => {
    expect(mathSource("n! / (n-k)!")).toBe("n! / (n-k)!");
  });

  it("treats compact calls as math", () => {
    expect(mathSource("M(t)")).toBe("M(t)");
    expect(mathSource("N(0,1)")).toBe("N(0,1)");
    expect(mathSource("C(n,k)")).toBe("C(n,k)");
    expect(mathSource("M'(0)")).toBe("M'(0)");
  });

  it("leaves ordinary words alone", () => {
    expect(mathSource("next lecture")).toBeNull();
    expect(mathSource("no replace")).toBeNull();
    expect(mathSource("C(n, k)")).toBeNull();
    expect(mathSource("fib(5)")).toBeNull();
    expect(mathSource("")).toBeNull();
  });

  it("leaves mixed sentences as mixed (not a single source)", () => {
    expect(mathSource("the MGF is e^{t^2/2}")).toBeNull();
  });
});

describe("labelSegments", () => {
  it("keeps a plain sentence as one text segment", () => {
    expect(labelSegments("next lecture")).toEqual([{ kind: "text", value: "next lecture" }]);
  });

  it("unwraps a lone $...$ string", () => {
    expect(labelSegments("$n^k$")).toEqual([{ kind: "math", value: "n^k" }]);
  });

  it("finds math islands inside a sentence", () => {
    expect(kinds("M(t) = E(e^{tX}) is a curve in t. For Z ~ N(0,1) it is e^{t^2/2}.")).toBe(
      "[M(t) = E(e^{tX})] is a curve in t. For [Z ~ N(0,1)] it is [e^{t^2/2}].",
    );
  });

  it("reads derivatives and moments at zero", () => {
    expect(kinds("M'(0) = E(Z) = 0. M''(0) = E(Z^2) = 1.")).toBe(
      "[M'(0) = E(Z) = 0]. [M''(0) = E(Z^2) = 1].",
    );
  });

  it("keeps markdown and code fences as text", () => {
    expect(kinds("Look up **target - n** in `seen` before inserting.")).toBe(
      "Look up **target - n** in `seen` before inserting.",
    );
  });

  it("does not treat spaced C(n, k) or code calls as math", () => {
    expect(hasMath("C(n, k)")).toBe(false);
    expect(hasMath("fib(5)")).toBe(false);
    expect(hasMath("dfs(node=3)")).toBe(false);
  });

  it("treats distribution names and Var/Cov as math", () => {
    expect(mathSource("Unif(0,1)")).toBe("Unif(0,1)");
    expect(mathSource("Var(X)")).toBe("Var(X)");
    expect(mathSource("Expo(1)")).toBe("Expo(1)");
  });

  it("keeps subscripts and products together", () => {
    expect(mathSource("M_Z(t)")).toBe("M_Z(t)");
    expect(mathSource("f_{X+Y}")).toBe("f_{X+Y}");
    expect(mathSource("(n+1)p^n")).toBe("(n+1)p^n");
  });

  it("renders absolute values and numeric ratios", () => {
    expect(mathSource("|S|")).toBe("|S|");
    expect(mathSource("E|X-Y|")).toBe("E|X-Y|");
    expect(kinds("the integral is 1/3.")).toBe("the integral is [1/3].");
  });

  it("does not treat look/see as a ratio", () => {
    expect(hasMath("look/see")).toBe(false);
  });

  it("leaves an unmatched dollar as text", () => {
    expect(labelSegments("it costs $5 today")).toEqual([
      { kind: "text", value: "it costs $5 today" },
    ]);
  });
});
