import { describe, expect, it } from "vitest";
import {
  CLAIM_LOW_CONFIDENCE,
  claimEvidenceTone,
  formatConfidence,
  isLowConfidence,
  isUnsourcedClaim,
  isUnsupportedClaim,
  parseConfidence,
} from "./claimDisplay";

describe("parseConfidence", () => {
  it("parses numeric strings", () => {
    expect(parseConfidence("0.6")).toBe(0.6);
    expect(parseConfidence("1")).toBe(1);
    expect(parseConfidence("0")).toBe(0);
  });

  // The server indexes an unparseable confidence as null. If the badge showed
  // "high" the page would assert something the audit query cannot see.
  it("returns null for absent or non-numeric input", () => {
    expect(parseConfidence(undefined)).toBeNull();
    expect(parseConfidence(null)).toBeNull();
    expect(parseConfidence("")).toBeNull();
    expect(parseConfidence("high")).toBeNull();
    expect(parseConfidence("0.6 or so")).toBeNull();
  });
});

describe("formatConfidence", () => {
  it("renders 0..1 as a percentage", () => {
    expect(formatConfidence("0.6")).toBe("60%");
    expect(formatConfidence("0.455")).toBe("46%");
    expect(formatConfidence("1")).toBe("100%");
    expect(formatConfidence("0")).toBe("0%");
  });

  // A value outside 0..1 is not a probability, so it is shown as written
  // rather than rescaled into a percentage it never meant.
  it("renders out-of-range values verbatim", () => {
    expect(formatConfidence("90")).toBe("90");
    expect(formatConfidence("-1")).toBe("-1");
  });

  it("returns null when there is nothing to show", () => {
    expect(formatConfidence(undefined)).toBeNull();
    expect(formatConfidence("high")).toBeNull();
  });
});

describe("isLowConfidence", () => {
  it("uses the same threshold as the audit query", () => {
    expect(CLAIM_LOW_CONFIDENCE).toBe(0.7);
    expect(isLowConfidence("0.69")).toBe(true);
    expect(isLowConfidence("0.7")).toBe(false);
    expect(isLowConfidence("0.95")).toBe(false);
  });

  it("is false when there is no parseable confidence", () => {
    expect(isLowConfidence(undefined)).toBe(false);
    expect(isLowConfidence("high")).toBe(false);
  });
});

describe("isUnsourcedClaim", () => {
  it("treats missing and blank sources as unsourced", () => {
    expect(isUnsourcedClaim({})).toBe(true);
    expect(isUnsourcedClaim({ source: "" })).toBe(true);
    expect(isUnsourcedClaim({ source: "   " })).toBe(true);
    expect(isUnsourcedClaim({ source: "sources/reports/575784" })).toBe(false);
  });
});

describe("isUnsupportedClaim", () => {
  it("flags an unsourced low-confidence claim — the audit query's target", () => {
    expect(isUnsupportedClaim({ evidence: "inferred", confidence: "0.6" })).toBe(true);
  });

  it("flags an unsourced claim with no confidence at all", () => {
    expect(isUnsupportedClaim({ evidence: "inferred" })).toBe(true);
  });

  // A low number with a citation is honest bookkeeping, not a gap.
  it("never flags a sourced claim, however low its confidence", () => {
    expect(isUnsupportedClaim({ confidence: "0.1", source: "sources/x" })).toBe(false);
  });

  it("does not flag an unsourced but confident claim", () => {
    expect(isUnsupportedClaim({ confidence: "0.95" })).toBe(false);
  });

  it("flags a claim whose confidence does not parse, since nothing supports it", () => {
    expect(isUnsupportedClaim({ confidence: "high" })).toBe(true);
  });
});

describe("claimEvidenceTone", () => {
  it("gives each known evidence class its own tone", () => {
    const stated = claimEvidenceTone("stated");
    const inferred = claimEvidenceTone("inferred");
    expect(stated).not.toBe(inferred);
    expect(stated).toContain("emerald");
    expect(inferred).toContain("amber");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(claimEvidenceTone("  Inferred ")).toBe(claimEvidenceTone("inferred"));
  });

  // Workspaces define their own vocabularies; an unknown class still renders.
  it("falls back to a neutral tone rather than dropping the badge", () => {
    expect(claimEvidenceTone("hearsay")).toContain("muted");
    expect(claimEvidenceTone(undefined)).toContain("muted");
  });
});
