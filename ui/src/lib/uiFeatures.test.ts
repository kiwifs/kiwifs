import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_FEATURES,
  isViewRouteAllowed,
  resolveUIFeatures,
  viewFeatureFromPathname,
} from "./uiFeatures";

describe("uiFeatures", () => {
  it("defaults all features to enabled", () => {
    expect(resolveUIFeatures()).toEqual(DEFAULT_UI_FEATURES);
  });

  it("merges partial overrides", () => {
    expect(resolveUIFeatures({ kanban: false, graph: false }).kanban).toBe(false);
    expect(resolveUIFeatures({ kanban: false }).graph).toBe(true);
  });

  it("maps view routes to feature keys", () => {
    expect(viewFeatureFromPathname("/view/kanban")).toBe("kanban");
    expect(viewFeatureFromPathname("/view/calendar")).toBe("calendar");
    expect(viewFeatureFromPathname("/view/data")).toBe("data_sources");
    expect(viewFeatureFromPathname("/page/foo.md")).toBeNull();
  });

  it("blocks disabled view routes", () => {
    const features = resolveUIFeatures({ kanban: false });
    expect(isViewRouteAllowed("/view/kanban", features)).toBe(false);
    expect(isViewRouteAllowed("/view/graph", features)).toBe(true);
  });
});
