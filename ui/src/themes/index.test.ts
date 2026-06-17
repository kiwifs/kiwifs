import { describe, expect, it } from "vitest";
import {
  builtinPresets,
  findPreset,
  mergeThemePresets,
  normalizePresetSlug,
} from "./index";

describe("theme presets", () => {
  it("normalizes default alias to kiwi", () => {
    expect(normalizePresetSlug("Default")).toBe("kiwi");
  });

  it("finds builtin presets by name or slug", () => {
    expect(findPreset("Ocean")?.id).toBe("ocean");
    expect(findPreset("kiwi")?.name).toBe("Kiwi");
    expect(findPreset("default")?.id).toBe("kiwi");
  });

  it("merges workspace presets with builtins", () => {
    const merged = mergeThemePresets([
      {
        id: "corporate-light",
        name: "Corporate Light",
        light: { background: "white" },
        dark: { background: "black" },
      },
    ]);
    expect(merged).toHaveLength(builtinPresets.length + 1);
    expect(findPreset("corporate-light", merged)?.source).toBe("workspace");
  });

  it("filters builtins when allowed list is set", () => {
    const merged = mergeThemePresets([], ["default", "ocean"]);
    expect(merged.map((p) => p.id)).toEqual(["kiwi", "ocean"]);
  });
});
