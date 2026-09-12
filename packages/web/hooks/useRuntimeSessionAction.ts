'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Async history operations belong to the Agent and chat that started them. */
export function useRuntimeSessionAction(ownerKey: string) {
  const [actionId, setActionId] = useState<string | null>(null);
  const current = useRef({ generation: 0, busy: false });
  useLayoutEffect(() => {
    current.current.generation++; current.current.busy = false; setActionId(null);
    return () => { current.current.generation++; current.current.busy = false; };
  }, [ownerKey]);
  const execute = useCallback(async function execute<T>(id: string, operation: () => Promise<T>, apply: (value: T) => void, onError: (message: string) => void) {
    if (current.current.busy) return;
    const generation = ++current.current.generation;
    current.current.busy = true; setActionId(id);
    try {
      const value = await operation();
      if (current.current.generation === generation) apply(value);
    } catch (error) {
      if (current.current.generation === generation) onError(error instanceof Error ? error.message : 'Cannot open this session. Please retry.');
    } finally {
      if (current.current.generation === generation) { current.current.busy = false; setActionId(null); }
    }
  }, []);
  return { actionId, execute };
}
