/** Overlay state used by Escape / close_overlay keybinding dispatch. */
export type OverlayState = {
  shortcutsOpen: boolean;
  newOpen: boolean;
  searchOpen: boolean;
  graphOpen: boolean;
  historyOpen: boolean;
  dataOpen: boolean;
  basesOpen: boolean;
  canvasOpen: boolean;
  whiteboardOpen: boolean;
  timelineOpen: boolean;
  calendarOpen: boolean;
  kanbanOpen: boolean;
};

export type OverlayDismissTarget =
  | "shortcuts"
  | "new"
  | "search"
  | "graph"
  | "history"
  | "data"
  | "bases"
  | "canvas"
  | "whiteboard"
  | "timeline"
  | "calendar"
  | "kanban";

/** Returns the topmost overlay to dismiss, or null when nothing is open. */
export function resolveOverlayDismiss(state: OverlayState): OverlayDismissTarget | null {
  if (state.shortcutsOpen) return "shortcuts";
  if (state.newOpen) return "new";
  if (state.searchOpen) return "search";
  if (state.graphOpen) return "graph";
  if (state.historyOpen) return "history";
  if (state.dataOpen) return "data";
  if (state.basesOpen) return "bases";
  if (state.canvasOpen) return "canvas";
  if (state.whiteboardOpen) return "whiteboard";
  if (state.timelineOpen) return "timeline";
  if (state.calendarOpen) return "calendar";
  if (state.kanbanOpen) return "kanban";
  return null;
}
