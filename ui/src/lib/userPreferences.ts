/** Per-user UI preferences synced with GET/PUT /api/kiwi/preferences. */

export type UserPreferences = {
  theme?: string;
  sidebar_collapsed?: boolean;
  default_view?: "editor" | "source";
  font_size?: "base" | "sm" | "lg";
  editor_line_numbers?: boolean;
  vim_mode?: boolean;
};

export const LS_PRESET = "kiwifs-preset";
export const LS_SIDEBAR = "kiwifs-sidebar";
export const LS_EDITOR_MODE = "kiwifs-editor-mode";

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

/** Read current localStorage-backed preferences (anonymous fallback). */
export function readLocalPreferences(): UserPreferences {
  const prefs: UserPreferences = {};
  const preset = readLS(LS_PRESET);
  if (preset) prefs.theme = preset;

  const sidebar = readLS(LS_SIDEBAR);
  if (sidebar === "collapsed") prefs.sidebar_collapsed = true;
  else if (sidebar === "open") prefs.sidebar_collapsed = false;

  const mode = readLS(LS_EDITOR_MODE);
  if (mode === "source") prefs.default_view = "source";
  else if (mode === "visual") prefs.default_view = "editor";

  return prefs;
}

/** Apply preference values to localStorage. Server values win when merging. */
export function applyPreferencesToLocal(prefs: UserPreferences): void {
  if (prefs.theme) writeLS(LS_PRESET, prefs.theme);

  if (prefs.sidebar_collapsed !== undefined) {
    writeLS(LS_SIDEBAR, prefs.sidebar_collapsed ? "collapsed" : "open");
  }

  if (prefs.default_view) {
    writeLS(LS_EDITOR_MODE, prefs.default_view === "source" ? "source" : "visual");
  }
}

/** Merge server preferences over localStorage (server wins on conflicts). */
export function mergePreferences(
  local: UserPreferences,
  server: UserPreferences,
): UserPreferences {
  return { ...local, ...server };
}

/** Convert a partial UI change into an API patch payload. */
export function toPreferencePatch(partial: UserPreferences): UserPreferences {
  return partial;
}
