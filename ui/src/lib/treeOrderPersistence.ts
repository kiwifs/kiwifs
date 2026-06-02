import { apiErrorMessage } from "./api";
import { isMarkdown, stripTrailingSlash } from "./paths";
import type { FlatNode } from "./treeTransform";

type OrderApi = {
  patchFrontmatter(path: string, fields: Record<string, unknown>): Promise<unknown>;
  patchTreeOrder(orders: Record<string, number>): Promise<unknown>;
};

async function patchMarkdownOrder(orderApi: OrderApi, path: string, order: number): Promise<void> {
  try {
    await orderApi.patchFrontmatter(path, { order });
  } catch (error) {
    throw new Error(`Failed to update order for ${path}: ${apiErrorMessage(error)}`);
  }
}

export async function persistSiblingOrder(entries: FlatNode[], orderApi: OrderApi): Promise<void> {
  const orderableEntries = entries.filter((entry) => !entry.virtualDir && (entry.isDir || isMarkdown(entry.id)));
  const directoryOrders: Record<string, number> = {};
  const markdownUpdates: Promise<unknown>[] = [];

  orderableEntries.forEach((entry, i) => {
    const order = i + 1;
    if (entry.order === order) return;
    const cleanPath = stripTrailingSlash(entry.id);
    if (entry.isDir) {
      directoryOrders[cleanPath] = order;
    } else {
      markdownUpdates.push(patchMarkdownOrder(orderApi, cleanPath, order));
    }
  });

  const updates: Promise<unknown>[] = markdownUpdates;
  if (Object.keys(directoryOrders).length > 0) {
    updates.push(orderApi.patchTreeOrder(directoryOrders));
  }
  await Promise.all(updates);
}
