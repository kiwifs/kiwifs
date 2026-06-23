import { describe, expect, it } from "vitest";
import { resolveOverlayDismiss, type OverlayState } from "./overlayDismiss";

const closed: OverlayState = {
  shortcutsOpen: false,
  newOpen: false,
  searchOpen: false,
  graphOpen: false,
  historyOpen: false,
  dataOpen: false,
  basesOpen: false,
  canvasOpen: false,
  whiteboardOpen: false,
  timelineOpen: false,
  calendarOpen: false,
  kanbanOpen: false,
};

describe("resolveOverlayDismiss", () => {
  it("returns null when no overlays are open", () => {
    expect(resolveOverlayDismiss(closed)).toBeNull();
  });

  it("prefers shortcuts help over other overlays", () => {
    expect(
      resolveOverlayDismiss({ ...closed, shortcutsOpen: true, searchOpen: true, graphOpen: true }),
    ).toBe("shortcuts");
  });

  it("prefers new-page dialog over search and views", () => {
    expect(resolveOverlayDismiss({ ...closed, newOpen: true, searchOpen: true })).toBe("new");
  });

  it("prefers search over full-screen views", () => {
    expect(resolveOverlayDismiss({ ...closed, searchOpen: true, graphOpen: true })).toBe("search");
  });

  it("dismisses full-screen views in stable priority order", () => {
    expect(resolveOverlayDismiss({ ...closed, graphOpen: true, kanbanOpen: true })).toBe("graph");
    expect(resolveOverlayDismiss({ ...closed, historyOpen: true, dataOpen: true })).toBe("history");
    expect(resolveOverlayDismiss({ ...closed, calendarOpen: true, kanbanOpen: true })).toBe("calendar");
    expect(resolveOverlayDismiss({ ...closed, kanbanOpen: true })).toBe("kanban");
  });
});
