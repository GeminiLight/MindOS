import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { mindosClient } from '@/lib/api-client';
import {
  latestUserMessageTimestamp,
  mergeAgentRunTimelineIntoMessages,
} from '@/lib/agent-run-timeline';
import { startEventDrivenRefresh } from '@/lib/event-driven-refresh';
import type { Message } from '@/lib/types';

/** Fallback poll period, used only while the server event stream is not connected. */
const DEFAULT_POLL_MS = 1200;
const TURN_SINCE_PADDING_MS = 1000;
/** Matches the Web timeline: coalesce the burst a single tool call produces. */
const TIMELINE_EVENT_DEBOUNCE_MS = 150;
const TIMELINE_EVENT_TYPES = ['agent-run.event'] as const;

export function useAgentRunTimeline(input: {
  chatSessionId: string | null | undefined;
  enabled?: boolean;
  isStreaming: boolean;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  pollMs?: number;
  rootRunId?: string;
}): void {
  const pollMs = input.pollMs ?? DEFAULT_POLL_MS;
  const turnStartedAfterRef = useRef<number | null>(null);
  const wasStreamingRef = useRef(false);
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

  const refreshOnce = useCallback(async (chatSessionId: string, signal?: AbortSignal) => {
    const startedAfter = ensureTurnStartedAfter();
    // view=timeline: the server skips the observatory attachments and
    // precomputes the visible timeline with the ONE shared core projection
    // (spec-cross-process-run-events E/F).
    const payload = await mindosClient.getAgentRuns({
      chatSessionId,
      ...(input.rootRunId ? { rootRunId: input.rootRunId } : { startedAfter }),
      includeEvents: true,
      limit: 50,
      view: 'timeline',
      signal,
    }).catch(() => null);
    if (!payload || signal?.aborted) return;

    const timeline = payload.timeline ?? null;
    if (!timeline) return;
    setMessagesRef.current((prev) => mergeAgentRunTimelineIntoMessages(prev, timeline));
  }, [ensureTurnStartedAfter, input.rootRunId]);

  useEffect(() => {
    if (!input.enabled || !input.chatSessionId || !input.isStreaming) return;
    const chatSessionId = input.chatSessionId;
    const controller = new AbortController();
    const refresh = () => refreshOnce(chatSessionId, controller.signal);
    void refresh();
    // Events for this session drive the timeline while the stream is
    // connected; the poll only runs while it is not. AppState is not consulted
    // because this hook is already scoped to an in-progress turn, whose own
    // request is not gated on it either.
    const stop = startEventDrivenRefresh({
      eventTypes: TIMELINE_EVENT_TYPES,
      accept: (event) => event.type === 'agent-run.event' && event.chatSessionId === chatSessionId,
      refresh,
      debounceMs: TIMELINE_EVENT_DEBOUNCE_MS,
      fallbackPollMs: pollMs,
      isAppActive: () => true,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [input.chatSessionId, input.enabled, input.isStreaming, pollMs, refreshOnce]);

  useEffect(() => {
    if (
      wasStreamingRef.current
      && !input.isStreaming
      && input.enabled
      && input.chatSessionId
      && turnStartedAfterRef.current !== null
    ) {
      const chatSessionId = input.chatSessionId;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        void refreshOnce(chatSessionId, controller.signal);
      }, 250);
      wasStreamingRef.current = input.isStreaming;
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }
    wasStreamingRef.current = input.isStreaming;
    return undefined;
  }, [input.chatSessionId, input.enabled, input.isStreaming, refreshOnce]);
}
