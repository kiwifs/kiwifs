import { create } from "zustand";
import { temporal } from "zundo";
import { api } from "@kw/lib/api";

export type FileSnapshot = {
  path: string;
  content: string;
};

export type FileOp =
  | { type: "delete"; snapshots: FileSnapshot[] }
  | { type: "move"; from: string; to: string }
  | { type: "upload"; path: string };

type FileOpsState = {
  history: FileOp[];
  push: (op: FileOp) => void;
  pop: () => FileOp | undefined;
  canUndo: boolean;
};

export const useFileOpsStore = create<FileOpsState>()(
  temporal(
    (set, get) => ({
      history: [] as FileOp[],
      canUndo: false,
      push: (op: FileOp) =>
        set((s) => ({ history: [...s.history, op], canUndo: true })),
      pop: () => {
        const { history } = get();
        if (history.length === 0) return undefined;
        const op = history[history.length - 1];
        set({ history: history.slice(0, -1), canUndo: history.length > 1 });
        return op;
      },
    }),
    { limit: 50 },
  ),
);

export async function undoFileOp(): Promise<string | null> {
  const op = useFileOpsStore.getState().pop();
  if (!op) return null;

  switch (op.type) {
    case "delete":
      for (const snap of op.snapshots) {
        await api.writeFile(snap.path, snap.content);
      }
      return `Restored ${op.snapshots.length} file(s)`;

    case "move":
      await api.renameFile(op.to, op.from);
      return `Moved back to ${op.from}`;

    case "upload":
      await api.deleteFile(op.path, { permanent: true });
      return `Removed uploaded file ${op.path}`;

    default:
      return null;
  }
}
