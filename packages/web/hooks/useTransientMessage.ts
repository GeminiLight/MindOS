'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * State for short-lived UI feedback (hints, "Copied", "Saved") with one managed
 * reset timer. Scheduling a new reset cancels the previous one, so a stale timer
 * can never wipe a newer message, and the timer is cleared on unmount so a late
 * reset never touches an unmounted tree.
 *
 * Returns `[value, setValue, resetAfter]`: call `setValue(next)` as usual, then
 * `resetAfter(ms)` to schedule the return to `idleValue`.
 */
export function useTransientMessage<T>(idleValue: T): [T, Dispatch<SetStateAction<T>>, (ms: number) => void] {
  const [value, setValue] = useState<T>(idleValue);
  const idleRef = useRef(idleValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetAfter = useCallback((ms: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setValue(idleRef.current);
    }, ms);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return [value, setValue, resetAfter];
}
