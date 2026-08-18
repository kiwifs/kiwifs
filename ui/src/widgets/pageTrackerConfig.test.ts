import { describe, expect, it } from "vitest";
import {
  chipsForMeta,
  parseCompanies,
  parseTrackerConfig,
  parseTrackerPageMeta,
} from "./pageTrackerConfig";

describe("parseTrackerConfig", () => {
  it("treats a bare name as the state document", () => {
    expect(parseTrackerConfig("progress")).toEqual({
      stateName: "progress",
      modes: [{ id: "tags", label: "Tags", fields: ["tags"] }],
    });
  });

  it("parses named modes from YAML", () => {
    const cfg = parseTrackerConfig(`
state: progress
modes:
  - id: lists
    label: Lists
    fields: [tags]
  - id: companies
    label: Companies
    fields: [difficulty, premium, companies]
`);
    expect(cfg.stateName).toBe("progress");
    expect(cfg.modes).toEqual([
      { id: "lists", label: "Lists", fields: ["tags"] },
      { id: "companies", label: "Companies", fields: ["difficulty", "premium", "companies"] },
    ]);
  });
});

describe("parseCompanies", () => {
  it("reads tuple arrays and string dumps", () => {
    expect(parseCompanies([["google", 210], ["meta", 88]])).toEqual([
      { slug: "google", hits: 210 },
      { slug: "meta", hits: 88 },
    ]);
    expect(parseCompanies("[[google, 210], [meta, 88]]")).toEqual([
      { slug: "google", hits: 210 },
      { slug: "meta", hits: 88 },
    ]);
    expect(parseCompanies(["[facebook", "2]", "[google", "210]"])).toEqual([
      { slug: "facebook", hits: 2 },
      { slug: "google", hits: 210 },
    ]);
  });
});

describe("chipsForMeta", () => {
  const meta = parseTrackerPageMeta({
    title: "Two Sum",
    difficulty: "easy",
    tags: ["easy", "blind75", "premium"],
    companies: [["google", 210], ["amazon", 98]],
  });

  it("keeps the original tags+difficulty universe", () => {
    expect(new Set(chipsForMeta(meta, ["tags"]))).toEqual(
      new Set(["easy", "blind75", "premium"]),
    );
  });

  it("can restrict chips to difficulty, premium, and company slugs", () => {
    expect(new Set(chipsForMeta(meta, ["difficulty", "premium", "companies"]))).toEqual(
      new Set(["easy", "premium", "google", "amazon"]),
    );
  });
});
