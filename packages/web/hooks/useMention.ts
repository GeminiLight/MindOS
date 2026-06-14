'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { fetchAllFilePaths } from '@/lib/client-cache';
import { subscribeFilesChanged } from '@/lib/files-changed';

const MENTION_RESULT_LIMIT = 30;

export interface MentionSearchEntry {
  path: string;
  lowerPath: string;
  lowerName: string;
}

interface MentionSearchHit {
  path: string;
  score: number;
}

function safeFetchFiles(): Promise<string[]> {
  // Shared cache + single-flight: simultaneous consumers of /api/files
  // (mention picker, plugin panels, ...) issue one request.
  return fetchAllFilePaths().catch(() => [] as string[]);
}

export function parseMentionQueryFromInput(val: string, cursorPos?: number): string | null {
  const pos = cursorPos ?? val.length;
  const before = val.slice(0, pos);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1) return null;
  if (atIdx > 0 && before[atIdx - 1] !== ' ' && before[atIdx - 1] !== '\n') return null;

  const query = before.slice(atIdx + 1);
  if (query.includes(' ') || query.includes('\n')) return null;
  return query;
}

export function createMentionSearchIndex(allFiles: string[]): MentionSearchEntry[] {
  return allFiles.map((path) => ({
    path,
    lowerPath: path.toLowerCase(),
    lowerName: (path.split('/').pop() ?? path).toLowerCase(),
  }));
}

function mentionScore(entry: MentionSearchEntry, query: string): number {
  if (entry.lowerName.startsWith(query)) return 100;
  if (entry.lowerName.includes(query)) return 50;
  if (entry.lowerPath.includes(query)) return 10;
  return 0;
}

function insertTopMentionHit(hits: MentionSearchHit[], hit: MentionSearchHit, limit: number): void {
  if (hits.length === limit && hit.score <= hits[hits.length - 1].score) return;

  let insertAt = hits.length;
  while (insertAt > 0 && hits[insertAt - 1].score < hit.score) {
    insertAt -= 1;
  }
  hits.splice(insertAt, 0, hit);
  if (hits.length > limit) hits.length = limit;
}

export function searchMentionFiles(
  index: MentionSearchEntry[],
  rawQuery: string,
  limit = MENTION_RESULT_LIMIT,
): string[] {
  const query = rawQuery.toLowerCase();
  if (!query) return index.slice(0, limit).map((entry) => entry.path);

  const hits: MentionSearchHit[] = [];
  for (const entry of index) {
    const score = mentionScore(entry, query);
    if (score > 0) insertTopMentionHit(hits, { path: entry.path, score }, limit);
  }
  return hits.map((hit) => hit.path);
}

export function useMention() {
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const searchIndex = useMemo(() => createMentionSearchIndex(allFiles), [allFiles]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);

  const loadFiles = useCallback(() => {
    safeFetchFiles().then(setAllFiles);
  }, []);

  useEffect(() => {
    loadFiles();
    // Any path change can affect mention candidates; coalesce bursts only.
    return subscribeFilesChanged(() => loadFiles());
  }, [loadFiles]);

  const updateMentionFromInput = useCallback(
    (val: string, cursorPos?: number) => {
      const query = parseMentionQueryFromInput(val, cursorPos);
      if (query === null) {
        setMentionQuery(null);
        setMentionResults([]);
        setMentionIndex(0);
        return;
      }
      const results = searchMentionFiles(searchIndex, query);
      if (results.length === 0) {
        setMentionQuery(null);
        setMentionResults([]);
        setMentionIndex(0);
        return;
      }
      setMentionQuery(query);
      setMentionResults(results);
      setMentionIndex(0);
    },
    [searchIndex],
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
