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
    (val: string) => {
      const atIdx = val.lastIndexOf('@');
      if (atIdx === -1) {
        setMentionQuery(null);
        return;
      }
      const before = val[atIdx - 1];
      if (atIdx > 0 && before !== ' ') {
        setMentionQuery(null);
        return;
      }
      const query = val.slice(atIdx + 1).toLowerCase();
      const filtered = allFiles.filter((f) => f.toLowerCase().includes(query)).slice(0, 8);
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
