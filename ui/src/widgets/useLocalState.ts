import { useCallback, useEffect, useState } from "react";
import { api } from "@kw/lib/api";

export interface LocalStateResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Read-only access to a personal state document (`.me/<name>.json`).
 *
 * Exposed to `widget:live` so markdown widgets can render data the reader
 * has accumulated (progress, bookmarks, notes) without granting write access
 * or a general-purpose network escape hatch.
 */
export function useLocalState<T = Record<string, unknown>>(name: string): LocalStateResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getLocalState<T>(name)
      .then((state) => {
        if (cancelled) return;
        setData(state);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, nonce]);

  return { data, loading, error, reload };
}
