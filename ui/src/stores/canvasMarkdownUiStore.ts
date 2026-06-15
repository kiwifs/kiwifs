import { create } from "zustand";

type MarkdownDropRecord = {
  key: string;
  at: number;
};

type CanvasMarkdownUiState = {
  addMenuOpen: boolean;
  searchOpen: boolean;
  lastDrop: MarkdownDropRecord | null;
  setAddMenuOpen: (addMenuOpen: boolean) => void;
  openMarkdownSearch: () => void;
  closeMarkdownSearch: () => void;
  closeMenus: () => void;
  recordDropIfFresh: (key: string, at: number) => boolean;
};

const DUPLICATE_DROP_WINDOW_MS = 250;

/**
 * Stores transient Markdown page insertion state for FlowCanvas.
 * FlowCanvas의 마크다운 페이지 삽입 관련 임시 상태를 저장합니다.
 *
 * The store keeps menu/search dialog state and drop de-duplication out of
 * the already-large canvas renderer while leaving React Flow nodes/edges in the
 * renderer that owns persistence and history semantics.
 */
export const useCanvasMarkdownUiStore = create<CanvasMarkdownUiState>((set, get) => ({
  addMenuOpen: false,
  searchOpen: false,
  lastDrop: null,
  setAddMenuOpen: (addMenuOpen) => set({ addMenuOpen }),
  openMarkdownSearch: () => set({ addMenuOpen: false, searchOpen: true }),
  closeMarkdownSearch: () => set({ searchOpen: false }),
  closeMenus: () => set({ addMenuOpen: false, searchOpen: false }),
  recordDropIfFresh: (key, at) => {
    const lastDrop = get().lastDrop;
    if (isDuplicateDrop(lastDrop, key, at)) return false;
    set({ lastDrop: { key, at } });
    return true;
  },
}));

/**
 * Detects duplicate browser drop deliveries for the same canvas location.
 * 같은 캔버스 위치에 대해 브라우저가 중복 전달한 drop 이벤트인지 확인합니다.
 *
 * @param lastDrop - Most recent accepted drop record.
 * @param key - Current drop identity built from path and rounded coordinates.
 * @param at - Current event timestamp in milliseconds.
 * @returns True when the drop should be ignored as a duplicate.
 */
const isDuplicateDrop = (lastDrop: MarkdownDropRecord | null, key: string, at: number): boolean => {
  if (!lastDrop) return false;
  if (lastDrop.key !== key) return false;
  return at - lastDrop.at < DUPLICATE_DROP_WINDOW_MS;
};

export type { CanvasMarkdownUiState };
