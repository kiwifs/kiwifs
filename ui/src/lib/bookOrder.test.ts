import { describe, expect, it } from "vitest";
import type { TreeEntry } from "./api";
import {
  applyPageMeta,
  bookManifestCandidates,
  bookPageTitle,
  fallbackBookOrder,
  navForPath,
  pageDescriptionFromMarkdown,
  pageTitleFromMarkdown,
  parseBookManifest,
} from "./bookOrder";

describe("bookPageTitle", () => {
  it("uses the parent folder for _index and strips a leading number", () => {
    expect(bookPageTitle("00-foundations/_index.md")).toBe("Foundations");
    expect(bookPageTitle("01-core-concepts/cap-and-consistency.md")).toBe("Cap And Consistency");
  });
});

describe("parseBookManifest", () => {
  it("resolves parts against the manifest directory", () => {
    const order = parseBookManifest(
      "title: Spine\nparts:\n  - _index.md\n  - how-to-prepare.md\n",
      "00-foundations",
    );
    expect(order?.title).toBe("Spine");
    expect(order?.pages.map((p) => p.path)).toEqual([
      "00-foundations/_index.md",
      "00-foundations/how-to-prepare.md",
    ]);
  });

  it("returns null for empty parts", () => {
    expect(parseBookManifest("title: x\n")).toBeNull();
  });
});

describe("bookManifestCandidates", () => {
  it("walks from the page directory to the vault root", () => {
    expect(bookManifestCandidates("00-foundations/how-to-prepare.md")).toEqual([
      "00-foundations/_book.yaml",
      "00-foundations/_book.yml",
      "_book.yaml",
      "_book.yml",
    ]);
  });
});

describe("navForPath", () => {
  it("points at neighbours", () => {
    const order = parseBookManifest("parts: [a.md, b.md, c.md]")!;
    const nav = navForPath(order, "b.md")!;
    expect(nav.prev?.path).toBe("a.md");
    expect(nav.next?.path).toBe("c.md");
    expect(nav.index).toBe(1);
    expect(nav.total).toBe(3);
  });
});

describe("fallbackBookOrder", () => {
  const tree: TreeEntry = {
    path: "",
    name: "",
    isDir: true,
    children: [
      { path: "ch/_index.md", name: "_index.md", isDir: false },
      { path: "ch/b.md", name: "b.md", isDir: false },
      { path: "ch/a.md", name: "a.md", isDir: false },
    ],
  };

  it("lists siblings with _index first", () => {
    const order = fallbackBookOrder(tree, "ch/a.md")!;
    expect(order.pages.map((p) => p.path)).toEqual(["ch/_index.md", "ch/a.md", "ch/b.md"]);
  });
});

describe("pageTitleFromMarkdown", () => {
  it("prefers the frontmatter title over a title-cased filename", () => {
    expect(pageTitleFromMarkdown("---\ntitle: CAP and Consistency\n---\n\n# CAP\n")).toBe(
      "CAP and Consistency",
    );
  });

  it("falls back to the first heading", () => {
    expect(pageTitleFromMarkdown("---\ntype: concept\n---\n\n# Realtime Updates\n")).toBe(
      "Realtime Updates",
    );
  });
});

describe("pageDescriptionFromMarkdown", () => {
  it("reads an explicit description", () => {
    expect(pageDescriptionFromMarkdown("---\ndescription: Install in 60 seconds.\n---\n\n# Quickstart\n")).toBe(
      "Install in 60 seconds.",
    );
  });

  it("does not fall back to body prose", () => {
    expect(pageDescriptionFromMarkdown("---\ntitle: Case Studies\n---\n\nOne page per prompt.\n")).toBe("");
  });
});

describe("applyPageMeta", () => {
  it("fills title and description from frontmatter", () => {
    const order = parseBookManifest("parts: [a.md]")!;
    const next = applyPageMeta(order, { "a.md": { title: "Quickstart", description: "Install in 60 seconds." } });
    expect(next.pages[0]).toMatchObject({ title: "Quickstart", description: "Install in 60 seconds." });
  });
});
