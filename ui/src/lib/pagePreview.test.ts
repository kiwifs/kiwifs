import { afterEach, describe, expect, it, vi } from "vitest";
import { setBaseOverride, type PeekResponse } from "./api";
import { invalidatePagePreview, loadPagePreview, stripMarkdown, toPagePreview, truncateSnippet } from "./pagePreview";

function peek(overrides: Partial<PeekResponse> = {}): PeekResponse {
  return {
    path: "notes/alpha.md",
    title: "Alpha heading",
    frontmatter: null,
    snippet: "",
    links_out: [],
    links_in: [],
    word_count: 0,
    headings: [],
    ...overrides,
  };
}

describe("stripMarkdown", () => {
  it("keeps only the readable text", () => {
    expect(
      stripMarkdown("See **bold**, _em_, `code`, [docs](https://x.y) and [[notes/b|Bee]] or [[notes/c]] <b>now</b>"),
    ).toBe("See bold, em, code, docs and Bee or notes/c now");
    expect(stripMarkdown("> quoted\n- item one\n1. item two")).toBe("quoted item one item two");
  });

  it("leaves snake_case and arithmetic alone", () => {
    expect(stripMarkdown("use my_var_name and 2 * 3 * 4")).toBe("use my_var_name and 2 * 3 * 4");
    expect(stripMarkdown("if a < b and c > d")).toBe("if a < b and c > d");
  });
});

describe("truncateSnippet", () => {
  it("cuts on a word boundary near the limit", () => {
    const text = "word ".repeat(60).trim();
    const out = truncateSnippet(text);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("keeps the ellipsis the server already added", () => {
    expect(truncateSnippet("short and cut…")).toBe("short and cut…");
    expect(truncateSnippet("short and whole")).toBe("short and whole");
  });
});

describe("toPagePreview", () => {
  it("prefers the frontmatter title and lists tags", () => {
    const p = toPagePreview(
      peek({ frontmatter: { title: "Alpha", tags: ["one", "two"] }, snippet: "Hello **there**" }),
    );
    expect(p).toEqual({ path: "notes/alpha.md", title: "Alpha", snippet: "Hello there", tags: ["one", "two"] });
  });

  it("falls back to the heading the server picked, then the file name", () => {
    expect(toPagePreview(peek()).title).toBe("Alpha heading");
    expect(toPagePreview(peek({ title: "alpha.md" })).title).toBe("alpha");
    expect(toPagePreview(peek({ frontmatter: { tags: "solo" } })).tags).toEqual(["solo"]);
  });
});

describe("loadPagePreview", () => {
  afterEach(() => {
    invalidatePagePreview();
    setBaseOverride(null);
    vi.unstubAllGlobals();
  });

  it("fetches /peek once per target, even for concurrent hovers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(peek({ frontmatter: { title: "Alpha" } })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setBaseOverride("/api/kiwi");

    const [a, b] = await Promise.all([loadPagePreview("notes/alpha.md"), loadPagePreview("notes/alpha.md")]);
    await loadPagePreview("notes/alpha.md");

    expect(a?.title).toBe("Alpha");
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/kiwi/peek?path=notes%2Falpha.md", expect.anything());

    invalidatePagePreview();
    await loadPagePreview("notes/alpha.md");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves to null for a page that does not exist", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadPagePreview("gone.md")).toBeNull();
    expect(await loadPagePreview("gone.md")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500, statusText: "Server Error" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(peek()), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPagePreview("notes/alpha.md")).rejects.toThrow();
    expect((await loadPagePreview("notes/alpha.md"))?.title).toBe("Alpha heading");
  });
});
