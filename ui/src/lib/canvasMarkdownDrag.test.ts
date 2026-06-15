import { describe, expect, it, vi } from "vitest";
import {
  attachCanvasMarkdownDragPayload,
  clearCanvasMarkdownDragPath,
  collectMarkdownPages,
  getCanvasMarkdownDragPath,
  normalizeDroppedMarkdownPath,
} from "./canvasMarkdownDrag";
import type { TreeEntry } from "./api";

class FakeDataTransfer {
  effectAllowed = "uninitialized";
  private readonly values = new Map<string, string>();

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }

  setData(format: string, data: string): void {
    this.values.set(format, data);
  }
}

describe("canvasMarkdownDrag", () => {
  it("collects sorted Markdown page paths from a tree", () => {
    const tree: TreeEntry = {
      path: "",
      name: "/",
      isDir: true,
      children: [
        { path: "zeta.md", name: "zeta.md", isDir: false },
        { path: "notes", name: "notes", isDir: true, children: [
          { path: "notes/alpha.MD", name: "alpha.MD", isDir: false },
          { path: "notes/image.png", name: "image.png", isDir: false },
        ] },
      ],
    };

    expect(collectMarkdownPages(tree)).toEqual(["notes/alpha.MD", "zeta.md"]);
  });

  it("normalizes Markdown paths from tree drag data", () => {
    const dataTransfer = new FakeDataTransfer();

    attachCanvasMarkdownDragPayload(dataTransfer as unknown as DataTransfer, "notes/Overview.md");

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(normalizeDroppedMarkdownPath(dataTransfer as unknown as DataTransfer)).toBe(
      "notes/Overview.md",
    );
    expect(getCanvasMarkdownDragPath()).toBe("notes/Overview.md");
  });

  it("ignores uri-list comments and returns the first Markdown line", () => {
    const dataTransfer = new FakeDataTransfer();
    dataTransfer.setData("text/uri-list", "# comment\nassets/image.png\nnotes/Page.md");

    expect(normalizeDroppedMarkdownPath(dataTransfer as unknown as DataTransfer)).toBe(
      "notes/Page.md",
    );
  });

  it("clears the global fallback after the drag cycle", () => {
    vi.useFakeTimers();
    const dataTransfer = new FakeDataTransfer();
    attachCanvasMarkdownDragPayload(dataTransfer as unknown as DataTransfer, "notes/Page.md");

    clearCanvasMarkdownDragPath();
    vi.runAllTimers();

    expect(getCanvasMarkdownDragPath()).toBe("");
    vi.useRealTimers();
  });
});
