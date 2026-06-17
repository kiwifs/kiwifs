import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, resolveBranding, resolveBrandingAssetUrl } from "./branding";

describe("resolveBrandingAssetUrl", () => {
  it("passes through absolute paths", () => {
    expect(resolveBrandingAssetUrl("/logo.png")).toBe("/logo.png");
  });

  it("passes through http URLs", () => {
    expect(resolveBrandingAssetUrl("https://cdn.example/logo.png")).toBe(
      "https://cdn.example/logo.png",
    );
  });

  it("maps workspace-relative paths to /raw/", () => {
    expect(resolveBrandingAssetUrl(".kiwi/assets/logo.png")).toBe(
      "/raw/.kiwi/assets/logo.png",
    );
  });
});

describe("resolveBranding", () => {
  it("returns defaults when config is empty", () => {
    expect(resolveBranding({})).toEqual(DEFAULT_BRANDING);
  });

  it("resolves custom branding fields", () => {
    const b = resolveBranding({
      name: "Acme KB",
      logoUrl: ".kiwi/assets/logo.png",
      welcomeTitle: "Welcome to Acme",
      welcomeMessage: "Get started.",
    });
    expect(b.name).toBe("Acme KB");
    expect(b.logoUrl).toBe("/raw/.kiwi/assets/logo.png");
    expect(b.welcomeTitle).toBe("Welcome to Acme");
    expect(b.hasCustomLogo).toBe(true);
  });
});
