import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
vi.mock("./KiwiApp", () => ({
  KiwiApp: (props: { source: string; meta?: string; pagePath?: string }) => (
    <pre data-app-meta={props.meta} data-app-page={props.pagePath}>{props.source}</pre>
  ),
}));

import { FenceBlock, fenceLang, fenceMeta, parseLineRanges, resolveFence } from "./FenceBlock";

describe("fenceLang", () => {
  it("reads the language out of react-markdown's class name", () => {
    expect(fenceLang("language-array")).toBe("array");
    expect(fenceLang("language-widget:live")).toBe("widget:live");
    expect(fenceLang("language-kiwi-steps")).toBe("kiwi-steps");
  });

  it("returns undefined for inline code with no language", () => {
    expect(fenceLang(undefined)).toBeUndefined();
    expect(fenceLang("")).toBeUndefined();
    expect(fenceLang("some-other-class")).toBeUndefined();
  });
});

describe("fenceMeta", () => {
  it("prefers data.meta, falling back to the rehype-copied property", () => {
    expect(fenceMeta({ data: { meta: 'id=a' } })).toBe("id=a");
    expect(fenceMeta({ properties: { metastring: "id=b" } })).toBe("id=b");
    expect(fenceMeta(undefined)).toBe("");
  });
});

describe("parseLineRanges", () => {
  it("expands singles and ranges", () => {
    expect([...parseLineRanges("1,3-5,8")]).toEqual([1, 3, 4, 5, 8]);
  });

  it("ignores junk rather than throwing", () => {
    expect([...parseLineRanges("1, ,x")]).toEqual([1]);
  });
});

describe("resolveFence", () => {
  const kind = (lang: string | undefined, raw: string, opts = {}) => resolveFence(lang, raw, opts).kind;

  it("dispatches kiwi-data before the single-line guard", () => {
    expect(kind("kiwi-data", "name: one")).toBe("data");
  });

  it("dispatches kiwi-app and kiwi-diff only past the single-line guard", () => {
    expect(kind("kiwi-app", "one line")).toBe("inline");
    expect(kind("kiwi-diff", "one line")).toBe("inline");
    expect(kind("kiwi-app", "a\nb")).toBe("app");
    expect(kind("kiwi-diff", "a\nb")).toBe("diff");
  });

  it("keeps inline code inline", () => {
    expect(kind(undefined, "x = 1")).toBe("inline");
  });

  it("leaves a ```tree directory listing to Shiki", () => {
    expect(kind("tree", "src/\n  lib/\n  widgets/\n")).toBe("code");
    expect(kind("Tree", "src/\n  lib/\n")).toBe("code");
  });

  it("leaves plain-text aliases to Shiki", () => {
    expect(kind("heap", "the heap grows\nupward\n")).toBe("code");
    expect(kind("steps", "1. do this\n2. then that\n")).toBe("code");
  });

  it("claims a bare tag whose body carries a marker key", () => {
    expect(kind("tree", "root:\n  value: 1\n")).toBe("typed");
    expect(kind("grid", "values:\n  - [1, 2]\n")).toBe("typed");
  });

  it("always claims a strict spelling, so a broken body errors loudly", () => {
    expect(kind("kiwi-array", "garbage\nmore garbage\n")).toBe("typed");
    expect(kind("kiwi-steps", "diagram: x\nsteps: [a]\n")).toBe("typed");
  });

  it("turns off every non-strict tag when typed fences are disabled", () => {
    const off = { typedFences: false };
    expect(kind("array", "values: [1]\nx: 2\n", off)).toBe("code");
    expect(kind("grid", "values:\n  - [1]\n", off)).toBe("code");
    expect(kind("kiwi-array", "values: [1]\nx: 2\n", off)).toBe("typed");
  });

  it("limits non-strict tags to the allow-list", () => {
    const only = { typedFenceTags: ["array"] };
    expect(kind("array", "values: [1]\nx: 2\n", only)).toBe("typed");
    expect(kind("tree", "root:\n  value: 1\n", only)).toBe("code");
    expect(kind("kiwi-tree", "root:\n  value: 1\n", only)).toBe("typed");
  });

  it("routes widget: tags to KiwiWidget", () => {
    expect(kind("widget:array", "values: [1]")).toBe("widget");
    expect(kind("widget:code", "print(1)")).toBe("code-runner");
  });
});

describe("FenceBlock", () => {
  const render = (lang: string | undefined, body: string, props = {}) =>
    renderToStaticMarkup(
      <FenceBlock className={lang ? `language-${lang}` : undefined} {...props}>
        {body}
      </FenceBlock>,
    );

  it("renders inline code as <code>", () => {
    expect(render(undefined, "x = 1")).toBe("<code>x = 1</code>");
  });

  it("shows a kiwi-array error with the source", () => {
    const html = render("kiwi-array", "garbage\nmore garbage\n");
    expect(html).toContain("fence could not be rendered");
    expect(html).toContain("more garbage");
  });

  it("still renders kiwi-array when bare typed fences are off", () => {
    const html = render("kiwi-array", "values: [1, 2]\n", { typedFences: false });
    expect(html).toContain("kiwi-fence");
    expect(render("array", "values: [1, 2]\n", { typedFences: false })).not.toContain("kiwi-fence");
  });
});

describe("FenceBlock kiwi-app", () => {
  async function renderAll(el: React.ReactElement): Promise<string> {
    const { prelude } = await prerenderToNodeStream(el);
    let out = "";
    for await (const chunk of prelude) out += chunk;
    return out;
  }

  it("hands the meta to KiwiApp unchanged", async () => {
    const meta = 'id=x width=wide caption="Two leases, one lock"';
    const html = await renderAll(
      <FenceBlock className="language-kiwi-app" node={{ data: { meta } }} pagePath="guides/q.md">
        {"<p>a</p>\n<p>b</p>\n"}
      </FenceBlock>,
    );
    expect(html).toContain(`data-app-meta="id=x width=wide caption=&quot;Two leases, one lock&quot;"`);
    expect(html).toContain('data-app-page="guides/q.md"');
  });

  it("routes a bodiless kiwi-app with src= to the app, not inline code", () => {
    expect(resolveFence("kiwi-app", "", { meta: "src=apps/a.html" }).kind).toBe("app");
    expect(resolveFence("kiwi-app", "", {}).kind).toBe("inline");
  });
});
