// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdownFixtures } from "@kw/test/markdownFixtures";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";

vi.mock("../FenceBlock", () => ({
  resolveFence: (lang: string) => ({ kind: ["array", "tree", "mermaid", "kiwi-app"].includes(lang) ? "typed" : "code" }),
  FenceBlock: ({ className }: { className: string }) => <div data-testid="fence-widget">{className}</div>,
}));
vi.mock("@kw/lib/rawUrl", () => ({
  pageAssetUrl: (src: string) => src,
  resolveRawUrl: async (src: string) => src,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(value: string, props: Partial<Parameters<typeof MarkdownSourceEditor>[0]> = {}) {
  const onChange = vi.fn<(next: string) => void>();
  await act(async () => {
    root.render(<MarkdownSourceEditor value={value} onChange={onChange} {...props} />);
  });
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  return { view, onChange };
}

describe("MarkdownSourceEditor", () => {
  it("keeps its parse tree when the parent re-renders with a fresh save callback", async () => {
    const onSave = vi.fn();
    const { view, onChange } = await render("# Title\n\nBody\n", { livePreview: true, onSaveShortcut: () => onSave() });
    const tree = syntaxTree(view.state);
    await act(async () => {
      root.render(
        <MarkdownSourceEditor value={"# Title\n\nBody\n"} onChange={onChange} livePreview onSaveShortcut={() => onSave(2)} />,
      );
    });
    expect(syntaxTree(view.state)).toBe(tree);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "s", metaKey: mac, ctrlKey: !mac }), "editor");
    expect(onSave).toHaveBeenCalledWith(2);
  });

  it("appends an outside line to a file with no final newline without moving the caret", async () => {
    const { view, onChange } = await render("first\nlast");
    await act(async () => {
      view.dispatch({ selection: EditorSelection.cursor(2) });
    });
    await act(async () => {
      root.render(<MarkdownSourceEditor value={"first\nlast\nadded"} onChange={onChange} />);
    });
    expect(view.state.doc.toString()).toBe("first\nlast\nadded");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("keeps a CRLF file's line endings when the user edits it", async () => {
    const { view, onChange } = await render("# Title\r\n\r\nBody\r\n");
    expect(view.state.doc.toString()).toBe("# Title\n\nBody\n");
    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "More\n" } });
    });
    expect(onChange).toHaveBeenLastCalledWith("# Title\r\n\r\nBody\r\nMore\r\n");
  });

  it("applies an outside change without moving the caret off its text", async () => {
    const { view, onChange } = await render("intro\n\nthe caret is here\n");
    await act(async () => {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf("here")) });
    });
    await act(async () => {
      root.render(<MarkdownSourceEditor value={"a much longer intro\n\nthe caret is here\n"} onChange={onChange} />);
    });
    const head = view.state.selection.main.head;
    expect(view.state.sliceDoc(head, head + 4)).toBe("here");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("labels live preview for assistive technology", async () => {
    const { view } = await render("text", { livePreview: true });
    expect(view.contentDOM.getAttribute("aria-label")).toBe("Markdown live preview editor");
    expect(container.querySelector("[data-live-preview]")).not.toBeNull();
    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });

  it("renders widget fences through the page's fence renderer", async () => {
    await render("Intro\n\n```array\nvalues: [1]\n```\n\n```ts\nconst x = 1;\n```\n\nend", { livePreview: true });
    expect([...container.querySelectorAll("[data-testid=fence-widget]")].map((el) => el.textContent)).toEqual([
      "language-array",
    ]);
  });

  it.each(markdownFixtures.map((f) => [f.name, f.content]))(
    "%s: live preview never changes the text, wherever the caret goes",
    async (_name, content) => {
      const { view, onChange } = await render(content, { livePreview: true, resolveWikiLink: () => null });
      const expected = content.replace(/\r\n/g, "\n");
      for (let n = 1; n <= view.state.doc.lines; n++) {
        await act(async () => {
          view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(n).from) });
        });
      }
      expect(view.state.doc.toString()).toBe(expected);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});
