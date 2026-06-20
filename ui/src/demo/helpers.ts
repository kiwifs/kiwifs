import type { MockOverrides } from "@kw/components/__mocks__/apiMock";
import type { TreeEntry } from "@kw/lib/api";
import type { DemoTemplateConfig } from "./types";

export function file(path: string, name: string, size = 1200): TreeEntry {
  return { path, name, isDir: false, size };
}

export function dir(path: string, name: string, children: TreeEntry[]): TreeEntry {
  return { path, name, isDir: true, children };
}

export function buildTree(entries: TreeEntry[]): TreeEntry {
  return { path: "", name: "", isDir: true, children: entries };
}

/** Build a sidebar tree from flat page paths (e.g. "recipes/sourdough.md"). */
export function treeFromPages(pages: Record<string, string>): TreeEntry {
  const root: TreeEntry = { path: "", name: "", isDir: true, children: [] };

  for (const pagePath of Object.keys(pages).sort()) {
    const parts = pagePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      current.children = current.children ?? [];

      if (isFile) {
        if (!current.children.some((c) => c.path === fullPath)) {
          current.children.push({
            path: fullPath,
            name: part,
            isDir: false,
            size: pages[pagePath].length,
          });
        }
      } else {
        let dir = current.children.find((c) => c.isDir && c.path === fullPath);
        if (!dir) {
          dir = { path: fullPath, name: part, isDir: true, children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  return root;
}

export function demoOverrides(config: DemoTemplateConfig): MockOverrides {
  return {
    tree: config.tree,
    fileContents: config.fileContents,
    uiConfig: {
      startPage: config.startPage ?? config.initialPath,
      branding: config.branding,
      ...config.uiConfig,
    },
    ...config.mock,
  };
}

export function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

export function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400000).toISOString();
}
