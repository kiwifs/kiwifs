import { describe, expect, it } from "vitest";
import { applyOptimisticTreeMove } from "./treeReorder";
import type { TreeEntry } from "./api";

const root = (): TreeEntry => ({
  path: "",
  name: "/",
  isDir: true,
  children: [
    { path: "a.md", name: "a.md", isDir: false, order: 1 },
    { path: "b.md", name: "b.md", isDir: false, order: 2 },
    { path: "c.md", name: "c.md", isDir: false, order: 3 },
    {
      path: "folder/",
      name: "folder",
      isDir: true,
      children: [{ path: "folder/d.md", name: "d.md", isDir: false, order: 1 }],
    },
  ],
});

describe("applyOptimisticTreeMove", () => {
  it("reorders siblings immediately and updates markdown order fields", () => {
    const next = applyOptimisticTreeMove(root(), {
      dragIds: ["c.md"],
      parentId: null,
      index: 0,
    });

    expect(next.children?.map((entry) => entry.path)).toEqual(["c.md", "a.md", "b.md", "folder/"]);
    expect(next.children?.slice(0, 3).map((entry) => entry.order)).toEqual([1, 2, 3]);
  });

  it("moves a markdown page into another folder immediately", () => {
    const next = applyOptimisticTreeMove(root(), {
      dragIds: ["b.md"],
      parentId: "folder",
      index: 1,
    });

    expect(next.children?.map((entry) => entry.path)).toEqual(["a.md", "c.md", "folder/"]);
    const folder = next.children?.find((entry) => entry.path === "folder/");
    expect(folder?.children?.map((entry) => entry.path)).toEqual(["folder/d.md", "folder/b.md"]);
    expect(folder?.children?.map((entry) => entry.order)).toEqual([1, 2]);
  });

  it("moves a folder and retargets descendant paths immediately", () => {
    const next = applyOptimisticTreeMove(root(), {
      dragIds: ["folder/"],
      parentId: null,
      index: 0,
    });

    expect(next.children?.map((entry) => entry.path)).toEqual(["folder/", "a.md", "b.md", "c.md"]);

    const nestedRoot = root();
    nestedRoot.children?.push({ path: "target/", name: "target", isDir: true, children: [] });
    const moved = applyOptimisticTreeMove(nestedRoot, {
      dragIds: ["folder/"],
      parentId: "target",
      index: 0,
    });
    const target = moved.children?.find((entry) => entry.path === "target/");
    const folder = target?.children?.find((entry) => entry.path === "target/folder/");
    expect(folder?.children?.map((entry) => entry.path)).toEqual(["target/folder/d.md"]);
  });
});
