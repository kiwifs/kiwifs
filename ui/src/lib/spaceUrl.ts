/**
 * Browser URLs for space-scoped pages.
 *
 * Two forms, and the distinction matters:
 *
 *   /page/{path}            — the primary space. Byte-identical to the
 *                             permalink the server hands out for published
 *                             pages and MCP, so those links keep working.
 *   /s/{space}/page/{path}  — any other space.
 *
 * The `/s/` marker is what makes this unambiguous. The older scheme put the
 * space in the first segment of `/page/`, which is indistinguishable from a
 * top-level folder of the same name and could only be resolved by asking the
 * server which names are spaces — asynchronously, after the page had already
 * rendered against the wrong space.
 */

export type SpaceLocation = {
  /** Space name, or null for the primary space. */
  space: string | null;
  /** Page path with no space segment, or null for the workspace root. */
  path: string | null;
};

const SPACE_PREFIX = "/s/";
const PAGE_PREFIX = "/page/";

function decodePath(raw: string): string | null {
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Malformed escape — fall back to the raw value rather than throwing
    // and blanking the page.
  }
  value = value.replace(/^\/+|\/+$/g, "");
  return value || null;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * Read the space and page path out of a location. Pure and synchronous —
 * no knowledge of which spaces exist is required.
 */
export function parseSpaceLocation(pathname: string, hash = ""): SpaceLocation {
  if (pathname.startsWith(SPACE_PREFIX)) {
    const rest = pathname.slice(SPACE_PREFIX.length);
    const slash = rest.indexOf("/");
    const rawSpace = slash < 0 ? rest : rest.slice(0, slash);
    const tail = slash < 0 ? "" : rest.slice(slash);
    let space: string | null = null;
    try {
      space = decodeURIComponent(rawSpace) || null;
    } catch {
      space = rawSpace || null;
    }
    if (tail.startsWith(PAGE_PREFIX)) {
      return { space, path: decodePath(tail.slice(PAGE_PREFIX.length)) };
    }
    return { space, path: null };
  }

  if (pathname.startsWith(PAGE_PREFIX)) {
    return { space: null, path: decodePath(pathname.slice(PAGE_PREFIX.length)) };
  }

  const legacyHash = hash.replace(/^#\/?/, "");
  if (legacyHash) return { space: null, path: decodePath(legacyHash) };

  return { space: null, path: null };
}

/** Canonical URL for a page in a space. */
export function buildSpaceLocation(
  space: string | null,
  path: string | null,
  primary: string | null,
): string {
  const inPrimary = !space || (primary !== null && space === primary);
  const root = inPrimary ? "/" : `${SPACE_PREFIX}${encodeURIComponent(space!)}/`;
  if (!path) return root;
  const encoded = encodePath(path);
  if (!encoded) return root;
  return inPrimary ? `${PAGE_PREFIX}${encoded}` : `${root.slice(0, -1)}${PAGE_PREFIX}${encoded}`;
}

/**
 * Query and fragment belong to whoever put them there — deep-linked playback
 * steps (`#?step=4`), heading anchors, theme overrides — not to routing. Keep
 * them when rewriting a URL so normalising the path does not silently discard
 * state that another part of the app has not read yet.
 *
 * The one exception is the superseded `#/{path}` route: that fragment *is* a
 * location, and leaving it in place would point at a page we just moved away
 * from. `keepHash` is false for in-app navigation, where the fragment
 * described the page being left.
 */
export function preservedUrlSuffix(search: string, hash: string, keepHash: boolean): string {
  if (!keepHash) return search;
  const isLegacyRoute = hash === "#" || hash === "#/" || hash.startsWith("#/");
  return search + (isLegacyRoute ? "" : hash);
}

/**
 * Space to activate for a location. The primary space is always represented as
 * null internally, so it has exactly one name and per-space state cannot split
 * between an alias and the real name.
 */
export function spaceForLocation(urlSpace: string | null, primary: string | null): string | null {
  if (!urlSpace) return null;
  if (primary !== null && urlSpace === primary) return null;
  return urlSpace;
}

export type HistoryWrite =
  | { kind: "none" }
  | { kind: "push"; url: string }
  | { kind: "replace"; url: string };

/**
 * Decide what to do to the address bar for a given app state.
 *
 * `normalising` means the entry already owns the current history slot — either
 * we are tidying the URL the app was opened with, or we are following
 * back/forward. In both cases the URL is rewritten in place; stacking a new
 * entry there would make the back button appear to do nothing.
 */
export function planHistoryWrite(params: {
  space: string | null;
  path: string | null;
  primary: string | null;
  location: { pathname: string; search: string; hash: string };
  normalising: boolean;
}): HistoryWrite {
  const { space, path, primary, location, normalising } = params;
  const suffix = preservedUrlSuffix(location.search, location.hash, normalising);
  const url = buildSpaceLocation(space, path, primary) + suffix;
  const current = location.pathname + location.search + location.hash;
  if (current === url) return { kind: "none" };
  return normalising ? { kind: "replace", url } : { kind: "push", url };
}

/**
 * Detect the superseded `/page/{space}/{path}` form so it can be migrated.
 * Requires the list of real space names because that scheme is ambiguous by
 * construction — this is the only place that ambiguity is tolerated, and only
 * to rewrite the URL into a form that no longer has it.
 */
export function parseLegacySpaceLocation(
  pathname: string,
  spaceNames: readonly string[],
  primary: string | null,
): SpaceLocation | null {
  if (!pathname.startsWith(PAGE_PREFIX)) return null;
  const raw = decodePath(pathname.slice(PAGE_PREFIX.length));
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash <= 0) return null;
  const candidate = raw.slice(0, slash);
  if (candidate === primary) return null;
  if (!spaceNames.includes(candidate)) return null;
  return { space: candidate, path: raw.slice(slash + 1) || null };
}
