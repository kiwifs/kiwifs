import { create } from "zustand";

type PromptDialog = {
  title: string;
  description: string;
  value: string;
  onConfirm: (value: string) => void;
};

type ConfirmDialog = {
  title: string;
  description: string;
  destructive?: boolean;
  onConfirm: () => void;
};

type OsDragTarget = {
  rowPath: string;
  dropDir: string;
};

type KiwiTreeUiState = {
  dupOpen: boolean;
  dupSource: string;
  dupTarget: string;
  dupBusy: boolean;
  promptDialog: PromptDialog | null;
  promptValue: string;
  alertMessage: string | null;
  confirmDialog: ConfirmDialog | null;
  uploadStatus: string | null;
  dragTarget: OsDragTarget | null;
  fileDragActive: boolean;
  openDupDialog: (srcPath: string) => void;
  closeDupDialog: () => void;
  setDupTarget: (dupTarget: string) => void;
  setDupBusy: (dupBusy: boolean) => void;
  openPromptDialog: (dialog: PromptDialog) => void;
  closePromptDialog: () => void;
  setPromptValue: (promptValue: string) => void;
  setAlertMessage: (alertMessage: string | null) => void;
  openConfirmDialog: (dialog: ConfirmDialog) => void;
  closeConfirmDialog: () => void;
  setUploadStatus: (uploadStatus: string | null) => void;
  setDragTarget: (dragTarget: OsDragTarget | null) => void;
  updateDragTarget: (updater: (previous: OsDragTarget | null) => OsDragTarget | null) => void;
  setFileDragActive: (fileDragActive: boolean) => void;
  resetFileDragUi: () => void;
};

/**
 * Builds the default duplicate target path for a markdown page.
 *
 * @param srcPath - Source markdown path selected in the tree.
 * @returns Copy path used to prefill the duplicate dialog.
 */
const duplicateTargetFor = (srcPath: string): string => srcPath.replace(/\.md$/i, "-copy.md");

/**
 * Centralizes transient Kiwi tree dialog and drag UI state.
 *
 * The store keeps the large tree component declarative: components dispatch
 * named state transitions instead of passing modal state through nested props.
 */
export const useKiwiTreeUiStore = create<KiwiTreeUiState>((set) => ({
  dupOpen: false,
  dupSource: "",
  dupTarget: "",
  dupBusy: false,
  promptDialog: null,
  promptValue: "",
  alertMessage: null,
  confirmDialog: null,
  uploadStatus: null,
  dragTarget: null,
  fileDragActive: false,
  openDupDialog: (srcPath) => set({ dupSource: srcPath, dupTarget: duplicateTargetFor(srcPath), dupOpen: true }),
  closeDupDialog: () => set({ dupOpen: false }),
  setDupTarget: (dupTarget) => set({ dupTarget }),
  setDupBusy: (dupBusy) => set({ dupBusy }),
  openPromptDialog: (dialog) => set({ promptDialog: dialog, promptValue: dialog.value }),
  closePromptDialog: () => set({ promptDialog: null }),
  setPromptValue: (promptValue) => set({ promptValue }),
  setAlertMessage: (alertMessage) => set({ alertMessage }),
  openConfirmDialog: (dialog) => set({ confirmDialog: dialog }),
  closeConfirmDialog: () => set({ confirmDialog: null }),
  setUploadStatus: (uploadStatus) => set({ uploadStatus }),
  setDragTarget: (dragTarget) => set({ dragTarget }),
  updateDragTarget: (updater) => set((state) => ({ dragTarget: updater(state.dragTarget) })),
  setFileDragActive: (fileDragActive) => set({ fileDragActive }),
  resetFileDragUi: () => set({ dragTarget: null, fileDragActive: false }),
}));

export type { ConfirmDialog, OsDragTarget, PromptDialog };
