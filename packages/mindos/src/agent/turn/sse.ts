/**
 * Agent-turn SSE wire surface: the MindOSSSEvent union, the event type list,
 * SSE headers, the heartbeat and the frame encoder. Split out of `index.ts`
 * (which stayed over the 1000-line budget); `index.ts` re-exports everything
 * here, so consumers keep importing from the barrel.
 */
export type MindOSSSEvent =
  | { type: 'agent_run_context'; rootRunId: string; chatSessionId?: string; startedAt: number }
  | {
      type: 'context_usage';
      runtime?: 'mindos' | 'acp' | 'codex' | 'claude';
      phase: 'preflight' | 'post';
      action:
        | 'none'
        | 'prompt_compacted'
        | 'prompt_truncated'
        | 'history_compacted'
        | 'history_pruned'
        | 'history_compacted_history_pruned'
        | 'prompt_compacted_history_compacted'
        | 'prompt_compacted_history_pruned'
        | 'prompt_compacted_history_compacted_history_pruned'
        | 'prompt_truncated_history_compacted'
        | 'prompt_truncated_history_pruned'
        | 'prompt_truncated_history_compacted_history_pruned';
      modelName?: string;
      percent: number;
      usedTokens: number;
      contextWindow: number;
      nativeContextWindow?: number;
      contextTokens?: number;
      contextWindowSource?: 'user' | 'catalog' | 'discovered' | 'pi-ai' | 'fallback' | 'model';
      contextWindowIsFallback?: boolean;
      budgetTokens: number;
      reserveTokens: number;
      keepRecentTokens?: number;
      systemPromptTokens: number;
      turnPromptTokens: number;
      historyTokens: number;
      originalUsedTokens?: number;
      originalHistoryTokens?: number;
      runtimeMessageCompaction?: boolean;
      compactedMessages?: number;
      historyCompactTokens?: number;
      historyBeforeCompactTokens?: number;
      prunedMessages?: number;
      message?: string;
    }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' }
  | { type: 'tool_delta'; toolCallId: string; delta: string; toolName?: string; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' }
  | { type: 'tool_end'; toolCallId: string; output: string; isError: boolean; toolName?: string; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' }
  | {
      type: 'runtime_permission_request';
      runId: string;
      requestId: string;
      runtime: 'acp' | 'codex' | 'claude';
      toolCallId: string;
      toolName: string;
      input: unknown;
      options: Array<{ id: string; label: string; description?: string; intent?: 'allow' | 'deny' | 'cancel'; scope?: 'once' | 'session' | 'always' | 'turn' }>;
      reason?: string;
      action?: string;
      resource?: string;
      risk?: { level: 'low' | 'medium' | 'high'; summary: string; reasons?: string[] };
    }
  | {
      type: 'runtime_permission_resolved';
      runId: string;
      requestId: string;
      runtime: 'acp' | 'codex' | 'claude';
      toolCallId: string;
      decision: string;
      cancelled?: boolean;
      decisionLabel?: string;
      decisionIntent?: 'allow' | 'deny' | 'cancel';
      decisionScope?: 'once' | 'session' | 'always' | 'turn';
    }
  | { type: 'user_question_start'; runId: string; toolCallId: string; questions: unknown }
  | { type: 'user_question_answered'; runId: string; toolCallId: string; answers?: unknown }
  | { type: 'user_question_cancelled'; runId: string; toolCallId: string; reason: string }
  | {
      type: 'runtime_binding';
      runtime: 'mindos' | 'acp' | 'codex' | 'claude';
      externalSessionId: string;
      cwd?: string;
      status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
      reason?: string;
    }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string; visible?: boolean; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' };

export const MINDOS_AGENT_TURN_STREAM_EVENT_TYPES = [
  'text_delta',
  'thinking_delta',
  'agent_run_context',
  'context_usage',
  'tool_start',
  'tool_delta',
  'tool_end',
  'runtime_permission_request',
  'runtime_permission_resolved',
  'user_question_start',
  'user_question_answered',
  'user_question_cancelled',
  'runtime_binding',
  'done',
  'error',
  'status',
] as const;

export const MINDOS_SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export const MINDOS_AGENT_TURN_SSE_HEARTBEAT_MS = 15_000;
export const MINDOS_AGENT_TURN_SSE_HEARTBEAT_EVENT: MindOSSSEvent = {
  type: 'status',
  visible: false,
  message: 'keep-alive',
};

export function isHiddenMindosSseStatusEvent(event: MindOSSSEvent): boolean {
  return event.type === 'status' && event.visible === false;
}

export function startMindosAgentTurnSseHeartbeat(
  write: (event: MindOSSSEvent) => void,
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): () => void {
  const requestedIntervalMs = options.intervalMs;
  const hasCustomInterval = typeof requestedIntervalMs === 'number'
    && Number.isFinite(requestedIntervalMs)
    && requestedIntervalMs > 0;
  const intervalMs = hasCustomInterval ? requestedIntervalMs : MINDOS_AGENT_TURN_SSE_HEARTBEAT_MS;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    try {
      write(MINDOS_AGENT_TURN_SSE_HEARTBEAT_EVENT);
    } catch (error) {
      stop();
      options.onError?.(error);
    }
  }, intervalMs);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  return stop;
}

export function encodeMindosSseEvent(event: MindOSSSEvent): string {
  return `data:${JSON.stringify(event)}\n\n`;
}
