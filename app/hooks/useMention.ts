'use client';

import { useState, useCallback, useEffect } from 'react';

export function useMention() {
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Load file list once
  useEffect(() => {
    fetch('/api/files')
      .then((r) => r.json())
      .then(setAllFiles)
      .catch(() => {});
  }, []);

  /** Parse @-mention from input text; returns updated input if a mention was selected. */
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
      setMentionQuery(query);
      setMentionResults(allFiles.filter((f) => f.toLowerCase().includes(query)).slice(0, 8));
      setMentionIndex(0);
    },
    [allFiles],
  );

  const navigateMention = useCallback(
    (direction: 'up' | 'down') => {
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
