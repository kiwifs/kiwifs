import { describe, expect, it } from "vitest";
import { assignTagTones, normalizeColorMap, resolveTagTone, toneFromSpec } from "./tagStyle";
import { bannerChips, chipsFromField, labeledCount, parseFlowList, propertyHiddenKeys } from "./frontmatterTags";

describe("labeledCount", () => {
  it("reads [name, n] pairs and rejects nested values", () => {
    expect(labeledCount(["facebook", 2])).toEqual({ label: "facebook", count: 2 });
    expect(labeledCount(["google"])).toEqual({ label: "google" });
    expect(labeledCount(["easy", "blind75"])).toBeNull();
    expect(labeledCount(["nested", ["x"]])).toBeNull();
    expect(labeledCount("facebook")).toBeNull();
    expect(parseFlowList("[[facebook, 2], [google, 210]]")).toEqual([
      ["facebook", 2],
      ["google", 210],
    ]);
  });
});

describe("chipsFromField", () => {
  it("turns company tuples into one chip per name", () => {
    expect(chipsFromField("companies", [["facebook", 2], ["google", 210]])).toEqual([
      { key: "companies", colorKey: "facebook", label: "facebook", count: 2 },
      { key: "companies", colorKey: "google", label: "google", count: 210 },
    ]);
  });

  it("repairs string dumps and comma-split fragments", () => {
    expect(chipsFromField("companies", "[[facebook, 2], [google, 210]]")).toEqual([
      { key: "companies", colorKey: "facebook", label: "facebook", count: 2 },
      { key: "companies", colorKey: "google", label: "google", count: 210 },
    ]);
    expect(chipsFromField("companies", ["[facebook", "2]", "[google", "210]"])).toEqual([
      { key: "companies", colorKey: "facebook", label: "facebook", count: 2 },
      { key: "companies", colorKey: "google", label: "google", count: 210 },
    ]);
  });

  it("does not treat a flat string list as tuples", () => {
    expect(chipsFromField("tags", ["easy", "blind75"])).toEqual([
      { key: "tags", colorKey: "easy", label: "easy" },
      { key: "tags", colorKey: "blind75", label: "blind75" },
    ]);
  });

  it("keeps booleans, numbers, and string lists as chips", () => {
    expect(chipsFromField("premium", true)).toEqual([
      { key: "premium", colorKey: "premium", label: "premium" },
    ]);
    expect(chipsFromField("premium", false)).toEqual([]);
    expect(chipsFromField("freq", 87)).toEqual([
      { key: "freq", colorKey: "freq", label: "freq 87" },
    ]);
    expect(chipsFromField("tags", ["blind75", "star"])).toEqual([
      { key: "tags", colorKey: "blind75", label: "blind75" },
      { key: "tags", colorKey: "star", label: "star" },
    ]);
  });
});

describe("bannerChips", () => {
  it("follows banner order and skips title/status", () => {
    const chips = bannerChips(
      {
        title: "Two Sum",
        status: "published",
        difficulty: "easy",
        premium: true,
        tags: ["easy", "blind75"],
        companies: [["google", 210], ["facebook", 2]],
      },
      ["difficulty", "premium", "tags", "companies"],
    );
    expect(chips.map((c) => c.label)).toEqual([
      "easy",
      "premium",
      "blind75",
      "google",
      "facebook",
    ]);
    expect(chips.find((c) => c.colorKey === "google")?.count).toBe(210);
  });
});

describe("propertyHiddenKeys", () => {
  it("hides title, status, tags, banner fields, and explicit hide keys", () => {
    const hidden = propertyHiddenKeys(["difficulty", "companies"], ["freq"]);
    expect(hidden.has("title")).toBe(true);
    expect(hidden.has("difficulty")).toBe(true);
    expect(hidden.has("freq")).toBe(true);
    expect(hidden.has("leetcode")).toBe(false);
  });
});

describe("tag colors", () => {
  it("uses config, then built-in difficulty, then a hashed fallback", () => {
    const colors = normalizeColorMap({ Google: "#4285F4", premium: "violet" });
    expect(resolveTagTone("easy", colors)?.className).toContain("emerald");
    expect(resolveTagTone("premium", colors)?.className).toContain("violet");
    expect(toneFromSpec("#4285F4").style?.color).toBe("#4285F4");
    expect(assignTagTones(["google"], colors).google.style?.color).toBe("#4285F4");
    const unknown = assignTagTones(["acme-unknown"], {});
    expect(unknown["acme-unknown"].className).toBeTruthy();
  });
});
