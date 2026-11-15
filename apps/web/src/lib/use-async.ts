/**
 * Data-loading primitives.
 *
 * Every screen must handle loading, empty, error and success states (plan §12),
 * so this hook returns all four explicitly instead of a bare `data` value.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError } from './api.js';

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** True while refetching with data already on screen (avoids layout flicker). */
  refreshing: boolean;
  reload: () => void;
  setData: (updater: T | ((current: T | undefined) => T | undefined)) => void;
}

export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const hasLoaded = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    if (hasLoaded.current) setRefreshing(true);
    else setLoading(true);

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (cancelled) return;
        setDataState(result);
        setError(undefined);
        hasLoaded.current = true;
      })
      .catch((caught: unknown) => {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setError(caught instanceof Error ? caught : new NetworkError(caught));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Callers pass an explicit dependency list; the spread is intentional.
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const setData = useCallback((updater: T | ((current: T | undefined) => T | undefined)) => {
    setDataState((current) =>
      typeof updater === 'function'
        ? (updater as (value: T | undefined) => T | undefined)(current)
        : updater,
    );
  }, []);

  return { data, error, loading, refreshing, reload, setData };
}

/** Track a single in-flight mutation with its error, for form submissions. */
export function useMutation<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  pending: boolean;
  error: Error | undefined;
  reset: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    setPending(true);
    setError(undefined);
    try {
      return await actionRef.current(...args);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new NetworkError(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, reset: () => setError(undefined) };
}

export function isUnauthorized(error: Error | undefined): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function errorMessage(error: Error | undefined): string | undefined {
  if (!error) return undefined;
  return error.message;
}
