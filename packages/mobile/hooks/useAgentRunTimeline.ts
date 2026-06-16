import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { mindosClient } from '@/lib/api-client';
import {
  latestUserMessageTimestamp,
  mergeAgentRunTimelineIntoMessages,
  selectVisibleAgentRunTimeline,
} from '@/lib/agent-run-timeline';
import type { Message } from '@/lib/types';

const DEFAULT_POLL_MS = 1200;
const TURN_SINCE_PADDING_MS = 1000;

export function useAgentRunTimeline(input: {
  chatSessionId: string | null | undefined;
  enabled?: boolean;
  isStreaming: boolean;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  pollMs?: number;
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
    const payload = await mindosClient.getAgentRuns({
      chatSessionId,
      startedAfter,
      includeEvents: true,
      limit: 50,
      signal,
    }).catch(() => null);
    if (!payload || signal?.aborted) return;

    const timeline = selectVisibleAgentRunTimeline({
      payload,
      chatSessionId,
      startedAfter,
    });
    if (!timeline) return;
    setMessagesRef.current((prev) => mergeAgentRunTimelineIntoMessages(prev, timeline));
  }, [ensureTurnStartedAfter]);

  useEffect(() => {
    if (!input.enabled || !input.chatSessionId || !input.isStreaming) return;
    const chatSessionId = input.chatSessionId;
    const controller = new AbortController();
    const tick = () => {
      void refreshOnce(chatSessionId, controller.signal);
    };
    tick();
    const interval = setInterval(tick, pollMs);
    return () => {
      clearInterval(interval);
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
