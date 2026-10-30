import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  evaluateCalc,
  evaluateExpression,
  formatQuantity,
  parseCalcBlock,
  parseQuantity,
} from "./calcBlock";

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

  it("keeps round decimal counts decimal", () => {
    expect(formatQuantity(10_000_000)).toBe("10 M");
    expect(formatQuantity(12_000_000)).toBe("12 M");
    expect(formatQuantity(1024 ** 3)).toBe("1 GiB");
    expect(formatQuantity(1024 * 1024 * 10)).toBe("10 MiB");
  });
});

describe("the expression engine behind kiwi-calc", () => {
  it("no longer routes author text through Function()", async () => {
    const source = await readFile(new URL("./calcBlock.ts", import.meta.url), "utf8");
    // Comments are allowed to mention it; code is not.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bFunction\s*\(/);
    expect(code).not.toMatch(/\beval\s*\(/);
  });

  it("gained ^, %, and the named functions a capacity model wants", () => {
    expect(evaluateExpression("2 ^ 10", {})).toBe(1024);
    expect(evaluateExpression("10 % 3", {})).toBe(1);
    expect(evaluateExpression("ceil(replicas / 3)", { replicas: 10 })).toBe(4);
    expect(evaluateExpression("max(shards, 3)", { shards: 1 })).toBe(3);
    expect(evaluateExpression("log2(partitions)", { partitions: 64 })).toBe(6);
  });

  it("still reads the unit words", () => {
    expect(evaluateExpression("dau / day", { dau: 86400 })).toBe(1);
    expect(evaluateExpression("2 * pi", {})).toBeCloseTo(Math.PI * 2);
  });

  it("reports an unknown name instead of silently producing NaN", () => {
    expect(() => evaluateExpression("qps * 2", {})).toThrow(/unknown name "qps"/);
  });

  it("rejects a division that goes to infinity", () => {
    expect(() => evaluateExpression("1 / 0", {})).toThrow(/finite/);
  });

  it("reads a magnitude or data unit written straight after a number", () => {
    expect(evaluateExpression("dau * 2 k", { dau: 3 })).toBe(6000);
    expect(evaluateExpression("2k + 1", {})).toBe(2001);
    expect(evaluateExpression("1.5 M", {})).toBe(1.5e6);
    expect(evaluateExpression("5 b", {})).toBe(5e9);
    expect(evaluateExpression("3 MB", {})).toBe(3 * 1024 ** 2);
    expect(evaluateExpression("users * 4 KB", { users: 2 })).toBe(8192);
    expect(evaluateExpression("2 Mi", {})).toBe(2 * 1024 ** 2);
    expect(evaluateExpression("90 min / 1 hour", {})).toBe(1.5);
  });

  it("does not resolve one-letter magnitudes as bare names", () => {
    expect(() => evaluateExpression("b * 2", {})).toThrow(/unknown name "b"/);
    expect(() => evaluateExpression("m * x", { x: 1 })).toThrow(/unknown name "m"/);
    expect(() => evaluateExpression("k", {})).toThrow(/unknown name "k"/);
    expect(evaluateExpression("m * x + b", { m: 2, x: 3, b: 1 })).toBe(7);
    expect(evaluateExpression("dau / million", { dau: 3e6 })).toBe(3);
  });

  it("leaves names that merely contain digits alone", () => {
    expect(evaluateExpression("x2 * 2", { x2: 4 })).toBe(8);
    expect(evaluateExpression("max(3, 2)", {})).toBe(3);
  });
});
