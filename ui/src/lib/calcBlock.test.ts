import { describe, expect, it } from "vitest";
import { evaluateCalc, formatQuantity, parseCalcBlock, parseQuantity } from "./calcBlock";

describe("parseQuantity", () => {
  it("scales word suffixes", () => {
    expect(parseQuantity("10 million")).toBe(10_000_000);
    expect(parseQuantity("1 KB")).toBe(1024);
  });

  it("divides by a trailing / day", () => {
    expect(parseQuantity("100 / user / day")).toBeCloseTo(100 / 86400);
  });
});

describe("parseCalcBlock + evaluateCalc", () => {
  const src = `
dau:        10 million
writes:     100
write_size: 1 KB
---
qps:     dau * writes / day
daily:   dau * writes * write_size
yearly:  daily * year
`;

  it("parses assumptions above the rule and derivations below", () => {
    const doc = parseCalcBlock(src);
    expect(doc.assumptions.map((a) => a.name)).toEqual(["dau", "writes", "write_size"]);
    expect(doc.derivations.map((d) => d.name)).toEqual(["qps", "daily", "yearly"]);
  });

  it("evaluates the classic DAU back-of-envelope", () => {
    const result = evaluateCalc(parseCalcBlock(src));
    expect(result.values.qps).toBeCloseTo(10_000_000 * 100 / 86400, 3);
    expect(result.values.daily).toBe(10_000_000 * 100 * 1024);
    expect(result.values.yearly).toBe(10_000_000 * 100 * 1024 * 86400 * 365);
  });

  it("honours assumption overrides", () => {
    const result = evaluateCalc(parseCalcBlock(src), { dau: 1_000_000 });
    expect(result.values.qps).toBeCloseTo(1_000_000 * 100 / 86400, 3);
  });
});

describe("formatQuantity", () => {
  it("uses SI-ish grouping", () => {
    expect(formatQuantity(11574)).toMatch(/11[.,]57 k|11.6 k/);
    expect(formatQuantity(1024)).toBe("1 KiB");
  });
});
