import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editorModeFromView,
  joinVisualSource,
  loadEditorModePreference,
  loadVimPreference,
  saveEditorModePreference,
  saveVimPreference,
  sourceToVisualParts,
  splitVisualSource,
  viewFromEditorMode,
  wikiPagesFromTree,
} from "./editorMode";
import type { TreeEntry } from "./api";

describe("editorMode", () => {
  it("sourceToVisualParts splits frontmatter and strips duplicate title H1", () => {
    const md = "---\ntitle: My Page\n---\n\n# My Page\n\nContent here.\n";
    expect(sourceToVisualParts(md)).toEqual({
      fmText: "title: My Page",
      body: "\nContent here.\n",
    });
  });

  it("sourceToVisualParts keeps body when no matching title H1", () => {
    const md = "# Heading\n\nParagraph.\n";
    expect(sourceToVisualParts(md)).toEqual({
      fmText: "",
      body: md,
    });
  });

  it("wikiPagesFromTree maps markdown paths to wiki completion entries", () => {
    const tree: TreeEntry = {
      name: "root",
      path: "",
      isDir: true,
      children: [
        { name: "a.md", path: "notes/a.md", isDir: false },
        { name: "b.txt", path: "notes/b.txt", isDir: false },
      ],
    };
    expect(wikiPagesFromTree(tree)).toEqual([
      { path: "notes/a.md", title: "A" },
    ]);
  });
});

describe("visual source round trip", () => {
  it("keeps the frontmatter and hidden title H1 byte for byte when the frontmatter is unchanged", () => {
    const md = "---\r\ntitle: 'My Page'\r\ntags: [a,  b]\r\n---\r\n\r\n# My Page\r\n\r\nBody.\r\n";
    const source = splitVisualSource(md);
    expect(source.body).toBe("\r\nBody.\r\n");
    expect(source.titleHeading).toBe("# My Page\r\n");
    expect(joinVisualSource(source, source.fmText, source.body).markdown).toBe(md);
    expect(joinVisualSource(source, source.fmText, "\r\nEdited.\r\n").markdown)
      .toBe(md.replace("Body.", "Edited."));
  });

  it("renames the hidden H1 with the title instead of dropping it", () => {
    const md = "---\ntitle: Old\n---\n\n# Old\n\nBody.\n";
    const source = splitVisualSource(md);
    const next = joinVisualSource(source, "title: New", source.body);
    expect(next.markdown).toBe("---\ntitle: New\n---\n\n# New\n\nBody.\n");
    expect(splitVisualSource(next.markdown).body).toBe(source.body);
  });

  it("keeps a heading right under the frontmatter there when the title changes", () => {
    const source = splitVisualSource("---\ntitle: Old\n---\n# Old\n\nBody.\n");
    expect(joinVisualSource(source, "title: New", source.body).markdown).toBe("---\ntitle: New\n---\n# New\n\nBody.\n");
  });

  it("keeps CRLF and a BOM when the frontmatter is rewritten", () => {
    const md = "\uFEFF---\r\ntitle: A\r\n---\r\n\r\nBody.\r\n";
    const source = splitVisualSource(md);
    expect(joinVisualSource(source, "title: B", source.body).markdown)
      .toBe("\uFEFF---\r\ntitle: B\r\n---\r\n\r\nBody.\r\n");
  });

  it("finds the title without Node's Buffer, as in the browser", () => {
    const buffer = globalThis.Buffer;
    try {
      // @ts-expect-error browsers have no Buffer
      delete globalThis.Buffer;
      const source = splitVisualSource("---\ntitle: Live Test\n---\n# Live Test\n\nBody.\n");
      expect(source.titleHeading).toBe("# Live Test\n");
      expect(joinVisualSource(source, "title: Renamed", source.body).markdown).toContain("# Renamed\n");
    } finally {
      globalThis.Buffer = buffer;
    }
  });

  it("adds and removes a frontmatter block", () => {
    const plain = splitVisualSource("Body.\n");
    expect(joinVisualSource(plain, "title: T", plain.body).markdown).toBe("---\ntitle: T\n---\n\nBody.\n");
    const withFm = splitVisualSource("---\ntags: [x]\n---\n\nBody.\n");
    expect(joinVisualSource(withFm, "", withFm.body).markdown).toBe("Body.\n");
  });
});

describe("editor mode preference", () => {
  const store = new Map<string, string>();
  const stubStorage = () =>
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  const stubPointer = (coarse: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: coarse && q === "(pointer: coarse)" }));

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("defaults to live preview on touch devices and visual elsewhere", () => {
    stubStorage();
    stubPointer(true);
    expect(loadEditorModePreference()).toBe("live");
    stubPointer(false);
    expect(loadEditorModePreference()).toBe("visual");
  });

  it("keeps a stored choice, live included, over the device default", () => {
    stubStorage();
    stubPointer(true);
    saveEditorModePreference("source");
    expect(loadEditorModePreference()).toBe("source");
    stubPointer(false);
    saveEditorModePreference("live");
    expect(loadEditorModePreference()).toBe("live");
  });

  it("maps between modes and default_view values", () => {
    expect(editorModeFromView("editor")).toBe("visual");
    expect(editorModeFromView("live")).toBe("live");
    expect(viewFromEditorMode("visual")).toBe("editor");
    expect(viewFromEditorMode("source")).toBe("source");
  });

  it("remembers the Vim toggle", () => {
    stubStorage();
    expect(loadVimPreference()).toBe(false);
    saveVimPreference(true);
    expect(loadVimPreference()).toBe(true);
  });
});
