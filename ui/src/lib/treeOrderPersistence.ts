import { apiErrorMessage } from "./api";
import { isMarkdown, stripTrailingSlash } from "./paths";
import type { FlatNode } from "./treeTransform";

type OrderApi = {
  patchFrontmatter(path: string, fields: Record<string, unknown>): Promise<unknown>;
  patchTreeOrder(orders: Record<string, number>): Promise<unknown>;
};

type OrderUpdatePlan = {
  directoryOrders: Record<string, number>;
  markdownOrders: { path: string; order: number }[];
};

/**
 * Reports whether a tree row can own a persisted sibling order.
 *
 * @param entry - Flattened tree row produced from the server tree.
 * @returns True when the row is a real directory or markdown page.
 */
const isOrderableEntry = (entry: FlatNode): boolean => {
  if (entry.virtualDir) {
    return false;
  }
  if (entry.isDir) {
    return true;
  }
  return isMarkdown(entry.id);
};

/**
 * Builds the immutable order update plan for a sibling list.
 *
 * @param entries - Sibling rows after the optimistic drag-and-drop move.
 * @returns Directory metadata updates and markdown frontmatter updates.
 */
const planSiblingOrderUpdates = (entries: FlatNode[]): OrderUpdatePlan => {
  return entries.filter(isOrderableEntry).reduce<OrderUpdatePlan>((plan, entry, index) => {
    const order = index + 1;
    if (entry.order === order) {
      return plan;
    }

    const cleanPath = stripTrailingSlash(entry.id);
    if (entry.isDir) {
      return {
        directoryOrders: { ...plan.directoryOrders, [cleanPath]: order },
        markdownOrders: plan.markdownOrders,
      };
    }

    return {
      directoryOrders: plan.directoryOrders,
      markdownOrders: [...plan.markdownOrders, { path: cleanPath, order }],
    };
  }, { directoryOrders: {}, markdownOrders: [] });
};

/**
 * Persists a single markdown page's order into frontmatter and includes the
 * path in the thrown error so drag failures identify the blocked file.
 *
 * @param orderApi - API facade used by the tree container.
 * @param path - Markdown page path without a trailing slash.
 * @param order - New one-based sibling order.
 * @returns Nothing.
 */
const patchMarkdownOrder = async (orderApi: OrderApi, path: string, order: number): Promise<void> => {
  try {
    await orderApi.patchFrontmatter(path, { order });
    return;
  } catch (error) {
    throw new Error(`Failed to update order for ${path}: ${apiErrorMessage(error)}`);
  }
};

/**
 * Persists sibling order after an optimistic tree move.
 *
 * Markdown rows are written through frontmatter while directory rows share a
 * tree-order sidecar because folders cannot store markdown frontmatter.
 *
 * @param entries - Sibling rows in their final visual order.
 * @param orderApi - API facade used to write frontmatter and tree metadata.
 * @returns Nothing.
 */
export const persistSiblingOrder = async (entries: FlatNode[], orderApi: OrderApi): Promise<void> => {
  const plan = planSiblingOrderUpdates(entries);
  const markdownUpdates = plan.markdownOrders.map(({ path, order }) => patchMarkdownOrder(orderApi, path, order));
  const directoryUpdates: Promise<unknown>[] = [];
  if (Object.keys(plan.directoryOrders).length > 0) {
    directoryUpdates.push(orderApi.patchTreeOrder(plan.directoryOrders));
  }

  await Promise.all([...markdownUpdates, ...directoryUpdates]);
};
