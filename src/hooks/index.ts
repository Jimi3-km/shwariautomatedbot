import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError } from '../lib/api';

/** Debounces a rapidly changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Set when the failure was an auth/permission problem, so pages can react. */
  forbidden: boolean;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Runs an async loader and models every state the UI must handle: loading,
 * success, empty, error, forbidden. Stale responses are discarded, so a slow
 * request cannot overwrite a newer one.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = []
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    setForbidden(false);

    loader(controller.signal)
      .then((result) => {
        if (gen !== generation.current) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (gen !== generation.current) return;
        if ((err as Error)?.name === 'AbortError') return;
        if (err instanceof ApiError) {
          setForbidden(err.isForbidden);
          setError(err.message);
        } else if (err instanceof NetworkError) {
          setError(err.message);
        } else {
          setError('Something went wrong.');
        }
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, forbidden, reload, setData };
}

/** Wraps a mutation with busy/error handling and a consistent error message. */
export function useMutation<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>
): { run: (...args: Args) => Promise<R | null>; busy: boolean; error: string | null; clearError: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (...args: Args) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof NetworkError
          ? err.message
          : 'Something went wrong.'
      );
      return null;
    } finally {
      setBusy(false);
    }
  }, [fn]);

  return { run, busy, error, clearError: () => setError(null) };
}

/** True when the viewport is at or below the given breakpoint. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 768px)');

/** Polls while the tab is visible; pauses when it is not, to avoid waste. */
export function useVisiblePolling(callback: () => void, intervalMs: number, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => saved.current(), intervalMs);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs, enabled]);
}
