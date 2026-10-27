import { useEffect, useState } from "react";
import { describeApiError, isApiError, withServerWake } from "./api";

export interface ApiData<T> {
  data: T | null;
  loading: boolean;
  /** The API was asleep and is being woken; the request runs again once it answers. */
  waking: boolean;
  /** A sentence for the user, e.g. "Could not load work orders: ..." */
  error: string | null;
  /** The role may not read this (HTTP 403), as opposed to a failure. */
  forbidden: boolean;
  reload: () => void;
}

/**
 * Loads one section of a page on its own, so one failing request never
 * blanks the others. Re-runs when `deps` change or `reload()` is called.
 * `action` completes "Could not …", e.g. "load attendance".
 */
export function useApiData<T>(load: () => Promise<T>, deps: unknown[], action: string, enabled = true): ApiData<T> {
  const [state, setState] = useState<Omit<ApiData<T>, "reload">>({
    data: null, loading: enabled, waking: false, error: null, forbidden: false,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, waking: false, error: null, forbidden: false }));
    withServerWake(load, () => { if (!cancelled) setState((s) => ({ ...s, waking: true })); })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, waking: false, error: null, forbidden: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          data: null, loading: false, waking: false,
          error: describeApiError(err, action),
          forbidden: isApiError(err) && err.status === 403,
        });
      });
    return () => { cancelled = true; };
    // `load` is a fresh closure each render; `deps` lists what it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
