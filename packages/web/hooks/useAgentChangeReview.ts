'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { isPathAffected } from '@/lib/files-changed';
import { useVisiblePolling } from '@/lib/use-visible-polling';
import { useFilesChanged } from '@/hooks/useFilesChanged';

export interface AgentReviewChangeEvent {
  id: string;
  ts: string;
  op: string;
  path: string;
  source: 'user' | 'agent' | 'system';
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
}

interface ChangeSummaryPayload {
  unreadCount: number;
  totalCount: number;
  lastSeenAt: string | null;
}

interface ChangeListPayload {
  events: AgentReviewChangeEvent[];
}

interface AgentChangeReviewState {
  loading: boolean;
  unreadCount: number;
  unreadAgentCount: number;
  unreviewedPathCount: number;
  unreviewedPaths: ReadonlySet<string>;
  unreviewedEvents: AgentReviewChangeEvent[];
  lastSeenAt: string | null;
}

interface UseAgentChangeReviewOptions {
  enabled?: boolean;
  path?: string;
  limit?: number;
}

const EMPTY_PATHS = new Set<string>();

const EMPTY_REVIEW_STATE: AgentChangeReviewState = {
  loading: true,
  unreadCount: 0,
  unreadAgentCount: 0,
  unreviewedPathCount: 0,
  unreviewedPaths: EMPTY_PATHS,
  unreviewedEvents: [],
  lastSeenAt: null,
};

function eventPaths(event: AgentReviewChangeEvent): string[] {
  return [event.path, event.beforePath, event.afterPath]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function isEventUnread(event: AgentReviewChangeEvent, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  const seenMs = new Date(lastSeenAt).getTime();
  const eventMs = new Date(event.ts).getTime();
  return Number.isFinite(eventMs) && (!Number.isFinite(seenMs) || eventMs > seenMs);
}

export function eventTouchesPath(event: AgentReviewChangeEvent, path: string): boolean {
  return eventPaths(event).some(candidate => isPathAffected([candidate], path));
}

export function useAgentChangeReview({
  enabled = true,
  path,
  limit = 120,
}: UseAgentChangeReviewOptions = {}) {
  const [state, setState] = useState<AgentChangeReviewState>(EMPTY_REVIEW_STATE);
  const mountedRef = useRef(true);
  const normalizedPath = path?.trim() || '';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchReview = useCallback(async () => {
    if (!enabled) {
      if (mountedRef.current) setState({ ...EMPTY_REVIEW_STATE, loading: false });
      return;
    }

    try {
      const params = new URLSearchParams({
        op: 'list',
        source: 'agent',
        limit: String(limit),
      });
      if (normalizedPath) params.set('path', normalizedPath);

      const [summary, list] = await Promise.all([
        apiFetch<ChangeSummaryPayload>('/api/changes?op=summary'),
        apiFetch<ChangeListPayload>(`/api/changes?${params.toString()}`),
      ]);
      const events = list.events.filter(event => event.source === 'agent');
      const unreviewedEvents = events.filter(event => isEventUnread(event, summary.lastSeenAt));
      const unreviewedPaths = new Set<string>();
      for (const event of unreviewedEvents) {
        for (const candidate of eventPaths(event)) unreviewedPaths.add(candidate);
      }

      if (!mountedRef.current) return;
      setState({
        loading: false,
        unreadCount: summary.unreadCount,
        unreadAgentCount: unreviewedEvents.length,
        unreviewedPathCount: unreviewedPaths.size,
        unreviewedPaths,
        unreviewedEvents,
        lastSeenAt: summary.lastSeenAt,
      });
    } catch {
      if (!mountedRef.current) return;
      setState({
        ...EMPTY_REVIEW_STATE,
        loading: false,
      });
    }
  }, [enabled, limit, normalizedPath]);

  useEffect(() => {
    void fetchReview();
  }, [fetchReview]);

  useVisiblePolling(() => void fetchReview(), 60_000, { enabled, immediate: false });
  useFilesChanged(() => void fetchReview(), {
    enabled,
    isRelevant: (paths) => normalizedPath ? paths.some(candidate => isPathAffected([candidate], normalizedPath)) : true,
  });

  const hasUnreviewedAgentChange = useCallback((targetPath: string) => {
    return state.unreviewedEvents.some(event => eventTouchesPath(event, targetPath));
  }, [state.unreviewedEvents]);

  const latestForPath = useCallback((targetPath: string) => {
    return state.unreviewedEvents.find(event => eventTouchesPath(event, targetPath)) ?? null;
  }, [state.unreviewedEvents]);

  return useMemo(() => ({
    ...state,
    refresh: fetchReview,
    hasUnreviewedAgentChange,
    latestForPath,
  }), [fetchReview, hasUnreviewedAgentChange, latestForPath, state]);
}
