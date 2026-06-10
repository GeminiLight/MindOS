'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentRunTimelineEvent, AgentRunTimelinePart, AgentRunTimelineRecord, Message, MessagePart, TextPart } from '@/lib/types';

const TIMELINE_POLL_MS = 900;
const TURN_SINCE_PADDING_MS = 1000;

interface AgentRunsResponse {
  runs?: AgentRunTimelineRecord[];
  events?: AgentRunTimelineEvent[];
}

type AgentRunsStreamPayload = AgentRunsResponse;

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

export function buildAgentRunsTimelineStreamUrl(input: {
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
  return `/api/agent-runs/stream?${params.toString()}`;
}

export function mergeAgentRunTimelineIntoMessages(
  messages: Message[],
  timeline: AgentRunTimelinePart,
): Message[] {
  if (timeline.runs.length === 0) return messages;

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (canReceiveTimeline(messages[index], timeline)) {
      targetIndex = index;
      break;
    }
  }
  const cleaned = removeMatchingTimelineParts(messages, timeline, targetIndex);
  if (targetIndex < 0) return cleaned;

  const target = cleaned[targetIndex];
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
    return cleaned === messages ? messages : cleaned;
  }

  const next = cleaned === messages ? [...messages] : [...cleaned];
  next[targetIndex] = {
    ...target,
    parts: nextParts,
  };
  return next;
}

function canReceiveTimeline(message: Message, timeline: AgentRunTimelinePart): boolean {
  if (message.role !== 'assistant') return false;
  if (
    typeof timeline.startedAfter === 'number'
    && typeof message.timestamp === 'number'
    && message.timestamp < timeline.startedAfter
  ) {
    return false;
  }
  return true;
}

function isSameTimelineTurn(part: MessagePart, timeline: AgentRunTimelinePart): part is AgentRunTimelinePart {
  if (part.type !== 'agent-run-timeline') return false;
  if (part.chatSessionId !== timeline.chatSessionId) return false;
  if (timeline.rootRunId || part.rootRunId) return part.rootRunId === timeline.rootRunId;
  return part.startedAfter === timeline.startedAfter;
}

function removeMatchingTimelineParts(
  messages: Message[],
  timeline: AgentRunTimelinePart,
  keepIndex: number,
): Message[] {
  let changed = false;
  const next = messages.map((message, index) => {
    if (index === keepIndex || !message.parts?.some((part) => isSameTimelineTurn(part, timeline))) {
      return message;
    }
    const parts = message.parts.filter((part) => !isSameTimelineTurn(part, timeline));
    changed = true;
    const nextMessage: Message = { ...message };
    if (parts.length > 0) {
      nextMessage.parts = parts;
    } else {
      delete nextMessage.parts;
    }
    return nextMessage;
  });
  return changed ? next : messages;
}

function serializeTimeline(part: AgentRunTimelinePart): string {
  return JSON.stringify({
    runs: part.runs.map((run) => ({
      id: run.id,
      status: run.status,
      outputSummary: run.outputSummary,
      error: run.error,
      durationMs: run.durationMs,
      completedAt: run.completedAt,
    })),
    events: (part.events ?? []).map((event) => ({
      id: event.id,
      runId: event.runId,
      type: event.type,
      category: event.category,
      status: event.status,
      message: event.message,
      data: event.data,
      ts: event.ts,
    })),
  });
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
  const [streamUnavailable, setStreamUnavailable] = useState(false);
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
    const runs = Array.isArray(payload.runs) ? payload.runs : [];
    const visibleRuns = runs.filter((run) => run.agentKind !== 'mindos-main');
    const visibleRunIds = new Set(visibleRuns.map((run) => run.id));
    const visibleEvents = (payload.events ?? [])
      .filter((event) => visibleRunIds.has(event.runId))
      .filter((event) => event.visibility !== 'debug');
    if (visibleRuns.length === 0 && visibleEvents.length === 0) return;
    const timeline: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId,
      ...(rootRunId ? { rootRunId } : {}),
      startedAfter,
      runs: visibleRuns,
      ...(visibleEvents.length > 0 ? { events: visibleEvents } : {}),
      updatedAt: Date.now(),
    };
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

  useEffect(() => {
    if (!input.visible || !input.chatSessionId || !input.isLoading) return;

    const EventSourceConstructor = globalThis.EventSource;
    if (typeof EventSourceConstructor !== 'undefined' && !streamUnavailable) return;

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
  }, [input.chatSessionId, input.isLoading, input.rootRunId, input.visible, pollMs, refreshOnce, streamUnavailable]);

  useEffect(() => {
    if (!input.visible || !input.chatSessionId || !input.isLoading) return;

    const EventSourceConstructor = globalThis.EventSource;
    if (typeof EventSourceConstructor === 'undefined') {
      setStreamUnavailable(true);
      return;
    }

    const chatSessionId = input.chatSessionId;
    const rootRunId = input.rootRunId;
    const startedAfter = ensureTurnStartedAfter();
    const streamUrl = buildAgentRunsTimelineStreamUrl({
      chatSessionId,
      ...(rootRunId ? { rootRunId } : { startedAfter }),
    });
    let closed = false;
    setStreamUnavailable(false);

    const source = new EventSourceConstructor(streamUrl);
    source.onmessage = (event) => {
      if (closed) return;
      try {
        const payload = JSON.parse(event.data) as AgentRunsStreamPayload;
        if (!Array.isArray(payload.runs) && !Array.isArray(payload.events)) return;
        applyTimeline(payload, chatSessionId, startedAfter, rootRunId ?? undefined);
      } catch {
        // Ignore malformed stream frames; the polling fallback handles recovery if the stream fails.
      }
    };
    source.onerror = () => {
      if (closed) return;
      closed = true;
      source.close();
      setStreamUnavailable(true);
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [applyTimeline, ensureTurnStartedAfter, input.chatSessionId, input.isLoading, input.rootRunId, input.visible]);

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
