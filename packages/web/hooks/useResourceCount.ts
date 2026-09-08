'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const COUNT_TIMEOUT_MS = 15_000;
export function useResourceCount(load: () => Promise<number>) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([load(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Count timed out')), COUNT_TIMEOUT_MS);
      })]);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid count');
      if (request.current === id) { setCount(value); setError(false); }
    } catch {
      // A failed refresh is stale/unknown data, not a successful empty result.
      if (request.current === id) setError(true);
    } finally { clearTimeout(timer); }
  }, [load]);
  return { count, error, refresh };
}
