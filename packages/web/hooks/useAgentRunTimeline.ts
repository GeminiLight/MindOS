'use client';

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AgentRunTimelinePart, AgentRunTimelineRecord, Message, MessagePart, TextPart } from '@/lib/types';

const TIMELINE_POLL_MS = 900;
const TURN_SINCE_PADDING_MS = 1000;

interface AgentRunsResponse {
  runs?: AgentRunTimelineRecord[];
}

export function buildAgentRunsTimelineUrl(input: {
  chatSessionId: string;
  rootRunId?: string | null;
  startedAfter?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams({
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

export function mergeAgentRunTimelineIntoMessages(
  messages: Message[],
  timeline: AgentRunTimelinePart,
): Message[] {
  if (timeline.runs.length === 0) return messages;

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) return messages;

  const target = messages[targetIndex];
  const existingParts = target.parts && target.parts.length > 0
    ? target.parts
    : target.content
      ? [{ type: 'text', text: target.content } satisfies TextPart]
      : [];
  const nextParts: MessagePart[] = [
    ...existingParts.filter((part) => part.type !== 'agent-run-timeline'),
    timeline,
  ];

  const previousTimeline = existingParts.find((part): part is AgentRunTimelinePart => part.type === 'agent-run-timeline');
  if (previousTimeline && serializeTimeline(previousTimeline) === serializeTimeline(timeline)) {
    return messages;
  }

  const next = [...messages];
  next[targetIndex] = {
    ...target,
    parts: nextParts,
  };
  return next;
}

function serializeTimeline(part: AgentRunTimelinePart): string {
  return JSON.stringify(part.runs.map((run) => ({
    id: run.id,
    status: run.status,
    outputSummary: run.outputSummary,
    error: run.error,
    durationMs: run.durationMs,
    completedAt: run.completedAt,
  })));
}

function latestUserMessageTimestamp(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      return typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now();
    }
  }
  return Date.now();
}

async function fetchAgentRuns(input: {
  chatSessionId: string;
  rootRunId?: string;
  startedAfter?: number;
  signal?: AbortSignal;
}): Promise<AgentRunTimelineRecord[]> {
  const url = buildAgentRunsTimelineUrl({
    chatSessionId: input.chatSessionId,
    ...(input.rootRunId ? { rootRunId: input.rootRunId } : {}),
    ...(input.startedAfter !== undefined ? { startedAfter: input.startedAfter } : {}),
  });
  const init: RequestInit = {
    cache: 'no-store',
    ...(input.signal ? { signal: input.signal } : {}),
  };
  try {
    const response = await fetch(url, init);
    if (!response.ok || typeof response.json !== 'function') return [];
    const body = await response.json() as AgentRunsResponse;
    return Array.isArray(body.runs) ? body.runs : [];
  } catch {
    return [];
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

  const applyRuns = useCallback((runs: AgentRunTimelineRecord[], chatSessionId: string, startedAfter: number, rootRunId?: string) => {
    const visibleRuns = runs.filter((run) => run.agentKind !== 'mindos-main');
    if (visibleRuns.length === 0) return;
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId,
      ...(rootRunId ? { rootRunId } : {}),
      startedAfter,
      runs: visibleRuns,
      updatedAt: Date.now(),
    };
    setMessagesRef.current((prev) => mergeAgentRunTimelineIntoMessages(prev, timeline));
  }, []);

  const refreshOnce = useCallback(async (chatSessionId: string, rootRunId?: string | null, signal?: AbortSignal) => {
    const startedAfter = ensureTurnStartedAfter();
    const runs = await fetchAgentRuns({
      chatSessionId,
      ...(rootRunId ? { rootRunId } : { startedAfter }),
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) return;
    applyRuns(runs, chatSessionId, startedAfter, rootRunId ?? undefined);
  }, [applyRuns, ensureTurnStartedAfter]);

  useEffect(() => {
    if (!input.visible || !input.chatSessionId || !input.isLoading) return;

    const chatSessionId = input.chatSessionId;
    const rootRunId = input.rootRunId;
    const controller = new AbortController();
    void refreshOnce(chatSessionId, rootRunId, controller.signal);
    const interval = setInterval(() => {
      void refreshOnce(chatSessionId, rootRunId, controller.signal);
    }, pollMs);

    return () => {
      clearInterval(interval);
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
