import { describe, expect, it } from "vitest";
import { DEFAULT_UI_FEATURES } from "./uiFeatures";
import {
  composeToolbarViews,
  DEFAULT_TOOLBAR_VIEWS,
  filterToolbarViewsByFeatures,
  resolveToolbarViews,
} from "./toolbarComposition";

describe("composeToolbarViews", () => {
  it("returns all built-ins in default order when config is unset", () => {
    expect(composeToolbarViews(null)).toEqual(DEFAULT_TOOLBAR_VIEWS);
    expect(composeToolbarViews(undefined)).toEqual(DEFAULT_TOOLBAR_VIEWS);
  });

  it("filters to configured views in the requested order", () => {
    expect(composeToolbarViews(["kanban", "graph", "bases"])).toEqual([
      "kanban",
      "graph",
      "bases",
    ]);
  });

  it("drops unknown ids and deduplicates", () => {
    expect(
      composeToolbarViews(["graph", "agent", "graph", "data", "unknown"]),
    ).toEqual(["graph", "data"]);
  });

  it("accepts data_sources as an alias for data", () => {
    expect(composeToolbarViews(["data_sources", "graph"])).toEqual([
      "data",
      "graph",
    ]);
  });

  it("returns empty when explicitly configured with no views", () => {
    expect(composeToolbarViews([])).toEqual([]);
  });
});

describe("resolveToolbarViews", () => {
  it("prefers host config over server config", () => {
    expect(resolveToolbarViews(["graph", "data"], ["kanban"])).toEqual([
      "kanban",
    ]);
  });

  it("falls back to server config when host config is unset", () => {
    expect(resolveToolbarViews(["bases", "graph"], undefined)).toEqual([
      "bases",
      "graph",
    ]);
  });

  it("uses defaults when neither host nor server config is set", () => {
    expect(resolveToolbarViews(undefined, undefined)).toEqual(
      DEFAULT_TOOLBAR_VIEWS,
    );
  });
});

describe("filterToolbarViewsByFeatures", () => {
  it("removes views disabled by feature flags", () => {
    expect(
      filterToolbarViewsByFeatures(
        ["graph", "kanban", "data"],
        { ...DEFAULT_UI_FEATURES, kanban: false, data_sources: false },
      ),
    ).toEqual(["graph"]);
  });

  it("hides the calendar button when the calendar feature is off", () => {
    expect(
      filterToolbarViewsByFeatures(
        ["timeline", "calendar"],
        { ...DEFAULT_UI_FEATURES, calendar: false },
      ),
    ).toEqual(["timeline"]);
  });
});
