import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import {
  applyPreferencesToLocal,
  mergePreferences,
  readLocalPreferences,
  type UserPreferences,
} from "../lib/userPreferences";

export type PreferencesState = {
  prefs: UserPreferences;
  loaded: boolean;
  /** True when server preferences are available for this user. */
  synced: boolean;
};

export function usePreferences(): PreferencesState & {
  updatePreferences: (patch: UserPreferences) => void;
} {
  const [prefs, setPrefs] = useState<UserPreferences>(() => readLocalPreferences());
  const [loaded, setLoaded] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const local = readLocalPreferences();

    api
      .getPreferences()
      .then((server) => {
        if (cancelled) return;
        const merged = mergePreferences(local, server);
        applyPreferencesToLocal(merged);
        setPrefs(merged);
        setSynced(true);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!(err instanceof ApiError) || err.status !== 401) {
          /* keep local fallback silently */
        }
        setPrefs(local);
        setSynced(false);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updatePreferences = useCallback((patch: UserPreferences) => {
    setPrefs((prev) => mergePreferences(prev, patch));
    applyPreferencesToLocal(patch);
    void api.putPreferences(patch).then((updated) => {
      setPrefs((prev) => mergePreferences(prev, updated));
      setSynced(true);
    }).catch(() => {
      /* localStorage already updated; server sync best-effort */
    });
  }, []);

  return { prefs, loaded, synced, updatePreferences };
}
