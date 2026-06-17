import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { DEFAULT_BRANDING } from "./branding";
import { DEFAULT_UI_FEATURES } from "./uiFeatures";
import { useUIConfigStore } from "./uiConfigStore";

describe("uiConfigStore", () => {
  afterEach(() => {
    useUIConfigStore.setState({
      themeLocked: false,
      branding: DEFAULT_BRANDING,
      features: DEFAULT_UI_FEATURES,
      loaded: false,
    });
    vi.restoreAllMocks();
  });

  it("defaults before load", () => {
    expect(useUIConfigStore.getState().themeLocked).toBe(false);
    expect(useUIConfigStore.getState().branding).toEqual(DEFAULT_BRANDING);
    expect(useUIConfigStore.getState().features).toEqual(DEFAULT_UI_FEATURES);
    expect(useUIConfigStore.getState().loaded).toBe(false);
  });

  it("stores branding from ui-config", async () => {
    vi.spyOn(api, "getUIConfig").mockResolvedValue({
      themeLocked: false,
      startPage: "welcome",
      branding: {
        name: "Acme KB",
        logoUrl: ".kiwi/assets/logo.png",
        welcomeTitle: "Welcome to Acme",
        welcomeMessage: "Get started.",
      },
    });

    await useUIConfigStore.getState().load();

    const { branding } = useUIConfigStore.getState();
    expect(branding.name).toBe("Acme KB");
    expect(branding.logoUrl).toBe("/raw/.kiwi/assets/logo.png");
    expect(branding.welcomeTitle).toBe("Welcome to Acme");
    expect(branding.hasCustomLogo).toBe(true);
    expect(useUIConfigStore.getState().loaded).toBe(true);
  });

  it("stores feature flags from ui-config", async () => {
    vi.spyOn(api, "getUIConfig").mockResolvedValue({
      themeLocked: false,
      startPage: "welcome",
      features: { kanban: false, graph: true },
    });

    await useUIConfigStore.getState().load();

    expect(useUIConfigStore.getState().features.kanban).toBe(false);
    expect(useUIConfigStore.getState().features.graph).toBe(true);
    expect(useUIConfigStore.getState().features.canvas).toBe(true);
  });

  it("falls back to defaults when ui-config fetch fails", async () => {
    vi.spyOn(api, "getUIConfig").mockRejectedValue(new Error("network"));

    await useUIConfigStore.getState().load();

    expect(useUIConfigStore.getState().branding).toEqual(DEFAULT_BRANDING);
    expect(useUIConfigStore.getState().features).toEqual(DEFAULT_UI_FEATURES);
    expect(useUIConfigStore.getState().loaded).toBe(true);
  });
});
