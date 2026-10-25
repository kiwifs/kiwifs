// @vitest-environment happy-dom

import { act, StrictMode, useReducer } from "react";
import { NodeApi } from "react-arborist";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KiwiTree } from "./KiwiTree";
import { TooltipProvider } from "./ui/tooltip";
import { api, type TreeEntry } from "@kw/lib/api";

vi.mock("./tree/KiwiTreeDialogs", () => ({ KiwiTreeDialogs: () => null }));
vi.mock("lucide-react", async (importOriginal) => {
  const icons = await importOriginal<typeof import("lucide-react")>();
  return {
    ...icons,
    ...Object.fromEntries(Object.keys(icons).filter((name) => /^[A-Z]/.test(name)).map((name) => [name, () => null])),
  };
});

const treeRoot: TreeEntry = {
  path: "", name: "", isDir: true,
  children: [
    { path: "page.md", name: "page.md", isDir: false },
  ],
};

let container: HTMLDivElement;
let root: Root;
let rerenderHost: () => void;

async function flushTimers() {
  // Arborist can poll for absent paths; do not drain recursively scheduled timers.
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

async function renderTree(rootEntry = treeRoot, rerenderOnSelect = false) {
  const onSelect = vi.fn();
  function Host() {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    rerenderHost = rerender;
    return (
      <TooltipProvider>
        <KiwiTree
          treeRoot={rootEntry}
          activePath={rootEntry.children?.[0]?.path ?? null}
          onSelect={(path) => {
            onSelect(path);
            if (rerenderOnSelect) rerender();
          }}
          excludePatterns={[]}
        />
      </TooltipProvider>
    );
  }
  await act(async () => root.render(<StrictMode><Host /></StrictMode>));
  return onSelect;
}

function row(path = "page.md") {
  const row = container.querySelector<HTMLElement>(`[data-row-path="${path}"]`);
  if (!row) throw new Error(`Missing row: ${path}`);
  return row;
}

function item(label: string) {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((element) => element.textContent?.trim() === label);
  if (!item) throw new Error(`Missing menu item: ${label}`);
  return item;
}

function press(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

async function openMenu(path = "page.md") {
  await act(async () => {
    const target = row(path);
    target.click();
    target.closest<HTMLElement>('[role="treeitem"]')!.focus();
  });
  await act(async () => {
    row(path).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
  });
}

async function clickRename() {
  await act(async () => item("Rename").click());
  await flushTimers();
}

function focusedInput(path = "page.md") {
  const input = row(path).querySelector("input");
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  return input!;
}

// The test DOM does not run CSS animations. Keep Radix Presence's real close
// lifecycle, but supply the animation names and its completion event.
function holdCloseAnimation() {
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    if (element.getAttribute("role") !== "menu") return style;
    return new Proxy(style, {
      get(target, property) {
        if (property === "animationName") {
          return element.getAttribute("data-state") === "closed" ? "menu-out" : "menu-in";
        }
        return Reflect.get(target, property, target);
      },
    });
  });
  vi.stubGlobal("CSS", { escape: (value: string) => value });
}

async function finishCloseAnimation(menu: Element) {
  await act(async () => {
    const event = new Event("animationend", { bubbles: true });
    Object.defineProperty(event, "animationName", { value: "menu-out" });
    menu.dispatchEvent(event);
  });
  await flushTimers();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(api, "renameFile").mockResolvedValue({ from: "", to: "", etag: "" });
  vi.spyOn(api, "renameDir").mockResolvedValue({ from: "", to: "", renamed: 0 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await flushTimers();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tree context-menu rename", () => {
  it.each(["page.md", "folder", "drawing.canvas.json", "board.excalidraw.md"])(
    "keeps %s's rename input focused after selection rerenders the parent",
    async (path) => {
      await renderTree({
        ...treeRoot,
        children: [{ path, name: path, isDir: path === "folder", children: [] }],
      }, true);
      await openMenu(path);
      await clickRename();
      focusedInput(path);
    },
  );

  it("waits for the close animation and preserves pending Rename across a parent rerender", async () => {
    holdCloseAnimation();
    await renderTree();
    await openMenu();
    const menu = document.querySelector('[role="menu"]')!;
    await clickRename();
    expect(menu.isConnected).toBe(true);
    expect(menu.getAttribute("data-state")).toBe("closed");
    expect(row().querySelector("input")).toBeNull();

    await act(async () => rerenderHost());
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(row().querySelector("input")).toBeNull();

    await finishCloseAnimation(menu);
    focusedInput();
  });

  it("preserves the focused input and draft across a parent rerender, then submits once with Enter", async () => {
    await renderTree();
    await openMenu();
    await clickRename();
    const input = focusedInput();
    input.value = "renamed";
    await act(async () => rerenderHost());
    expect(focusedInput()).toBe(input);
    expect(input.value).toBe("renamed");

    await act(async () => press(input, "Enter"));
    expect(api.renameFile).toHaveBeenCalledExactlyOnceWith("page.md", "renamed.md");
    expect(row().querySelector("input")).toBeNull();
  });

  it("supports menu selection with Space", async () => {
    await renderTree();
    await openMenu();
    await act(async () => {
      const rename = item("Rename");
      rename.focus();
      press(rename, " ");
    });
    await flushTimers();
    focusedInput();
  });

  it("renames the menu's row after Home and ArrowDown keyboard navigation", async () => {
    await renderTree({
      ...treeRoot,
      children: [...treeRoot.children!, { path: "zzz.md", name: "zzz.md", isDir: false }],
    }, true);
    await openMenu();
    const menu = document.querySelector('[role="menu"]')!;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const renameIndex = items.findIndex((element) => element.textContent?.trim() === "Rename");
    expect(renameIndex).toBeGreaterThan(0);
    await act(async () => press(menu, "Home"));
    await flushTimers();
    expect(row().closest('[role="treeitem"]')!.getAttribute("aria-selected")).toBe("true");
    for (let i = 0; i < renameIndex; i++) {
      await act(async () => press(document.activeElement!, "ArrowDown"));
      await flushTimers();
      expect(row().closest('[role="treeitem"]')!.getAttribute("aria-selected")).toBe("true");
    }
    expect(document.activeElement?.textContent?.trim()).toBe("Rename");
    await act(async () => press(document.activeElement!, "Enter"));
    await flushTimers();
    focusedInput("page.md");
  });

  it("cancels pending Rename when the menu reopens and preserves Open and row focus", async () => {
    holdCloseAnimation();
    const onSelect = await renderTree();
    await openMenu();
    await clickRename();
    await openMenu();
    onSelect.mockClear();
    await act(async () => item("Open").click());
    await finishCloseAnimation(document.querySelector('[role="menu"]')!);
    expect(onSelect).toHaveBeenCalledWith("page.md");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(row().querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(row().closest('[role="treeitem"]'));
  });

  it("starts direct Enter renaming without a menu and cancels with Escape", async () => {
    await renderTree();
    await act(async () => {
      const target = row();
      target.click();
      const treeitem = target.closest<HTMLElement>('[role="treeitem"]')!;
      treeitem.focus();
      press(treeitem, "Enter");
    });
    await flushTimers();
    await act(async () => press(focusedInput(), "Escape"));
    expect(row().querySelector("input")).toBeNull();
    expect(api.renameFile).not.toHaveBeenCalled();
  });

  it("still cancels when focus leaves the input", async () => {
    await renderTree();
    await openMenu();
    await clickRename();
    focusedInput();
    await act(async () => row().closest<HTMLElement>('[role="treeitem"]')!.focus());
    expect(row().querySelector("input")).toBeNull();
    expect(api.renameFile).not.toHaveBeenCalled();
  });

  it("restores row focus when the menu is dismissed without Rename", async () => {
    await renderTree();
    await openMenu();
    const treeitem = row().closest('[role="treeitem"]');
    await act(async () => press(document.querySelector('[role="menu"]')!, "Escape"));
    await flushTimers();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(treeitem);
    expect(row().querySelector("input")).toBeNull();
  });

  it("restores focus when Rename targets a non-editable node", async () => {
    await renderTree({
      ...treeRoot,
      children: [{ path: ".kiwi", name: ".kiwi", isDir: true, children: [] }],
    });
    await openMenu(".kiwi");
    await clickRename();
    expect(row(".kiwi").querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(row(".kiwi").closest('[role="treeitem"]'));
  });

  it("does not start a pending rename after its row unmounts", async () => {
    holdCloseAnimation();
    await renderTree();
    await openMenu();
    await clickRename();
    const edit = vi.spyOn(NodeApi.prototype, "edit");
    await act(async () => root.render(null));
    await flushTimers();
    expect(edit).not.toHaveBeenCalled();
    expect(document.querySelector("input")).toBeNull();
    expect(api.renameFile).not.toHaveBeenCalled();
  });
});
