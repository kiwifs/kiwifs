import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { useUIConfigStore } from "./uiConfigStore";

describe("uiConfigStore", () => {
  afterEach(() => {
    useUIConfigStore.setState({ themeLocked: false, loaded: false });
    vi.restoreAllMocks();
  });

  it("defaults themeLocked to false before load", () => {
    expect(useUIConfigStore.getState().themeLocked).toBe(false);
    expect(useUIConfigStore.getState().loaded).toBe(false);
  });

  it("stores themeLocked from ui-config when true", async () => {
    vi.spyOn(api, "getUIConfig").mockResolvedValue({ themeLocked: true });

    await useUIConfigStore.getState().load();

    expect(useUIConfigStore.getState().themeLocked).toBe(true);
    expect(useUIConfigStore.getState().loaded).toBe(true);
  });

  it("stores themeLocked as false when ui-config returns false", async () => {
    vi.spyOn(api, "getUIConfig").mockResolvedValue({ themeLocked: false });

    await useUIConfigStore.getState().load();

    expect(useUIConfigStore.getState().themeLocked).toBe(false);
    expect(useUIConfigStore.getState().loaded).toBe(true);
  });

  it("falls back to unlocked when ui-config fetch fails", async () => {
    vi.spyOn(api, "getUIConfig").mockRejectedValue(new Error("network"));

    await useUIConfigStore.getState().load();

    expect(useUIConfigStore.getState().themeLocked).toBe(false);
    expect(useUIConfigStore.getState().loaded).toBe(true);
  });
});
