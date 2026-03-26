'use client';

import { useState, useCallback, useEffect } from 'react';

function safeFetchFiles(): Promise<string[]> {
  return fetch('/api/files')
    .then((r) => (r.ok ? r.json() : []))
    .then((data) => (Array.isArray(data) ? data : []))
    .catch(() => [] as string[]);
}

export function useMention() {
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const loadFiles = useCallback(() => {
    safeFetchFiles().then(setAllFiles);
  }, []);

  useEffect(() => {
    loadFiles();
    const handler = () => loadFiles();
    window.addEventListener('mindos:files-changed', handler);
    return () => window.removeEventListener('mindos:files-changed', handler);
  }, [loadFiles]);

  const updateMentionFromInput = useCallback(
    (val: string, cursorPos?: number) => {
      const pos = cursorPos ?? val.length;
      const before = val.slice(0, pos);
      const atIdx = before.lastIndexOf('@');
      if (atIdx === -1) {
        setMentionQuery(null);
        return;
      }
      if (atIdx > 0 && before[atIdx - 1] !== ' ' && before[atIdx - 1] !== '\n') {
        setMentionQuery(null);
        return;
      }
      const query = before.slice(atIdx + 1);
      if (query.includes(' ') || query.includes('\n')) {
        setMentionQuery(null);
        setMentionResults([]);
        setMentionIndex(0);
        return;
      }
      const q = query.toLowerCase();
      const filtered = allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 30);
      if (filtered.length === 0) {
        setMentionQuery(null);
        setMentionResults([]);
        setMentionIndex(0);
        return;
      }
      setMentionQuery(query);
      setMentionResults(filtered);
      setMentionIndex(0);
    },
    [allFiles],
  );

  const navigateMention = useCallback(
    (direction: 'up' | 'down') => {
      if (mentionResults.length === 0) return;
      if (direction === 'down') {
        setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
      } else {
        setMentionIndex((i) => Math.max(i - 1, 0));
      }
    },
    [mentionResults.length],
  );

  const resetMention = useCallback(() => {
    setMentionQuery(null);
    setMentionResults([]);
    setMentionIndex(0);
  }, []);

  return {
    mentionQuery,
    mentionResults,
    mentionIndex,
    updateMentionFromInput,
    navigateMention,
    resetMention,
  };
}
