import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setBaseOverride } from "./api";

describe("api error handling", () => {
  afterEach(() => {
    setBaseOverride(null);
    vi.restoreAllMocks();
  });

  it("preserves status and response body for failed frontmatter patches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          'validation failed: frontmatter-yaml-invalid mapping key "last_reviewed" already defined',
          { status: 422, statusText: "Unprocessable Entity" }
        )
      )
    );

    setBaseOverride("/api/kiwi");

    await expect(api.patchFrontmatter("bad.md", { order: 1 })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      statusText: "Unprocessable Entity",
      body: 'validation failed: frontmatter-yaml-invalid mapping key "last_reviewed" already defined',
    });
  });
});
