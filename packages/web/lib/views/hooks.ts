'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { subscribeServerEvents } from '@/lib/server-events';
import { subscribeFilesChanged } from '@/lib/files-changed';
import { getViewsIndex, VIEWS_UPDATED, ViewsApiError } from './api';

/** A new request always supersedes the previous one, including focus and file events. */
export function useViewResource<T>(
  read: (signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: enabled });
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ data: previous.data, loading: true }));
    read(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            data: previous.data,
            error:
              error instanceof ViewsApiError ? error.code : 'NETWORK_ERROR',
            loading: false,
          }));
      });
    return () => controller.abort();
  }, [read, enabled, generation]);
  return { ...state, refresh };
}
export function useViewsIndex(active = true) {
  const read = useCallback((signal: AbortSignal) => getViewsIndex(signal), []);
  const result = useViewResource(read, active);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(result.refresh, 100);
    };
    const stop = subscribeFilesChanged(refresh);
    const stopViews = subscribeServerEvents('views.changed', refresh);
    window.addEventListener(VIEWS_UPDATED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      stop();
      stopViews();
      window.removeEventListener(VIEWS_UPDATED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [active, result.refresh]);
  return result;
}
export function viewHref(v: { id: string; lastPersonId?: string }) {
  return `/studio/views/${encodeURIComponent(v.id)}${v.lastPersonId ? `?person=${encodeURIComponent(v.lastPersonId)}` : ''}`;
}

/** Bind an open operation to its original library; reject late UI callbacks after a switch/unmount. */
export function useViewOperationScope(rootId: string) {
  const [boundRootId] = useState(rootId);
  const current = useRef({ rootId, mounted: true });
  useLayoutEffect(() => {
    current.current = { rootId, mounted: true };
    return () => {
      current.current.mounted = false;
    };
  }, [rootId]);
  const isMounted = useCallback(() => current.current.mounted, []);
  const isCurrent = useCallback(
    () => current.current.mounted && current.current.rootId === boundRootId,
    [boundRootId],
  );
  return {
    rootId: boundRootId,
    changed: rootId !== boundRootId,
    isMounted,
    isCurrent,
  };
}
