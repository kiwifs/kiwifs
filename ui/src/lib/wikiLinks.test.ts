import { describe, expect, it } from "vitest";
import { buildResolver } from "./wikiLinks";
import type { TreeEntry } from "@kw/lib/api";

// Build a flat tree (single root dir + file leaves) from a list of paths.
function treeFromPaths(paths: string[]): TreeEntry {
  return {
    path: "",
    name: "",
    isDir: true,
    children: paths.map((p) => ({
      path: p,
      name: p.slice(p.lastIndexOf("/") + 1),
      isDir: false,
    })),
  };
}

// Mirrors the fixture used by the Go links resolver tests so the two
// implementations stay in lockstep. If you change a case here, change it in
// internal/links/resolve_link_test.go too.
const PATHS = [
  "02-arrays-and-strings/_index.md",
  "02-arrays-and-strings/01-linear-scan/summary-ranges.md",
  "02-arrays-and-strings/01-linear-scan/merge-intervals.md",
  "02-arrays-and-strings/02-two-pointers/_index.md",
  "02-arrays-and-strings/02-two-pointers/reverse-string.md",
  "02-arrays-and-strings/02-two-pointers/valid-palindrome.md",
  "17-intervals/merge-intervals.md",
  "00-foundations/index.md",
  "assets/diagram.png",
];

describe("buildResolver — directory-aware wiki-link resolution", () => {
  const resolve = buildResolver(treeFromPaths(PATHS));

  const from = "02-arrays-and-strings/_index.md";

  it("resolves a chapter-relative partial path against the source dir", () => {
    // The exact LeetLlama roadmap pattern that was rendering as an empty page.
    expect(resolve("02-two-pointers/reverse-string", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/reverse-string.md",
    );
    expect(resolve("02-two-pointers/valid-palindrome", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/valid-palindrome.md",
    );
  });

  it("resolves an explicit ../ relative path", () => {
    expect(
      resolve("../01-linear-scan/summary-ranges", "02-arrays-and-strings/02-two-pointers/_index.md"),
    ).toBe("02-arrays-and-strings/01-linear-scan/summary-ranges.md");
  });

  it("resolves an explicit ./ sibling path", () => {
    expect(
      resolve("./reverse-string", "02-arrays-and-strings/02-two-pointers/_index.md"),
    ).toBe("02-arrays-and-strings/02-two-pointers/reverse-string.md");
  });

  it("resolves a vault-absolute path (leading slash) from root", () => {
    expect(resolve("/02-arrays-and-strings/02-two-pointers/reverse-string", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/reverse-string.md",
    );
  });

  it("resolves a full absolute path with or without .md", () => {
    expect(resolve("02-arrays-and-strings/02-two-pointers/reverse-string", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/reverse-string.md",
    );
    expect(resolve("02-arrays-and-strings/02-two-pointers/reverse-string.md", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/reverse-string.md",
    );
  });

  it("resolves a unique bare stem regardless of source dir", () => {
    expect(resolve("valid-palindrome", "00-foundations/index.md")).toBe(
      "02-arrays-and-strings/02-two-pointers/valid-palindrome.md",
    );
  });

  it("is case- and separator-insensitive", () => {
    expect(resolve("Reverse String", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/reverse-string.md",
    );
  });

  it("does NOT stem-prefix fuzzy match", () => {
    // 'reverse' must not silently resolve to reverse-string.
    expect(resolve("reverse", from)).toBeNull();
  });

  it("prefers the same-directory file when a bare stem is ambiguous", () => {
    // merge-intervals exists in both 01-linear-scan and 17-intervals.
    expect(resolve("merge-intervals", "02-arrays-and-strings/01-linear-scan/summary-ranges.md")).toBe(
      "02-arrays-and-strings/01-linear-scan/merge-intervals.md",
    );
    expect(resolve("merge-intervals", "17-intervals/_index.md")).toBe(
      "17-intervals/merge-intervals.md",
    );
  });

  it("breaks ambiguity deterministically (shortest path) with no dir hint", () => {
    // From an unrelated dir, neither candidate is in the source dir → shortest.
    expect(resolve("merge-intervals", "00-foundations/index.md")).toBe(
      "17-intervals/merge-intervals.md",
    );
  });

  it("resolves non-markdown embeds by exact path", () => {
    expect(resolve("assets/diagram.png", from)).toBe("assets/diagram.png");
  });

  it("returns null for unknown targets", () => {
    expect(resolve("does-not-exist", from)).toBeNull();
    expect(resolve("02-two-pointers/nope", from)).toBeNull();
  });

  it("appends a slugged heading anchor when present", () => {
    expect(resolve("reverse-string#Two Pointer Trick", from)).toBe(
      "02-arrays-and-strings/02-two-pointers/reverse-string.md#two-pointer-trick",
    );
  });

  it("handles same-page heading links", () => {
    expect(resolve("#Complexity", from)).toBe("#complexity");
  });
});
