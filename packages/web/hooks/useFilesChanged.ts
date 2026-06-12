'use client';

import { useEffect, useRef } from 'react';
import { subscribeFilesChanged } from '@/lib/files-changed';

/**
 * React listener side of the `mindos:files-changed` contract
 * (see `@/lib/files-changed` for the shared contract and coalescing logic):
 *
 * - The event is a `CustomEvent` whose detail is `{ paths?: string[] }`.
 * - No detail (plain `Event`) = assume anything changed (backward compatible).
 * - Bursts within ~300ms coalesce into at most one `onChange` call.
 * - When every event in the burst declared `paths` and `isRelevant` returns
 *   false for their union, the refetch is skipped.
 *
 * `onChange` and `isRelevant` are read through refs, so callers may pass
 * inline functions without re-subscribing.
 */
export interface UseFilesChangedOptions {
  /** Subscribe only while true (e.g. the owning panel is visible). */
  enabled?: boolean;
  /**
   * Given the changed paths from a coalesced burst, return whether any of
   * them are relevant to this listener. Only consulted when paths are known;
   * events without detail always count as relevant.
   */
  isRelevant?: (paths: string[]) => boolean;
}

export function useFilesChanged(
  onChange: () => void,
  { enabled = true, isRelevant }: UseFilesChangedOptions = {},
): void {
  const onChangeRef = useRef(onChange);
  const isRelevantRef = useRef(isRelevant);
  useEffect(() => {
    onChangeRef.current = onChange;
    isRelevantRef.current = isRelevant;
  });

  useEffect(() => {
    if (!enabled) return;
    return subscribeFilesChanged(
      () => { onChangeRef.current(); },
      { isRelevant: (paths) => isRelevantRef.current?.(paths) ?? true },
    );
  }, [enabled]);
}
