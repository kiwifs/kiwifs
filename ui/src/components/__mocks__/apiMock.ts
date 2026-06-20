import { useState, createElement, type ReactNode } from "react";
import {
  mockTree,
  mockMarkdownRich,
  mockSearchResults,
  mockVersions,
  mockBacklinks,
  mockComments,
  mockGraphNodes,
  mockGraphEdges,
  mockBasesViews,
  mockBasesRows,
  type MockSavedView,
} from "./data";
import type {
  GraphEdge,
  GraphNode,
  WorkflowColumn,
  WorkflowDef,
  WorkflowPage,
} from "@kw/lib/api";

export type MockUIConfig = {
  themeLocked?: boolean;
  startPage?: string;
  branding?: Record<string, string>;
  features?: Record<string, boolean>;
  toolbarViews?: string[] | null;
  sidebar?: Record<string, unknown>;
};

export type MockTimelineEvent = {
  type: string;
  path: string;
  title: string;
  actor: string;
  timestamp: string;
  message: string;
};

export type MockOverrides = {
  fileContent?: string | null;
  fileContents?: Record<string, string>;
  fileStatus?: number;
  tree?: typeof mockTree;
  versions?: typeof mockVersions;
  comments?: typeof mockComments;
  backlinks?: typeof mockBacklinks;
  searchResults?: typeof mockSearchResults;
  workflows?: WorkflowDef[];
  workflowBoards?: Record<string, { columns: WorkflowColumn[]; unmatchedPages?: WorkflowPage[] }>;
  workflowErrors?: string[];
  graphNodes?: GraphNode[];
  graphEdges?: GraphEdge[];
  graphError?: string;
  views?: MockSavedView[];
  viewResults?: Record<string, Record<string, unknown>[]>;
  viewsError?: string;
  queryRows?: Record<string, unknown>[];
  calendarRows?: Record<string, unknown>[];
  metaResults?: Record<string, unknown>[];
  timelineEvents?: MockTimelineEvent[];
  uiConfig?: MockUIConfig;
  delay?: number;
};

function resolveFileContent(
  url: string,
  overrides: MockOverrides,
): { content: string; status: number } {
  const pathMatch = url.match(/[?&]path=([^&]+)/);
  const path = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
  const status = overrides.fileStatus ?? 200;
  if (status !== 200) {
    return { content: "Not found", status };
  }
  if (overrides.fileContents && path in overrides.fileContents) {
    return { content: overrides.fileContents[path], status: 200 };
  }
  if (overrides.fileContents) {
    for (const [key, value] of Object.entries(overrides.fileContents)) {
      if (key.replace(/\/+$/, "") === path.replace(/\/+$/, "")) {
        return { content: value, status: 200 };
      }
    }
  }
  return { content: overrides.fileContent ?? mockMarkdownRich, status: 200 };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown",
      ETag: '"mock-etag-1"',
      "Last-Modified": new Date().toUTCString(),
    },
  });
}

function createMockFetch(overrides: MockOverrides = {}) {
  const originalFetch = window.fetch;

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() || "GET";

    if (overrides.delay) {
      await new Promise((r) => setTimeout(r, overrides.delay));
    }

    if (url.includes("/api/kiwi") || url.includes("/api/spaces") || url.includes("/health")) {
      if (url.includes("/file") && method === "GET") {
        const { content, status } = resolveFileContent(url, overrides);
        if (status !== 200) {
          return new Response("Not found", { status });
        }
        return textResponse(content);
      }

      if (url.includes("/file") && method === "PUT") {
        const pathMatch = url.match(/[?&]path=([^&]+)/);
        const path = pathMatch ? decodeURIComponent(pathMatch[1]) : "unknown.md";
        return jsonResponse({ path, etag: "mock-etag-2" });
      }

      if (url.includes("/tree")) {
        return jsonResponse(overrides.tree ?? mockTree);
      }

      if (url.includes("/versions")) {
        const pathMatch = url.match(/[?&]path=([^&]+)/);
        const path = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
        return jsonResponse({
          path,
          versions: overrides.versions ?? mockVersions,
        });
      }

      if (url.includes("/version") && !url.includes("/versions") && method === "GET") {
        const { content, status } = resolveFileContent(url, overrides);
        if (status !== 200) {
          return new Response("Not found", { status });
        }
        return textResponse(content);
      }

      if (url.includes("/diff") && method === "GET") {
        return textResponse("- old line\n+ new line\n");
      }

      if (url.includes("/comments") && method === "GET") {
        const pathMatch = url.match(/[?&]path=([^&]+)/);
        const path = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
        return jsonResponse({
          path,
          comments: overrides.comments ?? mockComments,
        });
      }

      if (url.includes("/backlinks")) {
        const pathMatch = url.match(/[?&]path=([^&]+)/);
        const path = pathMatch ? decodeURIComponent(pathMatch[1]) : "";
        return jsonResponse({
          path,
          backlinks: overrides.backlinks ?? mockBacklinks,
        });
      }

      if (url.includes("/search") && method === "GET") {
        const qMatch = url.match(/[?&]q=([^&]+)/);
        const q = qMatch ? decodeURIComponent(qMatch[1]) : "";
        return jsonResponse({
          query: q,
          results: overrides.searchResults ?? mockSearchResults,
        });
      }

      if (url.includes("/search/semantic") && method === "POST") {
        return jsonResponse({
          query: "mock",
          topK: 10,
          offset: 0,
          results: (overrides.searchResults ?? mockSearchResults).map((r) => ({
            path: r.path,
            chunkIdx: 0,
            score: r.score,
            snippet: r.snippet || "",
          })),
        });
      }

      if (url.includes("/query?") || url.endsWith("/query")) {
        // Check if it's a CALENDAR query
        const qMatch = url.match(/[?&]q=([^&]+)/);
        const dql = qMatch ? decodeURIComponent(qMatch[1]) : "";
        if (/^\s*CALENDAR\b/i.test(dql)) {
          const rows = overrides.calendarRows ?? [
            { _path: "pages/frontmatter.md", date: new Date().toISOString().slice(0, 10) },
          ];
          return jsonResponse({
            columns: ["_path", "date"],
            rows,
            total: rows.length,
            has_more: false,
          });
        }
        const rows = overrides.queryRows ?? [
          { _path: "pages/frontmatter.md", title: "Frontmatter Guide", status: "published", priority: "high" },
          { _path: "pages/wikilinks.md", title: "Wiki Links", status: "published", priority: "medium" },
          { _path: "pages/use-sqlite-for-search.md", title: "SQLite for Search", status: "draft", priority: "high" },
          { _path: "episodes/example-episode.md", title: "Example Episode", status: "published", priority: "low" },
        ];
        const columns = rows.length > 0
          ? ["_path", ...Object.keys(rows[0]).filter((k) => k !== "_path")]
          : ["_path", "title", "status", "priority"];
        return jsonResponse({
          columns,
          rows,
          total: rows.length,
          has_more: false,
        });
      }

      if (url.includes("/graph")) {
        if (overrides.graphError) {
          return jsonResponse({ error: overrides.graphError }, 500);
        }
        return jsonResponse({
          nodes: overrides.graphNodes ?? mockGraphNodes,
          edges: overrides.graphEdges ?? mockGraphEdges,
        });
      }

      if (url.includes("/kiwi/views/") && url.includes("/execute") && method === "GET") {
        const name = decodeURIComponent(
          url.split("/kiwi/views/")[1]?.split("/execute")[0]?.split(/[?#]/)[0] ?? "",
        );
        const rows = overrides.viewResults?.[name] ?? mockBasesRows;
        return jsonResponse({ rows, total: rows.length });
      }

      if (url.includes("/kiwi/views/") && method === "PUT") {
        return jsonResponse({ status: "ok" });
      }

      if (url.includes("/kiwi/views/") && method === "DELETE") {
        return jsonResponse({ status: "ok" });
      }

      if (
        method === "GET" &&
        url.includes("/kiwi/views") &&
        !url.includes("/kiwi/views/")
      ) {
        if (overrides.viewsError) {
          return jsonResponse({ error: overrides.viewsError }, 500);
        }
        return jsonResponse({ views: overrides.views ?? mockBasesViews });
      }

      if (url.includes("/workflow/board/") && method === "GET") {
        const name = decodeURIComponent(url.split("/workflow/board/")[1]?.split(/[?#]/)[0] ?? "");
        const board = overrides.workflowBoards?.[name] ?? { columns: [] };
        return jsonResponse(board);
      }

      if (url.includes("/workflows") && method === "GET") {
        return jsonResponse({
          workflows: overrides.workflows ?? [],
          errors: overrides.workflowErrors,
        });
      }

      if (url.includes("/workflows/") && method === "PUT") {
        const workflow = init?.body ? JSON.parse(String(init.body)) as WorkflowDef : null;
        return jsonResponse({ status: "ok", workflow });
      }

      if (url.includes("/workflows/") && method === "DELETE") {
        const name = decodeURIComponent(url.split("/workflows/")[1]?.split(/[?#]/)[0] ?? "");
        return jsonResponse({ status: "ok", name });
      }

      if (url.includes("/workflow/advance") && method === "POST") {
        return jsonResponse({ status: "ok" });
      }

      if (url.includes("/workflow/assign") && method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) as { path: string; workflow: string; state: string } : null;
        return jsonResponse({ ...body, etag: "mock-etag-2" });
      }

      if (url.includes("/workflow/reorder") && method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) as { path: string; ordinal: number } : null;
        return jsonResponse({ ...body, etag: "mock-etag-2" });
      }

      if (url.includes("/meta")) {
        const results = overrides.metaResults ?? [
          { path: "pages/frontmatter.md", frontmatter: { title: "Frontmatter Guide", tags: ["documentation", "guide", "metadata"], status: "published" } },
          { path: "pages/wikilinks.md", frontmatter: { title: "Wiki Links", tags: ["documentation", "links"], status: "published" } },
          { path: "pages/use-sqlite-for-search.md", frontmatter: { title: "SQLite for Search", tags: ["architecture", "search"], status: "draft" } },
          { path: "episodes/example-episode.md", frontmatter: { title: "Example Episode", tags: ["episode", "guide"], status: "published" } },
        ];
        return jsonResponse({
          count: results.length,
          limit: 1000,
          offset: 0,
          results,
        });
      }

      if (url.includes("/timeline/actors")) {
        return jsonResponse({ actors: ["alice", "bob", "charlie"] });
      }

      if (url.includes("/timeline")) {
        const events = overrides.timelineEvents ?? [
          { type: "write", path: "pages/frontmatter.md", title: "Frontmatter Guide", actor: "alice", timestamp: new Date(Date.now() - 3600000).toISOString(), message: "Update frontmatter documentation" },
          { type: "write", path: "pages/wikilinks.md", title: "Wiki Links", actor: "bob", timestamp: new Date(Date.now() - 7200000).toISOString(), message: "Add cross-references section" },
          { type: "delete", path: "old/deprecated.md", title: "Deprecated Page", actor: "charlie", timestamp: new Date(Date.now() - 86400000).toISOString(), message: "Remove outdated content" },
          { type: "write", path: "pages/use-sqlite-for-search.md", title: "SQLite for Search", actor: "alice", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), message: "Initial draft" },
          { type: "write", path: "episodes/example-episode.md", title: "Example Episode", actor: "bob", timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), message: "Add example episode" },
        ];
        return jsonResponse({
          events,
          total: events.length,
        });
      }

      if (url.includes("/templates")) {
        return jsonResponse({
          templates: [
            { name: "default", path: "templates/default.md" },
          ],
        });
      }

      if (url.includes("/recent-pages")) {
        return jsonResponse({
          pages: [
            {
              path: "pages/use-sqlite-for-search.md",
              title: "SQLite for Search",
              actor: "alice",
              timestamp: new Date(Date.now() - 3600000).toISOString(),
            },
          ],
        });
      }

      if (url.includes("/ui-config")) {
        const cfg = overrides.uiConfig ?? {};
        return jsonResponse({
          themeLocked: cfg.themeLocked ?? false,
          startPage: cfg.startPage ?? "welcome",
          sidebar: cfg.sidebar ?? { pinned: [], hidden: [], sections: [] },
          branding: cfg.branding ?? {},
          features: {
            graph: true,
            kanban: true,
            canvas: true,
            whiteboard: true,
            timeline: true,
            bases: true,
            data_sources: true,
            ...(cfg.features ?? {}),
          },
          toolbarViews: cfg.toolbarViews ?? null,
        });
      }

      if (url.includes("/theme") && method === "GET") {
        return jsonResponse({});
      }

      if (url.includes("/custom.css") && method === "GET") {
        return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
      }

      if (url.includes("/keybindings") && method === "GET") {
        return jsonResponse({
          bindings: {
            search: "mod+k",
            new_page: "mod+n",
            toggle_editor: "mod+e",
            save: "mod+s",
            toggle_sidebar: "mod+b",
            graph: "mod+g",
            toggle_bases: "mod+shift+b",
            toggle_timeline: "mod+shift+t",
            toggle_kanban: "mod+shift+w",
            toggle_mode: "mod+shift+e",
            shortcuts_help: "mod+/",
            undo: "mod+z",
            focus_tree_filter: "mod+alt+f",
            close_overlay: "escape",
          },
          defaults: {},
          conflicts: [],
        });
      }

      if (url.includes("/editor/slash-commands") && method === "GET") {
        return jsonResponse({ commands: [] });
      }

      if (url.includes("/health")) {
        return jsonResponse({ status: "ok" });
      }

      if (url.includes("/api/spaces")) {
        return jsonResponse({
          spaces: [
            { name: "default", root: "/tmp/kiwi", fileCount: 6, sizeBytes: 14200 },
          ],
        });
      }

      if (url.includes("/blame")) {
        return jsonResponse({ path: "", lines: [] });
      }

      return jsonResponse({ ok: true });
    }

    if (url.includes("/events")) {
      return new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    return originalFetch(input, init);
  };

  return { mockFetch, originalFetch };
}

/**
 * Wrapper component that installs mock fetch synchronously before children render.
 */
export function MockApiProvider({
  children,
  overrides = {},
}: {
  children: ReactNode;
  overrides?: MockOverrides;
}) {
  // Install mock synchronously on first render via useState initializer.
  // No cleanup — the mock stays for the lifetime of the page, which avoids
  // StrictMode double-effect ordering issues (child effects run before
  // parent effects, so App's fetches would hit the real server if cleanup
  // temporarily restored window.fetch).
  useState(() => {
    const { mockFetch } = createMockFetch(overrides);
    window.fetch = mockFetch as typeof window.fetch;
  });

  return createElement("div", null, children);
}

export function installMockFetch(overrides: MockOverrides = {}): () => void {
  const { mockFetch, originalFetch } = createMockFetch(overrides);
  window.fetch = mockFetch as typeof window.fetch;
  return () => {
    window.fetch = originalFetch;
  };
}
