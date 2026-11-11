// After a redeploy, an open tab still references the old build's hashed
// chunks, which no longer exist. Every lazily loaded part of the page
// (Mermaid, widgets, editors) then fails with an import error. Reloading
// picks up the new build; the guard stops a loop if the reload doesn't help.

const KEY = "kiwi:stale-build-reload";
const WINDOW_MS = 30_000;

const PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Expected a JavaScript.*module script/i,
  /Unable to preload CSS/i,
];

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return PATTERNS.some((re) => re.test(msg));
}

/** Reload once to pick up a newer build. Returns false if we just tried. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still reload, the browser's own cache check bounds it.
  }
  window.location.reload();
  return true;
}

export function listenForStaleBuild(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
