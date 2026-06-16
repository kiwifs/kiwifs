import { describe, expect, it, vi } from "vitest";
import { hasDeepLinkPath, resolveDashboardPath, resolveStartPage, shouldApplyStartPage } from "./startPage";

describe("resolveStartPage", () => {
  it("defaults empty to welcome", () => {
    expect(resolveStartPage(undefined)).toEqual({ mode: "welcome" });
    expect(resolveStartPage("")).toEqual({ mode: "welcome" });
    expect(resolveStartPage("welcome")).toEqual({ mode: "welcome" });
  });

  it("maps recent and dashboard modes", () => {
    expect(resolveStartPage("recent")).toEqual({ mode: "recent" });
    expect(resolveStartPage("dashboard")).toEqual({
      mode: "dashboard",
      path: "dashboard.md",
    });
  });

  it("treats other values as file paths", () => {
    expect(resolveStartPage("index.md")).toEqual({
      mode: "path",
      path: "index.md",
    });
    expect(resolveStartPage("pages/home.md")).toEqual({
      mode: "path",
      path: "pages/home.md",
    });
  });
});

describe("resolveDashboardPath", () => {
  it("prefers dashboard.md then pages/dashboard.md then index.md", () => {
    const tree = {
      path: "/",
      name: "/",
      isDir: true,
      children: [
        { path: "index.md", name: "index.md", isDir: false },
        { path: "pages/dashboard.md", name: "dashboard.md", isDir: false },
      ],
    };
    expect(resolveDashboardPath(tree)).toBe("pages/dashboard.md");

    const withRootDashboard = {
      ...tree,
      children: [
        { path: "dashboard.md", name: "dashboard.md", isDir: false },
        { path: "index.md", name: "index.md", isDir: false },
      ],
    };
    expect(resolveDashboardPath(withRootDashboard)).toBe("dashboard.md");
  });
});

describe("shouldApplyStartPage", () => {
  it("applies only when no active path and no deep link", () => {
    expect(shouldApplyStartPage(null, false)).toBe(true);
    expect(shouldApplyStartPage(null, true)).toBe(false);
    expect(shouldApplyStartPage("welcome.md", false)).toBe(false);
  });
});

describe("hasDeepLinkPath", () => {
  it("detects /page/ and hash routes", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/page/docs/readme.md", hash: "" },
    });
    expect(hasDeepLinkPath()).toBe(true);

    vi.stubGlobal("window", {
      location: { pathname: "/", hash: "#/notes/today.md" },
    });
    expect(hasDeepLinkPath()).toBe(true);

    vi.stubGlobal("window", {
      location: { pathname: "/", hash: "" },
    });
    expect(hasDeepLinkPath()).toBe(false);

    vi.unstubAllGlobals();
  });
});
