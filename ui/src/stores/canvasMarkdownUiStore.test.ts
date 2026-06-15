import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasMarkdownUiStore } from "./canvasMarkdownUiStore";

const resetCanvasMarkdownUiStore = () => {
  useCanvasMarkdownUiStore.setState({
    addMenuOpen: false,
    searchOpen: false,
    lastDrop: null,
  });
};

describe("canvasMarkdownUiStore", () => {
  beforeEach(() => {
    resetCanvasMarkdownUiStore();
  });

  it("opens native search from the Add menu", () => {
    const store = useCanvasMarkdownUiStore.getState();

    store.setAddMenuOpen(true);
    useCanvasMarkdownUiStore.getState().openMarkdownSearch();

    expect(useCanvasMarkdownUiStore.getState().addMenuOpen).toBe(false);
    expect(useCanvasMarkdownUiStore.getState().searchOpen).toBe(true);
  });

  it("rejects duplicate drops in the browser duplicate-delivery window", () => {
    const store = useCanvasMarkdownUiStore.getState();

    expect(store.recordDropIfFresh("Notes/Overview.md:1:2", 1_000)).toBe(true);
    expect(useCanvasMarkdownUiStore.getState().recordDropIfFresh("Notes/Overview.md:1:2", 1_100)).toBe(false);
    expect(useCanvasMarkdownUiStore.getState().recordDropIfFresh("Notes/Overview.md:1:2", 1_300)).toBe(true);
  });
});
