// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KiwiEditor } from "./KiwiEditor";

const harness = vi.hoisted(() => ({
  editor: {
    document: [] as { text: string }[],
    tryParseMarkdownToBlocks: vi.fn(async (body: string) =>
      body.split("\n").filter(Boolean).map((text) => ({ text }))),
    replaceBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(async (blocks: { text: string }[]) =>
      blocks.map((block) => block.text).filter(Boolean).join("\n\n")),
  },
  onChange: () => {},
  sourceProps: null as null | Record<string, unknown>,
  fileEvent: null as null | ((event: { op: string; path?: string; etag?: string }) => Promise<void> | void),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("date-fns", () => ({ formatDistanceToNow: () => "just now" }));
vi.mock("@blocknote/core", () => ({
  filterSuggestionItems: vi.fn(),
  createExtension: (factory: unknown) => factory,
}));
vi.mock("@kw/lib/blockNoteMarkdown", () => ({
  parseMarkdownToBlocks: (editor: typeof harness.editor, markdown: string) =>
    editor.tryParseMarkdownToBlocks(markdown),
}));
vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: () => harness.editor,
  FormattingToolbarController: () => null,
  SuggestionMenuController: () => null,
}));
vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: ({ onChange }: { onChange: () => void }) => {
    harness.onChange = onChange;
    return <div aria-label="Mock visual editor" />;
  },
}));
vi.mock("@kw/lib/api", () => ({
  api: {
    readFile: harness.readFile,
    writeFile: harness.writeFile,
    versions: async () => ({ versions: [] }),
  },
}));
vi.mock("@kw/fences", () => ({ allFences: () => [] }));
vi.mock("@kw/lib/useSSE", () => ({
  useSSE: (handler: typeof harness.fileEvent) => {
    harness.fileEvent = handler;
  },
  eventTouchesPath: (event: { path?: string }, path: string) => event.path === path,
}));
vi.mock("../hooks/useEditorSlashCommands", () => ({ useEditorSlashCommands: () => [] }));
vi.mock("@kw/lib/editorSlashCommands", () => ({
  blockNoteSlashItems: () => [],
  loadSlashCommandTemplate: vi.fn(),
}));
vi.mock("./ExcalidrawMarkdownPreview", () => ({
  isExcalidrawMarkdown: () => false,
  ExcalidrawMarkdownEditor: () => null,
}));
vi.mock("./editor/FencePreview", () => ({ FencePreview: () => null }));
vi.mock("./editor/markdownSlashCommands", () => ({ splitFenceExample: vi.fn() }));
vi.mock("./editor/MarkdownSourceEditor", () => ({
  MarkdownSourceEditor: (props: { value: string; onChange: (text: string) => void; livePreview?: boolean }) => {
    harness.sourceProps = props;
    return (
      <textarea
        aria-label="Markdown source editor"
        data-live={props.livePreview ? "true" : undefined}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
let unmounted: boolean;
let onSaved: ReturnType<typeof vi.fn<(path: string) => void>>;
let saveRef: { current: { save: () => Promise<void> } | null };

async function mount(content = "", path = "note.md", etag = '\"initial\"', onNavigate?: (path: string) => void) {
  harness.readFile.mockResolvedValue({ content, etag });
  await act(async () => {
    root.render(<KiwiEditor path={path} onClose={() => {}} onSaved={onSaved} saveRef={saveRef} onNavigate={onNavigate} />);
  });
}

async function unmount() {
  if (unmounted) return;
  await act(async () => { root.unmount(); });
  unmounted = true;
}

async function editVisual(...paragraphs: string[]) {
  await act(async () => {
    harness.editor.document = paragraphs.map((text) => ({ text }));
    harness.onChange();
  });
}

async function advance(ms = 2000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?? [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => { button!.click(); });
}

async function input(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  expect(element, label).toBeTruthy();
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.resetAllMocks();
  localStorage.clear();
  harness.editor.document = [];
  harness.editor.replaceBlocks.mockImplementation((_previous, blocks) => { harness.editor.document = blocks; });
  harness.writeFile.mockResolvedValue({ etag: "saved" });
  onSaved = vi.fn();
  saveRef = { current: null };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  unmounted = false;
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.useRealTimers();
});

describe("editor save synchronization", () => {
  it("loads Markdown once, preserves live blocks after autosave, and keeps newer edits dirty through the saved flash", async () => {
    await mount();
    expect(harness.editor.tryParseMarkdownToBlocks).toHaveBeenCalledTimes(1);
    await editVisual("test", "", "/");
    const liveDocument = harness.editor.document;
    await advance();
    expect(harness.writeFile).toHaveBeenCalledTimes(1);
    expect(harness.editor.document).toBe(liveDocument);
    expect(harness.editor.document.map((block) => block.text)).toEqual(["test", "", "/"]);
    expect(harness.editor.tryParseMarkdownToBlocks).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    await advance(1000);
    await editVisual("second");
    await advance(1000);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Unsaved");
  });

  it("keeps edits and frontmatter made during a save, then saves them with the new ETag", async () => {
    const response = deferred<{ etag: string }>();
    harness.writeFile.mockReturnValueOnce(response.promise);
    await mount("---\ntitle: Original\n---\nold");
    await editVisual("first");
    await advance();
    await editVisual("second", "", "/");
    await input("Frontmatter YAML", "title: Newer\ntags: [draft]");
    const liveDocument = harness.editor.document;
    // The next debounce expires before the first request finishes.
    await advance();
    await act(async () => { response.resolve({ etag: "first" }); });
    expect(harness.editor.document).toBe(liveDocument);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Frontmatter YAML"]')!.value).toContain("title: Newer");
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Unsaved");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledTimes(2);
    expect(harness.writeFile.mock.calls[1]).toEqual([
      "note.md", expect.stringContaining("title: Newer\ntags: [draft]"), '"first"',
    ]);
    expect(harness.writeFile.mock.calls[1][1]).toContain("second");
    expect(harness.editor.document).toBe(liveDocument);
  });

  it("keeps newer source edits while a save is in flight", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    const response = deferred<{ etag: string }>();
    harness.writeFile.mockReturnValueOnce(response.promise);
    await mount("original");
    await input("Markdown source editor", "first");
    await advance();
    await input("Markdown source editor", "second");
    await act(async () => { response.resolve({ etag: "first" }); });
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source editor"]')!.value).toBe("second");
    await advance();
    expect(harness.writeFile.mock.calls[1]).toEqual(["note.md", "second", '"first"']);
  });

  it.each([
    ["an in-flight autosave", "second"],
    ["its own request", 'title: "New title"'],
  ])(
    "Save & Close persists newer edits during %s before closing",
    async (saveKind, expectedContent) => {
      const response = deferred<{ etag: string }>();
      harness.writeFile.mockReturnValueOnce(response.promise);
      await mount();
      await editVisual("first");
      if (saveKind === "an in-flight autosave") {
        await advance();
        await editVisual("second");
      }
      let closing!: Promise<void>;
      await act(async () => { closing = saveRef.current!.save(); });
      if (saveKind === "its own request") await input("Page title", "New title");
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () => { response.resolve({ etag: "first" }); await closing; });
      expect(harness.writeFile).toHaveBeenCalledTimes(2);
      expect(harness.writeFile.mock.calls[1][1]).toContain(expectedContent);
      expect(onSaved).toHaveBeenCalledExactlyOnceWith("note.md");
    },
  );

  it.each(["autosave", "waiting Save & Close"])(
    "does not schedule or write newer edits after unmount during %s",
    async (saveKind) => {
      const response = deferred<{ etag: string }>();
      harness.writeFile.mockReturnValueOnce(response.promise);
      await mount();
      await editVisual("first");
      let closing: Promise<void> | undefined;
      await advance();
      await editVisual("newer");
      if (saveKind === "waiting Save & Close") {
        await act(async () => { closing = saveRef.current!.save(); });
      }
      await advance();
      expect(harness.writeFile).toHaveBeenCalledTimes(1);
      await unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { response.resolve({ etag: "first" }); await closing; });
      expect(vi.getTimerCount()).toBe(0);
      await advance(5000);
      expect(harness.writeFile).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it("does not close or start a saved-status timer after unmount during Save & Close", async () => {
    const response = deferred<{ etag: string }>();
    harness.writeFile.mockReturnValueOnce(response.promise);
    await mount();
    await editVisual("first");
    let closing!: Promise<void>;
    await act(async () => { closing = saveRef.current!.save(); });
    await unmount();
    await act(async () => { response.resolve({ etag: "first" }); await closing; });
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.writeFile).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not start a write if serialization finishes after unmount", async () => {
    const markdown = deferred<string>();
    await mount();
    // After mount: loading serializes once to record the merge baseline.
    harness.editor.blocksToMarkdownLossy.mockReturnValueOnce(markdown.promise);
    await editVisual("first");
    let closing!: Promise<void>;
    await act(async () => { closing = saveRef.current!.save(); });
    expect(harness.writeFile).not.toHaveBeenCalled();
    await unmount();
    await act(async () => { markdown.resolve("first"); await closing; });
    expect(harness.writeFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])(
    "ignores a stale save %s after the path changes without remounting",
    async (outcome) => {
      const response = deferred<{ etag: string }>();
      harness.writeFile.mockReturnValueOnce(response.promise);
      await mount();
      await editVisual("old document");
      await advance();
      let closing!: Promise<void>;
      await act(async () => { closing = saveRef.current!.save(); });
      await mount("new document", "new.md", '\"new-initial\"');
      await editVisual("new edit");
      await act(async () => {
        if (outcome === "success") response.resolve({ etag: "stale" });
        else response.reject(new Error("stale failure"));
        await closing;
      });
      expect(container.querySelector('[role="status"]')!.textContent).toContain("Unsaved");
      expect(onSaved).not.toHaveBeenCalled();
      await advance();
      expect(harness.writeFile).toHaveBeenCalledTimes(2);
      expect(harness.writeFile.mock.calls[1]).toEqual(["new.md", "new edit", '\"new-initial\"']);
    },
  );

  it("does not clear the new document's saving state or in-flight save when an old response arrives", async () => {
    const oldResponse = deferred<{ etag: string }>();
    const newResponse = deferred<{ etag: string }>();
    harness.writeFile.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    await mount();
    await editVisual("old edit");
    await advance();
    await mount("new document", "new.md", '\"new-initial\"');
    await editVisual("new first edit");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledTimes(2);
    await act(async () => { oldResponse.resolve({ etag: "stale" }); });
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Saving");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save and close editor"]')!.disabled).toBe(true);
    await editVisual("new second edit");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledTimes(2);
    await act(async () => { newResponse.resolve({ etag: "new-first" }); });
    await advance();
    expect(harness.writeFile.mock.calls[2]).toEqual(["new.md", "new second edit", '\"new-first\"']);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not switch modes with a stale snapshot if the user edits during Save & switch", async () => {
    const response = deferred<{ etag: string }>();
    harness.writeFile.mockReturnValueOnce(response.promise);
    await mount();
    await editVisual("first");
    await click("Switch to source editor mode");
    await click("Save & switch");
    await input("Frontmatter YAML", "title: Newer");
    await editVisual("second");
    const liveDocument = harness.editor.document;
    await act(async () => { response.resolve({ etag: "first" }); });
    expect(container.querySelector('[aria-label="Mock visual editor"]')).not.toBeNull();
    expect(harness.editor.document).toBe(liveDocument);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Unsaved");
    await advance();
    expect(harness.writeFile.mock.calls[1][1]).toContain("title: Newer");
    expect(harness.writeFile.mock.calls[1][1]).toContain("second");
  });

  it("uses the saved snapshot when intentionally discarding newer visual edits", async () => {
    await mount();
    await editVisual("saved body");
    await input("Frontmatter YAML", "title: Saved");
    await advance();
    await editVisual("discarded body");
    await input("Frontmatter YAML", "title: Discarded");
    await click("Switch to source editor mode");
    await click("Switch without saving");
    const source = container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source editor"]')!.value;
    expect(source).toContain("title: Saved");
    expect(source).toContain("saved body");
    expect(source).not.toContain("Discarded");
    expect(source).not.toContain("discarded body");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledTimes(1);
  });

  it("writes only the edited block, keeping the rest of the file and the title heading as they were", async () => {
    await mount("---\ntitle: T\n---\n\n# T\n\n- a\n- b\n\nPara\n");
    await editVisual("- a", "- b", "Para edited");
    await advance();
    expect(harness.writeFile.mock.calls[0][1]).toBe("---\ntitle: T\n---\n\n# T\n\n- a\n- b\n\nPara edited\n");
    // The next save merges onto what is now on disk.
    await editVisual("- a", "- b changed", "Para edited");
    await advance();
    expect(harness.writeFile.mock.calls[1][1]).toBe("---\ntitle: T\n---\n\n# T\n\n- a\n- b changed\n\nPara edited\n");
  });

  it("still parses source edits when intentionally switching to Visual", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("original");
    await input("Markdown source editor", "---\ntitle: New\n---\nchanged");
    await click("Switch to visual editor mode");
    await click("Save & switch");
    expect(harness.editor.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith("changed");
    expect(harness.editor.document).toEqual([{ text: "changed" }]);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Page title"]')!.value).toBe("New");
    await click("Switch to source editor mode");
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source editor"]')!.value).toContain("changed");
  });
});

describe("live preview mode", () => {
  const sourceBox = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source editor"]')!;

  it("switches between live and source with no dialog, keeping unsaved text", async () => {
    localStorage.setItem("kiwifs-editor-mode", "live");
    await mount("# Page\n\nBody\n");
    expect(sourceBox().dataset.live).toBe("true");
    await input("Markdown source editor", "# Page\n\nEdited\n");
    await click("Switch to source editor mode");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sourceBox().dataset.live).toBeUndefined();
    expect(sourceBox().value).toBe("# Page\n\nEdited\n");
    await click("Switch to live preview editor mode");
    expect(sourceBox().value).toBe("# Page\n\nEdited\n");
    expect(localStorage.getItem("kiwifs-editor-mode")).toBe("live");
    await advance();
    expect(harness.writeFile.mock.calls[0][1]).toBe("# Page\n\nEdited\n");
  });

  it("saves the loaded bytes untouched", async () => {
    localStorage.setItem("kiwifs-editor-mode", "live");
    const content = "---\r\ntitle: T\r\n---\r\n\r\n# T\r\n\r\n- a\r\n* b\r\n";
    await mount(content);
    await input("Page title", "T");
    await act(async () => { await saveRef.current!.save(); });
    expect(harness.writeFile.mock.calls[0][1]).toBe(content);
  });

  it("goes through the save dialog when switching to visual with unsaved text", async () => {
    localStorage.setItem("kiwifs-editor-mode", "live");
    await mount("Body\n");
    await input("Markdown source editor", "Edited\n");
    await click("Switch to visual editor mode");
    await click("Save & switch");
    expect(harness.writeFile.mock.calls[0][1]).toBe("Edited\n");
    expect(container.querySelector('[aria-label="Mock visual editor"]')).not.toBeNull();
  });

  it("saves before following a wiki link out of the editor", async () => {
    localStorage.setItem("kiwifs-editor-mode", "live");
    const onNavigate = vi.fn();
    await mount("Body\n", "note.md", '"initial"', onNavigate);
    await input("Markdown source editor", "Body [[other]]\n");
    const navigate = harness.sourceProps!.onNavigate as (path: string) => Promise<void>;
    await act(async () => { await navigate("other.md"); });
    expect(harness.writeFile).toHaveBeenCalledWith("note.md", "Body [[other]]\n", '"initial"');
    expect(onNavigate).toHaveBeenCalledWith("other.md");
  });

  it("toggles Vim keybindings and remembers the choice", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("Body\n");
    expect(harness.sourceProps!.vim).toBe(false);
    await click("Vim keybindings");
    expect(harness.sourceProps!.vim).toBe(true);
    expect(localStorage.getItem("kiwifs-editor-vim")).toBe("on");
  });
});

describe("changes made outside the editor", () => {
  const sourceBox = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source editor"]')!;
  const banner = () => container.querySelector('[role="alert"]');
  const fileEvent = async (event: { op: string; path?: string; etag?: string }) => {
    await act(async () => { await harness.fileEvent!(event); });
  };

  it("takes an agent's write in place while the text editor has no unsaved edits", async () => {
    localStorage.setItem("kiwifs-editor-mode", "live");
    await mount("Body\n");
    harness.readFile.mockResolvedValueOnce({ content: "Body\n\nAdded by an agent\n", etag: '"agent"' });
    await fileEvent({ op: "write", path: "note.md", etag: "agent" });
    expect(sourceBox().value).toBe("Body\n\nAdded by an agent\n");
    expect(banner()).toBeNull();
    await input("Markdown source editor", "Body, edited\n\nAdded by an agent\n");
    await advance();
    expect(harness.writeFile.mock.calls[0][2]).toBe('"agent"');
  });

  it("asks before replacing unsaved edits, and reloads on request", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("Body\n");
    await input("Markdown source editor", "Mine\n");
    harness.readFile.mockResolvedValueOnce({ content: "Theirs\n", etag: '"theirs"' });
    await fileEvent({ op: "write", path: "note.md", etag: "theirs" });
    expect(banner()!.textContent).toContain("changed on disk");
    expect(sourceBox().value).toBe("Mine\n");
    await advance();
    expect(harness.writeFile).not.toHaveBeenCalled();
    await click("Reload");
    expect(sourceBox().value).toBe("Theirs\n");
    expect(banner()).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).not.toContain("Unsaved");
  });

  it("keeps the user's text on request and saves it over the disk version", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("Body\n");
    await input("Markdown source editor", "Mine\n");
    harness.readFile.mockResolvedValueOnce({ content: "Theirs\n", etag: '"theirs"' });
    await fileEvent({ op: "write", path: "note.md", etag: "theirs" });
    await click("Keep mine");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledWith("note.md", "Mine\n", '"theirs"');
  });

  it("always asks in visual mode, and reloads the blocks from the new file", async () => {
    await mount("Body\n");
    harness.readFile.mockResolvedValueOnce({ content: "New body\n", etag: '"theirs"' });
    await fileEvent({ op: "write", path: "note.md", etag: "theirs" });
    expect(banner()).not.toBeNull();
    await click("Reload");
    expect(harness.editor.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith("New body\n");
  });

  it("clears the visual editor when the reloaded file is empty, so the old text is not saved back", async () => {
    await mount("Old body\n");
    harness.readFile.mockResolvedValueOnce({ content: "", etag: '"emptied"' });
    await fileEvent({ op: "write", path: "note.md", etag: "emptied" });
    await click("Reload");
    expect(harness.editor.document).toEqual([{ type: "paragraph" }]);
  });

  it("ignores the event for its own save", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("Body\n");
    await input("Markdown source editor", "Mine\n");
    await advance();
    harness.readFile.mockClear();
    await fileEvent({ op: "write", path: "note.md", etag: "saved" });
    expect(harness.readFile).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("ignores other pages", async () => {
    await mount("Body\n");
    harness.readFile.mockClear();
    await fileEvent({ op: "write", path: "other.md", etag: "x" });
    expect(harness.readFile).not.toHaveBeenCalled();
  });

  it("shows a rejected save as a disk change rather than an error string", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("Body\n");
    harness.writeFile.mockRejectedValueOnce(Object.assign(new Error("409 Conflict: etag mismatch"), { status: 409 }));
    harness.readFile.mockResolvedValueOnce({ content: "Theirs\n", etag: '"theirs"' });
    await input("Markdown source editor", "Mine\n");
    await advance();
    expect(banner()!.textContent).toContain("before your edits were saved");
    expect(container.textContent).not.toContain("etag mismatch");
    await input("Markdown source editor", "Mine, more\n");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledTimes(1);
  });

  it("offers to save a page deleted on disk again", async () => {
    localStorage.setItem("kiwifs-editor-mode", "source");
    await mount("Body\n");
    await fileEvent({ op: "delete", path: "note.md" });
    expect(banner()!.textContent).toContain("deleted");
    await click("Keep mine");
    await advance();
    expect(harness.writeFile).toHaveBeenCalledWith("note.md", "Body\n", undefined);
  });
});
