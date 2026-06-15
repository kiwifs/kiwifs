import type { TreeEntry } from "./api";

const KIWI_PATH_MIME = "application/kiwi-path";
const TEXT_URI_LIST_MIME = "text/uri-list";
const TEXT_PLAIN_MIME = "text/plain";
const APPLICATION_JSON_MIME = "application/json";
const CANVAS_MARKDOWN_DRAG_PATH_KEY = "__kiwifsCanvasDragPath";

type CanvasMarkdownDragHost = typeof globalThis & {
  [CANVAS_MARKDOWN_DRAG_PATH_KEY]?: string;
};

/**
 * Finds Markdown page paths in a tree response for the canvas picker.
 * 캔버스 선택기에 표시할 마크다운 페이지 경로를 트리 응답에서 수집합니다.
 *
 * @param entry - Root tree entry returned by the API.
 * @returns Sorted Markdown page paths.
 */
export function collectMarkdownPages(entry: TreeEntry | null | undefined): string[] {
  if (!entry) return [];
  const children = entry.children ?? [];
  const self = markdownPageEntryPath(entry);
  return [...self, ...children.flatMap((child) => collectMarkdownPages(child))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Writes the Markdown path payload used by canvas drag-and-drop.
 * 캔버스 드래그 앤 드롭에서 사용할 마크다운 경로 payload를 기록합니다.
 *
 * @param dataTransfer - Browser drag data store.
 * @param path - Markdown page path from the file tree.
 */
export function attachCanvasMarkdownDragPayload(dataTransfer: DataTransfer, path: string): void {
  setCanvasMarkdownDragPath(path);
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(KIWI_PATH_MIME, path);
  dataTransfer.setData(TEXT_PLAIN_MIME, path);
  dataTransfer.setData(TEXT_URI_LIST_MIME, path);
}

/**
 * Clears the global fallback after browser drop handlers finish.
 * 브라우저 drop 핸들러가 끝난 뒤 전역 fallback 경로를 정리합니다.
 */
export function clearCanvasMarkdownDragPath(): void {
  globalThis.setTimeout(() => {
    delete canvasMarkdownDragHost()[CANVAS_MARKDOWN_DRAG_PATH_KEY];
  }, 0);
}

/**
 * Returns the active tree-drag Markdown path fallback, if any.
 * 현재 트리 드래그 중인 마크다운 경로 fallback을 반환합니다.
 *
 * @returns Markdown path or an empty string.
 */
export function getCanvasMarkdownDragPath(): string {
  return canvasMarkdownDragHost()[CANVAS_MARKDOWN_DRAG_PATH_KEY] ?? "";
}

/**
 * Extracts the first Markdown path from browser drag formats.
 * 브라우저 드래그 포맷에서 첫 번째 마크다운 경로를 추출합니다.
 *
 * @param dataTransfer - Browser drag data store.
 * @returns Markdown path when the drag contains one, otherwise null.
 */
export function normalizeDroppedMarkdownPath(dataTransfer: DataTransfer): string | null {
  const candidates = [
    dataTransfer.getData(KIWI_PATH_MIME),
    dataTransfer.getData(TEXT_URI_LIST_MIME),
    dataTransfer.getData(TEXT_PLAIN_MIME),
    dataTransfer.getData(APPLICATION_JSON_MIME),
    getCanvasMarkdownDragPath(),
  ];

  return candidates.flatMap(markdownLinesFromDragPayload)[0] ?? null;
}

/**
 * Checks whether a path points at a Markdown page.
 * 경로가 마크다운 페이지를 가리키는지 확인합니다.
 *
 * @param path - Candidate page path.
 * @returns True when the path ends with .md, case-insensitively.
 */
export function isMarkdownPagePath(path: string): boolean {
  return path.trim().toLowerCase().endsWith(".md");
}

/**
 * Stores a fallback path for libraries that rewrite dataTransfer formats.
 * dataTransfer 포맷을 덮어쓰는 라이브러리를 위해 fallback 경로를 저장합니다.
 *
 * @param path - Markdown page path from the file tree.
 */
function setCanvasMarkdownDragPath(path: string): void {
  canvasMarkdownDragHost()[CANVAS_MARKDOWN_DRAG_PATH_KEY] = path;
}

/**
 * Returns the current entry as a one-item Markdown page list when it is draggable.
 * 현재 엔트리가 드래그 가능한 마크다운 페이지이면 한 항목 목록으로 반환합니다.
 *
 * @param entry - Tree entry under inspection.
 * @returns A one-item path list or an empty list.
 */
function markdownPageEntryPath(entry: TreeEntry): string[] {
  if (entry.isDir) return [];
  if (!isMarkdownPagePath(entry.path)) return [];
  return [entry.path];
}

/**
 * Returns the object that stores the active drag fallback.
 * 현재 드래그 fallback을 저장하는 객체를 반환합니다.
 *
 * @returns Global object shared across drag event handlers.
 */
function canvasMarkdownDragHost(): CanvasMarkdownDragHost {
  return globalThis as CanvasMarkdownDragHost;
}

/**
 * Splits drag payload text into valid Markdown page path candidates.
 * 드래그 payload 텍스트를 유효한 마크다운 페이지 경로 후보로 나눕니다.
 *
 * @param payload - Raw drag payload text.
 * @returns Markdown path candidates contained in the payload.
 */
function markdownLinesFromDragPayload(payload: string): string[] {
  return payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && isMarkdownPagePath(line));
}
