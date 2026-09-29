import { useEffect, useState } from "react";
import { api, apiBase } from "./api";

// <img>, <video> and <iframe> cannot send the Authorization header, so when
// auth is on the server only serves /raw/ URLs that carry a short-lived
// signature. Markdown keeps the stable /raw/<path> form; it is swapped for a
// signed URL at render time.

// Signatures live 30-60 minutes; renew early so a URL never expires mid-load.
const RENEW_MARGIN_MS = 5 * 60 * 1000;

const cache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();

/** Workspace path of a `/raw/...` URL, or null for any other URL. */
export function rawPathOf(src: string | undefined): string | null {
  if (!src || !src.startsWith("/raw/")) return null;
  const path = src.slice("/raw/".length).split(/[?#]/)[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function cacheKey(path: string): string {
  return `${apiBase()}\n${path}`;
}

/** Signed URL for src if one is cached and fresh; non-/raw/ URLs pass through. */
export function peekRawUrl(src: string | undefined): string | undefined {
  const path = rawPathOf(src);
  if (path === null) return src;
  const hit = cache.get(cacheKey(path));
  return hit && hit.expiresAt - Date.now() > RENEW_MARGIN_MS ? hit.url : undefined;
}

/**
 * Resolves a `/raw/...` URL to a signed URL for the current space. Falls back
 * to the original URL when signing fails, which still loads when auth is off
 * or the asset is public (an anonymous reader on a published page).
 */
export function resolveRawUrl(src: string): Promise<string> {
  const path = rawPathOf(src);
  if (path === null) return Promise.resolve(src);
  const fresh = peekRawUrl(src);
  if (fresh) return Promise.resolve(fresh);

  const key = cacheKey(path);
  let pending = inflight.get(key);
  if (!pending) {
    const base = apiBase();
    pending = api
      .signRawUrl(path)
      .then(
        (res) => {
          const query = res.url.slice(res.url.indexOf("?"));
          const url = `${base}/raw/${encodePath(res.path)}${query}`;
          cache.set(key, { url, expiresAt: Date.parse(res.expires) });
          return url;
        },
        () => src,
      )
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** undefined while a signature is being fetched, so no unsigned request fires. */
export function useRawUrl(src: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<{ src?: string; url?: string }>({});
  const isRaw = rawPathOf(src) !== null;

  useEffect(() => {
    if (!src || !isRaw) return;
    let cancelled = false;
    resolveRawUrl(src).then((url) => {
      if (!cancelled) setResolved({ src, url });
    });
    return () => {
      cancelled = true;
    };
  }, [src, isRaw]);

  if (!isRaw) return src;
  return resolved.src === src ? resolved.url : peekRawUrl(src);
}

export function clearRawUrlCache() {
  cache.clear();
  inflight.clear();
}
