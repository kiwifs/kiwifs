import type { FlatNode } from "./treeTransform";

type OrderApi = {
  patchFrontmatter(path: string, fields: Record<string, unknown>): Promise<unknown>;
};

/**
 * No-op since tree sorting is now handled by natural sort on filenames.
 * Drag-and-drop moves are persisted via file rename, not order metadata.
 */
export const persistSiblingOrder = async (_entries: FlatNode[], _orderApi: OrderApi): Promise<void> => {};
