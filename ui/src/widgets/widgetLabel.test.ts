import { describe, expect, it } from "vitest";

import { headerGutterPx, mathSource, plainHeaderLength } from "./widgetLabel";

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

  it("leaves ordinary words alone", () => {
    expect(mathSource("next lecture")).toBeNull();
    expect(mathSource("no replace")).toBeNull();
    expect(mathSource("C(n, k)")).toBeNull();
    expect(mathSource("")).toBeNull();
  });
});
