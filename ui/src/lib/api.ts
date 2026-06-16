// Typed client for the KiwiFS REST API. All calls share one fetch wrapper so
// error handling and actor attribution stay consistent.

export type TreeEntry = {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
  order?: number;
  frontmatterError?: string;
  children?: TreeEntry[];
};

export type CanvasEntry = {
  path: string;
  name: string;
};

export type SearchMatch = { line: number; text: string };
export type SearchResult = {
  path: string;
  score: number;
  snippet?: string;
  matches?: SearchMatch[];
};

export type SearchSuggestion = {
  query: string;
  path: string;
  title: string;
  distance: number;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  suggestions?: SearchSuggestion[];
};

export type Version = {
  hash: string;
  author: string;
  date: string;
  message: string;
};

export type SemanticResult = {
  path: string;
  chunkIdx: number;
  score: number;
  snippet: string;
};

export type SemanticResponse = {
  query: string;
  topK: number;
  offset: number;
  results: SemanticResult[];
};

export type BlameLine = {
  line: number;
  hash: string;
  author: string;
  date: string;
  text: string;
};

export type BacklinkEntry = {
  path: string;
  count: number;
};

export type GraphNode = { path: string; tags?: string[] };
export type GraphEdge = { source: string; target: string };
export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[] };

export type CommentAnchor = {
  quote: string;
  prefix?: string;
  suffix?: string;
  offset?: number;
};
export type Comment = {
  id: string;
  path: string;
  anchor: CommentAnchor;
  body: string;
  author: string;
  createdAt: string;
  resolved?: boolean;
};
export type CommentsResponse = { path: string; comments: Comment[] };

export type MetaFilter = { field: string; op: string; value: string };
export type MetaResult = {
  path: string;
  frontmatter: Record<string, unknown>;
};
export type MetaResponse = {
  count: number;
  limit: number;
  offset: number;
  results: MetaResult[];
};
export type QueryResponse = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  has_more: boolean;
  groups?: { key: string; count: number }[];
};

export type BackupStatus = {
  last_push_at?: string;
  success: boolean;
  error?: string;
};

export type BackupStatusResponse = {
  enabled: boolean;
  status?: BackupStatus;
};

export type SpaceMeta = {
  name: string;
  root: string;
  fileCount: number;
  lastModified?: string;
  sizeBytes: number;
};

const DEFAULT_ACTOR = "human:web-ui";

export class ApiError extends Error {
  status: number;
  statusText: string;
  body: string;
  url: string;

  constructor(status: number, statusText: string, body: string, url: string) {
    super(`${status} ${statusText}: ${body || url}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.url = url;
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.body || error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

let _baseOverride: string | null = null;
let _extraHeaders: Record<string, string> = {};

export function setBaseOverride(base: string | null) {
  _baseOverride = base;
  if (typeof window !== "undefined") {
    (window as any).__kiwi_api_base__ = base;
  }
}

export function setExtraHeaders(headers: Record<string, string>) {
  _extraHeaders = headers;
}

let _currentSpace: string | null = null;
const _spaceListeners = new Set<() => void>();

export function setCurrentSpace(space: string | null) {
  _currentSpace = space;
  try {
    if (space) {
      localStorage.setItem("kiwifs-space", space);
    } else {
      localStorage.removeItem("kiwifs-space");
    }
  } catch {}
  _spaceListeners.forEach((fn) => fn());
}

export function getCurrentSpace(): string | null {
  return _currentSpace;
}

export function onSpaceChange(fn: () => void): () => void {
  _spaceListeners.add(fn);
  return () => _spaceListeners.delete(fn);
}

// Restore last-used space from localStorage on load.
try {
  const saved = localStorage.getItem("kiwifs-space");
  if (saved) _currentSpace = saved;
} catch {}

function kiwiBase(): string {
  if (_baseOverride) return _baseOverride;
  if (typeof window !== "undefined" && (window as any).__kiwi_api_base__) {
    return (window as any).__kiwi_api_base__;
  }
  if (_currentSpace && _currentSpace !== "default") {
    return `/api/kiwi/${_currentSpace}`;
  }
  return "/api/kiwi";
}

export function sseUrl(): string {
  return `${kiwiBase()}/events`;
}

function actor(): string {
  try {
    return localStorage.getItem("kiwifs-actor") || DEFAULT_ACTOR;
  } catch {
    return DEFAULT_ACTOR;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Actor": actor(),
      ..._extraHeaders,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, res.statusText, text, url);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export const api = {
  // ─── Space Management ───────────────────────────────────────────────────────

  async listSpaces(): Promise<{ spaces: SpaceMeta[] }> {
    return request("/api/spaces");
  },

  async getSpace(name: string): Promise<SpaceMeta> {
    return request(`/api/spaces/${encodeURIComponent(name)}`);
  },

  async createSpace(
    name: string,
    root: string,
    template?: string
  ): Promise<SpaceMeta> {
    return request("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, root, template: template ?? "blank" }),
    });
  },

  async listInitTemplates(): Promise<{
    templates: { id: string; label: string; description?: string }[];
  }> {
    return request("/api/init-templates");
  },

  async deleteSpace(name: string): Promise<{ deleted: string }> {
    return request(`/api/spaces/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  // ─── Knowledge API (space-scoped) ───────────────────────────────────────────

  async health(): Promise<{ status: string }> {
    return request("/health");
  },

  async backupStatus(): Promise<BackupStatusResponse> {
    return request(`${kiwiBase()}/sync/status`);
  },

  async tree(path = "/"): Promise<TreeEntry> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/tree?${qs}`);
  },

  async analytics(scope = "", staleThreshold = 30): Promise<AnalyticsResponse> {
    const qs = new URLSearchParams();
    if (scope) qs.set("scope", scope);
    if (staleThreshold !== 30) qs.set("stale_threshold", String(staleThreshold));
    const q = qs.toString();
    return request(`${kiwiBase()}/analytics${q ? `?${q}` : ""}`);
  },

  async pageViews(opts?: { path?: string; top?: number }): Promise<{ top: number; results: PageViewStat[] }> {
    const qs = new URLSearchParams();
    if (opts?.path) qs.set("path", opts.path);
    if (opts?.top) qs.set("top", String(opts.top));
    const q = qs.toString();
    return request(`${kiwiBase()}/analytics/views${q ? `?${q}` : ""}`);
  },

  async analyticsOverview(period = "7d"): Promise<OverviewStats> {
    const qs = new URLSearchParams({ period });
    return request(`${kiwiBase()}/analytics/overview?${qs}`);
  },

  async analyticsViews(period = "30d", path?: string): Promise<AnalyticsViewsResponse> {
    const qs = new URLSearchParams({ period });
    if (path) qs.set("path", path);
    return request(`${kiwiBase()}/analytics/views/v2?${qs}`);
  },

  async analyticsSearches(period = "30d"): Promise<AnalyticsSearchesResponse> {
    const qs = new URLSearchParams({ period });
    return request(`${kiwiBase()}/analytics/searches?${qs}`);
  },

  async analyticsTrends(period = "7d"): Promise<AnalyticsTrendsResponse> {
    const qs = new URLSearchParams({ period });
    return request(`${kiwiBase()}/analytics/trends?${qs}`);
  },

  async analyticsContentGaps(limit = 20): Promise<AnalyticsContentGapsResponse> {
    const qs = new URLSearchParams({ limit: String(limit) });
    return request(`${kiwiBase()}/analytics/content-gaps?${qs}`);
  },

  async dismissContentGap(query: string, searchType = "search"): Promise<{ dismissed: string }> {
    return request(`${kiwiBase()}/analytics/content-gaps/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Actor": actor(), ..._extraHeaders },
      body: JSON.stringify({ query, search_type: searchType }),
    });
  },

  async analyticsSources(period = "7d"): Promise<AnalyticsSourcesResponse> {
    const qs = new URLSearchParams({ period });
    return request(`${kiwiBase()}/analytics/sources?${qs}`);
  },

  async readFile(path: string): Promise<{ content: string; etag: string | null; lastModified: string | null }> {
    const qs = new URLSearchParams({ path });
    const res = await fetch(`${kiwiBase()}/file?${qs}`, {
      headers: { "X-Actor": actor(), "X-Kiwi-Source": "ui", ..._extraHeaders },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const content = await res.text();
    const etag = res.headers.get("ETag");
    const lastModified = res.headers.get("Last-Modified");
    return { content, etag, lastModified };
  },

  async writeFile(
    path: string,
    content: string,
    etag?: string | null
  ): Promise<{ path: string; etag: string }> {
    const qs = new URLSearchParams({ path });
    const headers: Record<string, string> = {
      "Content-Type": "text/markdown",
      "X-Actor": actor(),
    };
    if (etag) headers["If-Match"] = etag;
    return request(`${kiwiBase()}/file?${qs}`, {
      method: "PUT",
      headers,
      body: content,
    });
  },

  async patchFrontmatter(path: string, fields: Record<string, unknown>): Promise<{ path: string; etag: string }> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/file/frontmatter?${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Actor": actor(), ..._extraHeaders },
      body: JSON.stringify({ fields }),
    });
  },

  async patchTreeOrder(orders: Record<string, number>): Promise<{ updated: number }> {
    return request(`${kiwiBase()}/tree/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Actor": actor(), ..._extraHeaders },
      body: JSON.stringify({ orders }),
    });
  },

  async deleteFile(path: string): Promise<{ deleted: string }> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/file?${qs}`, { method: "DELETE" });
  },

  async uploadAsset(file: File, dir: string): Promise<string> {
    const qs = new URLSearchParams();
    if (dir) qs.set("path", dir);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${kiwiBase()}/assets?${qs}`, {
      method: "POST",
      headers: { "X-Actor": actor(), ..._extraHeaders },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 413) throw new Error("File too large (max 100 MB)");
      if (res.status === 415) throw new Error(`File type not supported: ${file.type}`);
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const body = (await res.json()) as { path: string };
    return "/raw/" + body.path;
  },

  async search(q: string, opts?: { modifiedAfter?: string }): Promise<SearchResponse> {
    const qs = new URLSearchParams({ q });
    if (opts?.modifiedAfter) qs.set("modifiedAfter", opts.modifiedAfter);
    return request(`${kiwiBase()}/search?${qs}`);
  },

  async semanticSearch(
    query: string,
    topK = 10,
    offset = 0,
    opts?: { modifiedAfter?: string }
  ): Promise<SemanticResponse> {
    return request(`${kiwiBase()}/search/semantic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK, offset, ...(opts?.modifiedAfter ? { modifiedAfter: opts.modifiedAfter } : {}) }),
    });
  },

  async versions(path: string): Promise<{ path: string; versions: Version[] }> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/versions?${qs}`);
  },

  async readVersion(path: string, version: string): Promise<string> {
    const qs = new URLSearchParams({ path, version });
    const res = await fetch(`${kiwiBase()}/version?${qs}`, {
      headers: { "X-Actor": actor(), ..._extraHeaders },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.text();
  },

  async diff(path: string, from: string, to: string): Promise<string> {
    const qs = new URLSearchParams({ path, from, to });
    return request(`${kiwiBase()}/diff?${qs}`);
  },

  async blame(path: string): Promise<{ path: string; lines: BlameLine[] }> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/blame?${qs}`);
  },

  async backlinks(path: string): Promise<{ path: string; backlinks: BacklinkEntry[] }> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/backlinks?${qs}`);
  },

  async graph(): Promise<GraphResponse> {
    return request(`${kiwiBase()}/graph`);
  },

  async listTemplates(): Promise<{ templates: { name: string; path: string }[] }> {
    return request(`${kiwiBase()}/templates`);
  },

  async readTemplate(name: string): Promise<{ name: string; content: string }> {
    const qs = new URLSearchParams({ name });
    return request(`${kiwiBase()}/template?${qs}`);
  },

  async listComments(path: string): Promise<CommentsResponse> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/comments?${qs}`);
  },

  async addComment(
    path: string,
    anchor: CommentAnchor,
    body: string
  ): Promise<Comment> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/comments?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchor, body }),
    });
  },

  async deleteComment(
    path: string,
    id: string
  ): Promise<{ deleted: string; path: string }> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/comments/${id}?${qs}`, { method: "DELETE" });
  },

  async resolveComment(
    path: string,
    id: string,
    resolved: boolean
  ): Promise<Comment> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/comments/${id}?${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
  },

  async query(dql: string, opts?: {
    limit?: number;
    offset?: number;
    format?: string;
  }): Promise<QueryResponse> {
    const qs = new URLSearchParams();
    qs.set("q", dql);
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    if (opts?.offset != null) qs.set("offset", String(opts.offset));
    if (opts?.format) qs.set("format", opts.format);
    return request(`${kiwiBase()}/query?${qs}`);
  },

  async meta(opts: {
    where?: MetaFilter[];
    sort?: string;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<MetaResponse> {
    const qs = new URLSearchParams();
    for (const f of opts.where ?? []) {
      qs.append("where", `${f.field}${f.op}${f.value}`);
    }
    if (opts.sort) qs.set("sort", opts.sort);
    if (opts.order) qs.set("order", opts.order);
    if (opts.limit != null) qs.set("limit", String(opts.limit));
    if (opts.offset != null) qs.set("offset", String(opts.offset));
    return request(`${kiwiBase()}/meta?${qs}`);
  },

  async getRules(): Promise<string> {
    const res = await fetch(`${kiwiBase()}/rules`, {
      headers: { "X-Actor": actor(), ..._extraHeaders },
    });
    if (!res.ok) {
      if (res.status === 404) return "";
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.text();
  },

  async putRules(content: string): Promise<void> {
    await request<unknown>(`${kiwiBase()}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: content,
    });
  },

  async getRecentPages(limit = 10): Promise<{ pages: RecentPageEntry[] }> {
    const qs = new URLSearchParams({ limit: String(limit) });
    return request(`${kiwiBase()}/recent-pages?${qs}`);
  },

  async getUIConfig(): Promise<{
    themeLocked: boolean;
    startPage: string;
    sidebar?: {
      pinned: string[];
      hidden: string[];
      sections: { label: string; paths: string[] }[];
    };
  }> {
    return request(`${kiwiBase()}/ui-config`);
  },

  async getTheme(): Promise<Record<string, unknown>> {
    return request(`${kiwiBase()}/theme`);
  },

  async getCustomCSS(): Promise<string> {
    const res = await fetch(`${kiwiBase()}/custom.css`);
    if (!res.ok) {
      if (res.status === 404) return "";
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.text();
  },

  async getKeybindings(): Promise<{
    bindings: Record<string, string>;
    defaults: Record<string, string>;
    conflicts: { chord: string; actions: string[] }[];
  }> {
    return request(`${kiwiBase()}/keybindings`);
  },

  async putTheme(theme: Record<string, unknown>): Promise<Record<string, unknown>> {
    return request(`${kiwiBase()}/theme`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(theme),
    });
  },

  // --- Views (Bases) ---

  async listViews(): Promise<{ views: { name: string; query: string; layout: string; columns: unknown[]; filters: unknown[]; sort: unknown[] }[] }> {
    return request(`${kiwiBase()}/views`);
  },

  async getView(name: string): Promise<{ name: string; query: string; layout: string; columns: unknown[]; filters: unknown[]; sort: unknown[]; group_by?: string }> {
    return request(`${kiwiBase()}/views/${encodeURIComponent(name)}`);
  },

  async saveView(name: string, view: Record<string, unknown>): Promise<void> {
    return request(`${kiwiBase()}/views/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(view),
    });
  },

  async deleteView(name: string): Promise<void> {
    return request(`${kiwiBase()}/views/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  async executeView(name: string): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    return request(`${kiwiBase()}/views/${encodeURIComponent(name)}/execute`);
  },

  async renameFile(
    oldPath: string,
    newPath: string,
  ): Promise<{ path: string; etag: string }> {
    const { content } = await this.readFile(oldPath);
    const result = await this.writeFile(newPath, content);
    await this.deleteFile(oldPath);
    return result;
  },

  async renameDir(
    oldDir: string,
    newDir: string,
    _files?: string[],
  ): Promise<{ from: string; to: string; renamed: number }> {
    return request(`${kiwiBase()}/rename-dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: oldDir.replace(/\/+$/, ""), to: newDir.replace(/\/+$/, "") }),
    });
  },

  async uploadAssets(files: File[], dir: string): Promise<string[]> {
    const results: string[] = [];
    for (const file of files) {
      const path = await this.uploadAsset(file, dir);
      results.push(path);
    }
    return results;
  },

  // --- Canvas ---

  async listCanvases(): Promise<{ canvases: CanvasEntry[] }> {
    const res = await request<{ canvases: CanvasEntry[] | string[] }>(`${kiwiBase()}/canvases`);
    const raw = res.canvases ?? [];
    const canvases: CanvasEntry[] = raw.map((item) => {
      if (typeof item === "string") {
        const base = item.split("/").pop() ?? item;
        const name = base.replace(/\.canvas\.json$/i, "") || base;
        return { path: item, name };
      }
      return item;
    });
    return { canvases };
  },

  async getCanvas(path: string): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/canvas?${qs}`);
  },

  async saveCanvas(path: string, data: Record<string, unknown>): Promise<void> {
    const qs = new URLSearchParams({ path });
    return request(`${kiwiBase()}/canvas?${qs}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async generateCanvas(opts?: {
    path?: string;
    layout?: "dot" | "neato" | "fdp" | "circo";
    folder?: string;
    colorize?: boolean;
  }): Promise<{ path: string; etag: string; node_count: number; edge_count: number }> {
    return request(`${kiwiBase()}/canvas/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
  },

  // --- Timeline ---

  async getTimeline(params?: {
    limit?: number;
    offset?: number;
    actor?: string;
    type?: string;
    prefix?: string;
    range?: string;
  }): Promise<{ events: TimelineEvent[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    if (params?.actor) qs.set("actor", params.actor);
    if (params?.type) qs.set("type", params.type);
    if (params?.prefix) qs.set("prefix", params.prefix);
    if (params?.range) qs.set("range", params.range);
    return request(`${kiwiBase()}/timeline?${qs}`);
  },

  async getTimelineActors(): Promise<{ actors: string[] }> {
    return request(`${kiwiBase()}/timeline/actors`);
  },

  // --- Workflows / Kanban ---

  async listWorkflows(): Promise<{ workflows: WorkflowDef[]; errors?: string[] }> {
    return request(`${kiwiBase()}/workflows`);
  },

  async saveWorkflow(workflow: WorkflowDef): Promise<{ status: string; workflow: WorkflowDef }> {
    return request(`${kiwiBase()}/workflows/${encodeURIComponent(workflow.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflow),
    });
  },

  async deleteWorkflow(name: string): Promise<{ status: string; name: string }> {
    return request(`${kiwiBase()}/workflows/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  async getWorkflowBoard(name: string): Promise<{ columns: WorkflowColumn[]; unmatchedPages?: WorkflowPage[] }> {
    const raw: { columns?: WorkflowColumn[]; workflow?: WorkflowDef; board?: Record<string, WorkflowPage[]> } =
      await request(`${kiwiBase()}/workflow/board/${encodeURIComponent(name)}`);

    if (raw.columns) return { columns: raw.columns };

    const wf = raw.workflow;
    const board = raw.board ?? {};
    const columns: WorkflowColumn[] = (wf?.states ?? []).map((s) => ({
      state: s.name,
      color: s.color,
      pages: board[s.name] ?? [],
      ...(s.wip_limit ? { wip_limit: s.wip_limit } : {}),
    }));
    const unmatched = board["__unmatched__"] ?? [];
    return { columns, unmatchedPages: unmatched.length > 0 ? unmatched : undefined };
  },

  async advanceWorkflow(path: string, workflow: string, targetState: string): Promise<void> {
    return request(`${kiwiBase()}/workflow/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, workflow, target_state: targetState }),
    });
  },

  async assignWorkflow(path: string, workflow: string, state: string, ordinal?: number): Promise<{ path: string; workflow: string; state: string; etag: string }> {
    return request(`${kiwiBase()}/workflow/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, workflow, state, ...(ordinal != null ? { ordinal } : {}) }),
    });
  },

  async reorderCard(path: string, ordinal: number): Promise<{ path: string; ordinal: number; etag: string }> {
    return request(`${kiwiBase()}/workflow/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ordinal }),
    });
  },

  // --- Web Clipper ---

  async clipUrl(params: { url: string; title?: string; tags?: string[]; folder?: string }): Promise<{ path: string; title: string; excerpt: string }> {
    return request(`${kiwiBase()}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  // --- Template preview ---

  async previewTemplate(name: string): Promise<{ content: string }> {
    return request(`${kiwiBase()}/templates/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },

  // --- Publish lifecycle ---

  async publish(path: string): Promise<PublishResponse> {
    return request(`${kiwiBase()}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  },

  async unpublish(path: string): Promise<PublishResponse> {
    return request(`${kiwiBase()}/unpublish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  },

  async publishBulk(paths: string[]): Promise<PublishBulkResponse> {
    return request(`${kiwiBase()}/publish/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
  },

  async unpublishBulk(paths: string[]): Promise<PublishBulkResponse> {
    return request(`${kiwiBase()}/unpublish/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
  },

  async publishStatus(path: string): Promise<PublishStatusResponse> {
    return request(`${kiwiBase()}/publish/status?path=${encodeURIComponent(path)}`);
  },

  async publishedPages(): Promise<PublishedPagesResponse> {
    return request(`${kiwiBase()}/publish/list`);
  },

  // --- Import pipeline ---

  /** Upload a file and run import (or preview). For CSV, JSON, YAML, Excel, SQLite. */
  async importUpload(opts: {
    file: File;
    from: string;
    mode: "preview" | "import" | "infer-fields";
    prefix?: string;
    id_column?: string;
    table?: string;
    query?: string;
    field_mappings?: ImportFieldMapping[];
  }): Promise<ImportPreviewResponse | ImportRunResponse> {
    const form = new FormData();
    form.append("file", opts.file);
    form.append("from", opts.from);
    form.append("mode", opts.mode);
    if (opts.prefix) form.append("prefix", opts.prefix);
    if (opts.id_column) form.append("id_column", opts.id_column);
    if (opts.table) form.append("table", opts.table);
    if (opts.query) form.append("query", opts.query);
    if (opts.field_mappings?.length) form.append("field_mappings", JSON.stringify(opts.field_mappings));
    const res = await fetch(`${kiwiBase()}/import/upload`, {
      method: "POST",
      headers: { "X-Actor": actor(), ..._extraHeaders },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try { msg = JSON.parse(text).message ?? text; } catch { /* text is fine */ }
      throw new Error(`${res.status}: ${msg}`);
    }
    return res.json();
  },

  async importBrowse(params: ImportBrowseRequest): Promise<ImportBrowseResponse> {
    return request(`${kiwiBase()}/import/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  async importPreview(params: ImportPreviewRequest): Promise<ImportPreviewResponse> {
    return request(`${kiwiBase()}/import/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  async importInferFields(params: Omit<ImportPreviewRequest, "limit" | "field_mappings">): Promise<ImportInferFieldsResponse> {
    return request(`${kiwiBase()}/import/infer-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  async importRun(params: ImportRunRequest): Promise<ImportRunResponse> {
    return request(`${kiwiBase()}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  async importConnections(): Promise<ImportConnection[]> {
    return request(`${kiwiBase()}/import/connections`);
  },

  async importSaveConnection(conn: Partial<ImportConnection>): Promise<ImportConnection> {
    return request(`${kiwiBase()}/import/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(conn),
    });
  },

  async importDeleteConnection(id: string): Promise<void> {
    return request(`${kiwiBase()}/import/connections/${id}`, { method: "DELETE" });
  },

  async importRunConnection(id: string, creds?: { credentials?: unknown; api_key?: string }): Promise<ImportRunResponse> {
    return request(`${kiwiBase()}/import/connections/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds ?? {}),
    });
  },

  async importToggleSync(id: string, enabled: boolean, interval?: string): Promise<ImportConnection> {
    return request(`${kiwiBase()}/import/connections/${id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, interval }),
    });
  },

  async importSources(): Promise<{ builtin: string[]; airbyte: string[] | null; docker_available: boolean; cloud_key_present: boolean }> {
    return request(`${kiwiBase()}/import/sources`);
  },

  async importAirbyteSpec(from: string): Promise<AirbyteSpecResponse> {
    return request(`${kiwiBase()}/import/airbyte/spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from }),
    });
  },

  async importAirbyteCheck(from: string, config: Record<string, unknown>): Promise<AirbyteCheckResponse> {
    return request(`${kiwiBase()}/import/airbyte/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, config }),
    });
  },

  async importAirbyteDiscover(from: string, config: Record<string, unknown>): Promise<AirbyteDiscoverResponse> {
    return request(`${kiwiBase()}/import/airbyte/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, config }),
    });
  },

  async importAirbyteCloudCheck(from: string, config: Record<string, unknown>): Promise<{ status: string; message?: string; source_id?: string }> {
    return request(`${kiwiBase()}/import/airbyte-cloud/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, config }),
    });
  },

  async importAirbyteCloudDiscover(sourceId: string): Promise<{ streams: AirbyteStream[] }> {
    return request(`${kiwiBase()}/import/airbyte-cloud/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId }),
    });
  },

  async importAirbyteCloudConnections(): Promise<{ connections: unknown[] }> {
    return request(`${kiwiBase()}/import/airbyte-cloud/connections`);
  },

  async importAirbyteCloudSync(connectionId: string): Promise<{ jobId: number; status: string }> {
    return request(`${kiwiBase()}/import/airbyte-cloud/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: connectionId }),
    });
  },
};

// --- Recent pages (startup view) ---

export type RecentPageEntry = {
  path: string;
  title: string;
  actor: string;
  timestamp: string;
};

// --- Timeline types ---

export type TimelineEvent = {
  type: "write" | "delete" | "rename";
  path: string;
  title?: string;
  actor: string;
  timestamp: string;
  message?: string;
};

// --- Workflow types ---

export type WorkflowDef = {
  name: string;
  states: { name: string; color: string; wip_limit?: number }[];
  transitions: { from: string; to: string }[];
};

export type WorkflowColumn = {
  state: string;
  color: string;
  pages: WorkflowPage[];
  wip_limit?: number;
};

export type WorkflowPage = {
  path: string;
  title: string;
  tags?: string[];
  author?: string;
  modified?: string;
  priority?: string;
  due?: string;
  description?: string;
  ordinal?: number;
  blocked?: boolean;
  block_reason?: string;
  depends_on?: string[];
};

// --- Import types ---

export type ImportBrowseRequest = {
  from: string;
  dsn?: string;
  uri?: string;
  project?: string;
  database?: string;
  credentials?: unknown;
  api_key?: string;
};

export type ImportBrowseResponse = {
  tables: { name: string; estimated_count?: number }[];
};

export type ImportFieldMapping = {
  source: string;
  target: string;
  type?: "string" | "number" | "date" | "boolean";
  skip?: boolean;
};

export type ImportPreviewRequest = {
  from: string;
  dsn?: string;
  uri?: string;
  project?: string;
  database?: string;
  table?: string;
  collection?: string;
  database_id?: string;
  base_id?: string;
  table_id?: string;
  credentials?: unknown;
  api_key?: string;
  prefix?: string;
  id_column?: string;
  field_mappings?: ImportFieldMapping[];
  limit?: number;
};

export type ImportPreviewResponse = {
  records: { path: string; frontmatter: Record<string, unknown>; body_preview: string }[];
};

export type ImportInferFieldsResponse = {
  fields: ImportFieldMapping[];
};

export type ImportRunRequest = {
  from: string;
  dsn?: string;
  uri?: string;
  db?: string;
  project?: string;
  database?: string;
  table?: string;
  collection?: string;
  database_id?: string;
  base_id?: string;
  table_id?: string;
  prefix?: string;
  id_column?: string;
  columns?: string[];
  field_mappings?: ImportFieldMapping[];
  credentials?: unknown;
  api_key?: string;
  limit?: number;
  dry_run?: boolean;
};

export type ImportRunResponse = {
  imported: number;
  skipped: number;
  errors: string[];
};

export type ImportConnection = {
  id: string;
  from: string;
  name: string;
  project?: string;
  table?: string;
  collection?: string;
  database?: string;
  database_id?: string;
  base_id?: string;
  table_id?: string;
  dsn?: string;
  uri?: string;
  prefix: string;
  id_column?: string;
  columns?: string[];
  last_run?: string;
  last_stats?: { imported: number; skipped: number; errors?: string[] };
  created_at: string;
  sync_enabled?: boolean;
  sync_interval?: string;
  next_sync?: string;
  sync_status?: string;
  sync_error?: string;
};

export type AirbyteSpecProperty = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  const?: unknown;
  airbyte_secret?: boolean;
  order?: number;
  oneOf?: AirbyteSpecProperty[];
  properties?: Record<string, AirbyteSpecProperty>;
  required?: string[];
};

export type AirbyteSpecResponse = {
  connectionSpecification: {
    title?: string;
    description?: string;
    type: string;
    properties: Record<string, AirbyteSpecProperty>;
    required?: string[];
  };
};

export type AirbyteCheckResponse = {
  status: "SUCCEEDED" | "FAILED";
  message?: string;
};

export type AirbyteStream = {
  name: string;
  json_schema?: Record<string, unknown>;
  supported_sync_modes?: string[];
  namespace?: string;
};

export type AirbyteDiscoverResponse = {
  streams: AirbyteStream[];
};

// --- Analytics types ---

export type PageViewStat = {
  path: string;
  count: number;
  first_seen: number;
  last_seen: number;
};

export type FailedSearchStat = {
  query: string;
  search_type: string;
  count: number;
  first_seen: number;
  last_seen: number;
};

export type AnalyticsEngagement = {
  total_views: number;
  top_viewed: PageViewStat[];
  failed_searches: FailedSearchStat[];
};

export type AnalyticsResponse = {
  total_pages: number;
  total_words: number;
  health: {
    stale: { count: number; paths: string[] };
    orphans: { count: number; paths: string[] };
    broken_links: { count: number; paths: string[] };
    empty: { count: number; paths: string[] };
    no_frontmatter: { count: number; paths: string[] };
  };
  coverage: {
    pages_with_links: number;
    pages_without_links: number;
    avg_links_per_page: number;
  };
  top_updated: { path: string; updated_at: string }[];
  engagement?: AnalyticsEngagement;
};

// --- Analytics v2 types ---

export type TimePoint = {
  timestamp: number;
  count: number;
};

export type TrendStat = {
  path: string;
  current_views: number;
  previous_views: number;
  delta_percent: number;
};

export type SearchStat = {
  query: string;
  search_type: string;
  count: number;
  had_results: number;
};

export type OverviewStats = {
  period: string;
  total_views: number;
  views_delta_percent: number;
  total_searches: number;
  searches_delta_percent: number;
  search_success_rate: number;
  success_rate_delta_pp: number;
  unique_pages_viewed: number;
  unique_pages_delta_percent: number;
};

export type AnalyticsViewsResponse = {
  period: string;
  path?: string;
  source?: string;
  time_series: TimePoint[];
  top_pages: PageViewStat[];
};

export type AnalyticsSearchesResponse = {
  period: string;
  search_success_rate: number;
  time_series: TimePoint[];
  top_failed: SearchStat[];
};

export type AnalyticsTrendsResponse = {
  period: string;
  trending: TrendStat[];
  declining: TrendStat[];
};

export type AnalyticsContentGapsResponse = {
  results: FailedSearchStat[];
};

export type AnalyticsSourcesResponse = {
  period: string;
  sources: Record<string, number>;
};

// --- Publish types ---

export type PublishResponse = {
  path: string;
  published: boolean;
  published_at?: string;
  public_url?: string;
};

export type PublishStatusResponse = {
  path: string;
  published: boolean;
  published_at?: string;
  public_url?: string;
  view_count: number;
};

export type PublishBulkError = {
  path: string;
  error: string;
};

export type PublishBulkResponse = {
  published: boolean;
  requested: number;
  changed: number;
  skipped: number;
  paths: PublishResponse[];
  errors?: PublishBulkError[];
};

export type PublishedPage = {
  path: string;
  published_at?: string;
  public_url: string;
};

export type PublishedPagesResponse = {
  count: number;
  pages: PublishedPage[];
};
