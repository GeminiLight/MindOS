'use client';

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getServerEventsState, subscribeServerEvents } from '@/lib/server-events';
import {
  latestUserMessageTimestamp,
  mergeAgentRunTimelineIntoMessages,
  selectVisibleAgentRunTimeline,
} from '@geminilight/mindos/server/projections/agent-run-timeline';
import type { AgentRunTimelineEvent, AgentRunTimelineRecord, Message } from '@/lib/types';

/**
 * Fallback poll cadence, used only while the shared `/api/events` stream is
 * not connected. While it is connected, `agent-run.event` frames drive refreshes.
 */
export const TIMELINE_FALLBACK_POLL_MS = 5_000;
const TIMELINE_POLL_MS = TIMELINE_FALLBACK_POLL_MS;
/** Coalesces a burst of ledger events for one chat session into a single fetch. */
export const TIMELINE_EVENT_DEBOUNCE_MS = 150;
const TURN_SINCE_PADDING_MS = 1000;

interface AgentRunsResponse {
  runs?: AgentRunTimelineRecord[];
  events?: AgentRunTimelineEvent[];
}

// The visibility rules and merge semantics live in the core projection
// (spec-cross-process-run-events E) so Web, Mobile (via the server-computed
// `timeline` field) and `/api/agent-runs?view=timeline` share ONE
// implementation. Re-exported here for existing consumers and tests.
export { mergeAgentRunTimelineIntoMessages, selectVisibleAgentRunTimeline };

export function buildAgentRunsTimelineUrl(input: {
  chatSessionId: string;
  rootRunId?: string | null;
  startedAfter?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams({
    view: 'timeline',
    chatSessionId: input.chatSessionId,
    limit: String(input.limit ?? 50),
  });
  if (input.rootRunId) {
    params.set('rootRunId', input.rootRunId);
  } else if (input.startedAfter !== undefined) {
    params.set('startedAfter', String(input.startedAfter));
  }
  return `/api/agent-runs?${params.toString()}`;
}

async function fetchAgentRuns(input: {
  chatSessionId: string;
  rootRunId?: string;
  startedAfter?: number;
  signal?: AbortSignal;
}): Promise<AgentRunsResponse> {
  const baseUrl = buildAgentRunsTimelineUrl({
    chatSessionId: input.chatSessionId,
    ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
    ...(input.startedAfter !== undefined ? { startedAfter: input.startedAfter } : {}),
  });
  const url = `${baseUrl}&includeEvents=1`;
  const init: RequestInit = {
    cache: 'no-store',
    ...(input.signal ? { signal: input.signal } : {}),
  };
  try {
    const response = await fetch(url, init);
    if (!response.ok || typeof response.json !== 'function') return {};
    const body = await response.json() as AgentRunsResponse;
    return {
      runs: Array.isArray(body.runs) ? body.runs : [],
      events: Array.isArray(body.events) ? body.events : [],
    };
  } catch {
    return {};
  }
}

export function useAgentRunTimeline(input: {
  chatSessionId: string | null | undefined;
  rootRunId?: string | null;
  visible: boolean;
  isLoading: boolean;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  pollMs?: number;
}): void {
  const pollMs = input.pollMs ?? TIMELINE_POLL_MS;
  const turnStartedAfterRef = useRef<number | null>(null);
  const wasLoadingRef = useRef(false);
  const messagesRef = useRef(input.messages);
  const setMessagesRef = useRef(input.setMessages);

  useEffect(() => {
    messagesRef.current = input.messages;
    setMessagesRef.current = input.setMessages;
  }, [input.messages, input.setMessages]);

  useEffect(() => {
    turnStartedAfterRef.current = null;
  }, [input.chatSessionId]);

  const ensureTurnStartedAfter = useCallback(() => {
    if (turnStartedAfterRef.current !== null) return turnStartedAfterRef.current;
    const since = Math.max(0, latestUserMessageTimestamp(messagesRef.current) - TURN_SINCE_PADDING_MS);
    turnStartedAfterRef.current = since;
    return since;
  }, []);

  const applyTimeline = useCallback((payload: AgentRunsResponse, chatSessionId: string, startedAfter: number, rootRunId?: string) => {
    const timeline = selectVisibleAgentRunTimeline({
      payload,
      chatSessionId,
      startedAfter,
      ...(rootRunId ? { rootRunId } : {}),
    });
    if (!timeline) return;
    setMessagesRef.current((prev) => mergeAgentRunTimelineIntoMessages(prev, timeline));
  }, []);

  const refreshOnce = useCallback(async (chatSessionId: string, rootRunId?: string | null, signal?: AbortSignal) => {
    const startedAfter = ensureTurnStartedAfter();
    const payload = await fetchAgentRuns({
      chatSessionId,
      ...(rootRunId ? { rootRunId } : { startedAfter }),
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) return;
    applyTimeline(payload, chatSessionId, startedAfter, rootRunId ?? undefined);
  }, [applyTimeline, ensureTurnStartedAfter]);

  // Live path: the shared server stream reports ledger activity; refresh the
  // timeline for this chat session after a short debounce. One initial fetch
  // shows the timeline without waiting for the first event.
  useEffect(() => {
    if (!input.visible || !input.chatSessionId || !input.isLoading) return;

    const chatSessionId = input.chatSessionId;
    const rootRunId = input.rootRunId;
    const controller = new AbortController();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer !== null) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void refreshOnce(chatSessionId, rootRunId, controller.signal);
      }, TIMELINE_EVENT_DEBOUNCE_MS);
    };

    const unsubscribeEvents = subscribeServerEvents('agent-run.event', (event) => {
      if (event.chatSessionId !== chatSessionId) return;
      scheduleRefresh();
    });
    const unsubscribeReady = subscribeServerEvents('ready', (event) => {
      // The stream could not replay everything we missed: catch up once.
      if (event.resync) scheduleRefresh();
    });
    void refreshOnce(chatSessionId, rootRunId, controller.signal);

    return () => {
      unsubscribeEvents();
      unsubscribeReady();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [input.chatSessionId, input.isLoading, input.rootRunId, input.visible, refreshOnce]);

  // Degraded path: poll only while the stream is not connected (unsupported
  // environment or reconnecting). Background tabs skip the network call; the
  // visibilitychange handler issues a catch-up refresh when the tab returns.
  useEffect(() => {
    if (!input.visible || !input.chatSessionId || !input.isLoading) return;

    const chatSessionId = input.chatSessionId;
    const rootRunId = input.rootRunId;
    const controller = new AbortController();
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (getServerEventsState() === 'connected') return;
      void refreshOnce(chatSessionId, rootRunId, controller.signal);
    };
    const interval = setInterval(tick, pollMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.abort();
    };
  }, [input.chatSessionId, input.isLoading, input.rootRunId, input.visible, pollMs, refreshOnce]);

  useEffect(() => {
    if (wasLoadingRef.current && !input.isLoading && input.visible && input.chatSessionId && turnStartedAfterRef.current !== null) {
      const chatSessionId = input.chatSessionId;
      const rootRunId = input.rootRunId;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void refreshOnce(chatSessionId, rootRunId, controller.signal);
      }, 250);
      wasLoadingRef.current = input.isLoading;
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }
    wasLoadingRef.current = input.isLoading;
    return undefined;
  }, [input.chatSessionId, input.isLoading, input.rootRunId, input.visible, refreshOnce]);
}
