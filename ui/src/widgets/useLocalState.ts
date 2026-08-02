import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@kw/lib/api";

export interface LocalStateResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  reload: () => void;
  save: (next: T) => Promise<void>;
}

/**
 * Read/write access to a personal state document (`.me/<name>.json`).
 *
 * Exposed to `widget:live` so markdown widgets can render and update data the
 * reader has accumulated (progress, bookmarks, plans). Writes are confined to
 * the caller's own state document — this is not a general-purpose network
 * escape hatch.
 *
 * `save` updates local data optimistically so widgets stay responsive, then
 * persists. A failed write surfaces through `error` and leaves the optimistic
 * value in place so the reader can retry rather than lose their edit; it never
 * rejects, so widget code can call it without wiring up error handling.
 */
export function useLocalState<T = Record<string, unknown>>(name: string): LocalStateResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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

  const save = useCallback(
    async (next: T) => {
      setData(next);
      setSaving(true);
      setError(null);
      try {
        await api.putLocalState(name, next);
      } catch (err: unknown) {
        if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    [name],
  );

  return { data, loading, error, saving, reload, save };
}
