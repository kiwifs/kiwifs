import { useState, useEffect, createElement, type ReactNode } from "react";
import {
  mockTree,
  mockMarkdownRich,
  mockSearchResults,
  mockVersions,
  mockBacklinks,
  mockComments,
  mockGraphNodes,
  mockGraphEdges,
} from "./data";

export type MockOverrides = {
  fileContent?: string | null;
  fileStatus?: number;
  tree?: typeof mockTree;
  versions?: typeof mockVersions;
  comments?: typeof mockComments;
  backlinks?: typeof mockBacklinks;
  searchResults?: typeof mockSearchResults;
  delay?: number;
};

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
        const content = overrides.fileContent ?? mockMarkdownRich;
        const status = overrides.fileStatus ?? 200;
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
        return textResponse(overrides.fileContent ?? mockMarkdownRich);
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
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, "0");
          return jsonResponse({
            columns: ["_path", "date"],
            rows: [
              { _path: "pages/frontmatter.md", date: `${yyyy}-${mm}-03` },
              { _path: "pages/wikilinks.md", date: `${yyyy}-${mm}-07` },
              { _path: "pages/use-sqlite-for-search.md", date: `${yyyy}-${mm}-12` },
              { _path: "episodes/example-episode.md", date: `${yyyy}-${mm}-15` },
              { _path: "welcome.md", date: `${yyyy}-${mm}-15` },
            ],
            total: 5,
            has_more: false,
          });
        }
        return jsonResponse({
          columns: ["_path", "title", "status", "priority"],
          rows: [
            { _path: "pages/frontmatter.md", title: "Frontmatter Guide", status: "published", priority: "high" },
            { _path: "pages/wikilinks.md", title: "Wiki Links", status: "published", priority: "medium" },
            { _path: "pages/use-sqlite-for-search.md", title: "SQLite for Search", status: "draft", priority: "high" },
            { _path: "episodes/example-episode.md", title: "Example Episode", status: "published", priority: "low" },
          ],
          total: 4,
          has_more: false,
        });
      }

      if (url.includes("/graph")) {
        return jsonResponse({
          nodes: mockGraphNodes,
          edges: mockGraphEdges,
        });
      }

      if (url.includes("/meta")) {
        return jsonResponse({
          count: 4,
          limit: 1000,
          offset: 0,
          results: [
            { path: "pages/frontmatter.md", frontmatter: { title: "Frontmatter Guide", tags: ["documentation", "guide", "metadata"], status: "published" } },
            { path: "pages/wikilinks.md", frontmatter: { title: "Wiki Links", tags: ["documentation", "links"], status: "published" } },
            { path: "pages/use-sqlite-for-search.md", frontmatter: { title: "SQLite for Search", tags: ["architecture", "search"], status: "draft" } },
            { path: "episodes/example-episode.md", frontmatter: { title: "Example Episode", tags: ["episode", "guide"], status: "published" } },
          ],
        });
      }

      if (url.includes("/timeline/actors")) {
        return jsonResponse({ actors: ["alice", "bob", "charlie"] });
      }

      if (url.includes("/timeline")) {
        return jsonResponse({
          events: [
            { type: "write", path: "pages/frontmatter.md", title: "Frontmatter Guide", actor: "alice", timestamp: new Date(Date.now() - 3600000).toISOString(), message: "Update frontmatter documentation" },
            { type: "write", path: "pages/wikilinks.md", title: "Wiki Links", actor: "bob", timestamp: new Date(Date.now() - 7200000).toISOString(), message: "Add cross-references section" },
            { type: "delete", path: "old/deprecated.md", title: "Deprecated Page", actor: "charlie", timestamp: new Date(Date.now() - 86400000).toISOString(), message: "Remove outdated content" },
            { type: "write", path: "pages/use-sqlite-for-search.md", title: "SQLite for Search", actor: "alice", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), message: "Initial draft" },
            { type: "write", path: "episodes/example-episode.md", title: "Example Episode", actor: "bob", timestamp: new Date(Date.now() - 86400000 * 3).toISOString(), message: "Add example episode" },
          ],
          total: 5,
        });
      }

      if (url.includes("/templates")) {
        return jsonResponse({
          templates: [
            { name: "default", path: "templates/default.md" },
          ],
        });
      }

      if (url.includes("/ui-config")) {
        return jsonResponse({ themeLocked: false });
      }

      if (url.includes("/theme") && method === "GET") {
        return jsonResponse({});
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
 * Wrapper component that installs mock fetch BEFORE rendering children.
 * Uses a two-phase render: first install the mock, then render children
 * on the next tick so child useEffects see the mocked fetch.
 */
export function MockApiProvider({
  children,
  overrides = {},
}: {
  children: ReactNode;
  overrides?: MockOverrides;
}) {
  const [ready, setReady] = useState(false);

  // Install mock synchronously on first render via useState initializer
  const [cleanup] = useState(() => {
    const { mockFetch, originalFetch } = createMockFetch(overrides);
    window.fetch = mockFetch as typeof window.fetch;
    return () => {
      window.fetch = originalFetch;
    };
  });

  useEffect(() => {
    setReady(true);
    return cleanup;
  }, [cleanup]);

  if (!ready) return null;
  return createElement("div", null, children);
}

export function installMockFetch(overrides: MockOverrides = {}): () => void {
  const { mockFetch, originalFetch } = createMockFetch(overrides);
  window.fetch = mockFetch as typeof window.fetch;
  return () => {
    window.fetch = originalFetch;
  };
}
