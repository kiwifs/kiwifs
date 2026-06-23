import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYBINDINGS,
  buildChordIndex,
  eventMatchesChord,
  formatChordDisplay,
  isTypingTarget,
  matchBoundAction,
  mergeKeybindings,
  normalizeChord,
  shortcutSearchValue,
} from "./kiwiKeybindings";

describe("normalizeChord", () => {
  it("canonicalizes modifier order and aliases", () => {
    expect(normalizeChord("Ctrl+Shift+B")).toBe("mod+shift+b");
    expect(normalizeChord("Mod+K")).toBe("mod+k");
    expect(normalizeChord("Escape")).toBe("escape");
  });
});

describe("eventMatchesChord", () => {
  it("matches mod shortcuts cross-browser", () => {
    const e = {
      key: "k",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent;
    expect(eventMatchesChord(e, "Mod+K")).toBe(true);
  });

  it("matches help shortcut on slash and question mark", () => {
    const slash = {
      key: "/",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent;
    const question = {
      key: "?",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent;
    expect(eventMatchesChord(slash, "Mod+/")).toBe(true);
    expect(eventMatchesChord(question, "Mod+/")).toBe(true);
  });
});

describe("mergeKeybindings", () => {
  it("keeps defaults when config is empty", () => {
    const merged = mergeKeybindings(null);
    expect(merged.search).toBe(DEFAULT_KEYBINDINGS.search);
  });

  it("applies server overrides", () => {
    const merged = mergeKeybindings({
      bindings: { search: "mod+j" },
      defaults: DEFAULT_KEYBINDINGS,
      conflicts: [],
    });
    expect(merged.search).toBe("mod+j");
    expect(merged.save).toBe(DEFAULT_KEYBINDINGS.save);
  });
});

describe("matchBoundAction", () => {
  it("returns the first matching action", () => {
    const bindings = mergeKeybindings({
      bindings: { graph: "mod+g" },
      defaults: DEFAULT_KEYBINDINGS,
      conflicts: [],
    });
    const e = {
      key: "g",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent;
    expect(matchBoundAction(e, bindings)).toBe("graph");
  });
});

describe("buildChordIndex", () => {
  it("groups actions by normalized chord", () => {
    const bindings = mergeKeybindings({
      bindings: { search: "mod+k", new_page: "mod+k" },
      defaults: DEFAULT_KEYBINDINGS,
      conflicts: [],
    });
    const index = buildChordIndex(bindings);
    expect(index.get("mod+k")?.sort()).toEqual(["new_page", "search"]);
  });
});

describe("formatChordDisplay", () => {
  it("formats mod shortcuts for display", () => {
    expect(formatChordDisplay("mod+k")).toMatch(/K/i);
  });
});

describe("shortcutSearchValue", () => {
  it("includes label, section, and chord for fuzzy filter", () => {
    const value = shortcutSearchValue("Navigation", "Search", "mod+k");
    expect(value.toLowerCase()).toContain("search");
    expect(value.toLowerCase()).toContain("navigation");
    expect(value.toLowerCase()).toContain("mod+k");
  });
});

describe("isTypingTarget", () => {
  it("detects editable and form controls", () => {
    const input = { tagName: "INPUT", isContentEditable: false } as HTMLElement;
    const textarea = { tagName: "TEXTAREA", isContentEditable: false } as HTMLElement;
    const editable = { tagName: "DIV", isContentEditable: true } as HTMLElement;
    const button = { tagName: "BUTTON", isContentEditable: false } as HTMLElement;
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
  });
});
