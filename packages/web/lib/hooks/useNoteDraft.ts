'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NoteDraft = { content: string; name: string; directory: string };

/** Per-tab recovery avoids two windows overwriting each other's new note. */
export function useNoteDraft(enabled: boolean, scope: string | undefined, value: NoteDraft, onRestore: (value: NoteDraft) => void) {
  const key = scope ? `mindos:note-draft:${scope}` : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const initial = useRef(value);
  const [recovered, setRecovered] = useState(false);
  const [error, setError] = useState(false);
  const cleared = useRef(false);
  const restore = useRef(onRestore);
  restore.current = onRestore;
  useEffect(() => {
    setLoadedKey(null); setError(false); setRecovered(false); cleared.current = false;
    if (!enabled || !key) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || !['content', 'name', 'directory'].every(field => typeof parsed[field] === 'string')) {
          throw new Error('Invalid draft');
        }
        restore.current({content: parsed.content, name: parsed.name, directory: parsed.directory});
        setRecovered(Boolean(parsed.content));
      } else { restore.current(initial.current); }
      setLoadedKey(key);
    } catch { setError(true); }
  }, [enabled, key]);
  useEffect(() => {
    if (!enabled || !key || loadedKey !== key || cleared.current) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ version: 1, ...value }));
      setError(false);
    } catch { setError(true); }
  }, [enabled, key, loadedKey, value.content, value.name, value.directory]);
  useEffect(() => {
    if (!enabled || !value.content || cleared.current || (!error && key)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [enabled, error, key, value.content]);
  const clear = useCallback(() => {
    cleared.current = true;
    try { if (key) sessionStorage.removeItem(key); } catch { setError(true); }
  }, [key]);
  return { recovered, error: enabled && (!key || error), clear };
}
