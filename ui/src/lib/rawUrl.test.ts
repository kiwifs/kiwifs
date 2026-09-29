import { afterEach, describe, expect, it, vi } from "vitest";
import { setBaseOverride, setCurrentSpace, setPrimarySpace } from "./api";
import { clearRawUrlCache, peekRawUrl, rawPathOf, resolveRawUrl } from "./rawUrl";

function signResponse(path: string, expiresInMs = 45 * 60 * 1000) {
  return new Response(
    JSON.stringify({
      path,
      url: `/raw/${path.split("/").map(encodeURIComponent).join("/")}?exp=123&sig=abc`,
      expires: new Date(Date.now() + expiresInMs).toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("rawUrl", () => {
  afterEach(() => {
    clearRawUrlCache();
    setBaseOverride(null);
    setCurrentSpace(null);
    setPrimarySpace(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts decoded paths only from /raw/ URLs", () => {
    expect(rawPathOf("/raw/notes/a%20b.png?x=1")).toBe("notes/a b.png");
    expect(rawPathOf("https://example.com/a.png")).toBeNull();
    expect(rawPathOf("/api/kiwi/file?path=a.png")).toBeNull();
    expect(rawPathOf(undefined)).toBeNull();
  });

  it("passes non-raw URLs through untouched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveRawUrl("https://cdn.example.com/x.png")).resolves.toBe("https://cdn.example.com/x.png");
    expect(peekRawUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs once per path and serves repeats from cache", async () => {
    const fetchMock = vi.fn(async () => signResponse("notes/a b.png"));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([resolveRawUrl("/raw/notes/a%20b.png"), resolveRawUrl("/raw/notes/a b.png")]);
    expect(a).toBe("/api/kiwi/raw/notes/a%20b.png?exp=123&sig=abc");
    expect(b).toBe(a);
    expect(peekRawUrl("/raw/notes/a%20b.png")).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/kiwi/raw-sign?path=notes%2Fa+b.png", expect.anything());
  });

  it("routes signed URLs through the current space", async () => {
    setPrimarySpace("main");
    setCurrentSpace("beta");
    const fetchMock = vi.fn(async () => signResponse("img.png"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveRawUrl("/raw/img.png")).resolves.toBe("/api/kiwi/beta/raw/img.png?exp=123&sig=abc");
    expect(fetchMock).toHaveBeenCalledWith("/api/kiwi/beta/raw-sign?path=img.png", expect.anything());
  });

  it("renews signatures that are close to expiry", async () => {
    const fetchMock = vi.fn(async () => signResponse("img.png", 60 * 1000));
    vi.stubGlobal("fetch", fetchMock);
    await resolveRawUrl("/raw/img.png");
    expect(peekRawUrl("/raw/img.png")).toBeUndefined();
    await resolveRawUrl("/raw/img.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the unsigned URL when signing fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    await expect(resolveRawUrl("/raw/blog/cover.png")).resolves.toBe("/raw/blog/cover.png");
  });
});
