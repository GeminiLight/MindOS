export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import {
  listAgentEvents,
  listAgentRuns,
  subscribeAgentRunEvents,
  type AgentEvent,
  type AgentRunRecord,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  encodeMindosSseEvent,
  MINDOS_SSE_HEADERS,
  startMindosAgentTurnSseHeartbeat,
  type MindOSSSEvent,
} from '@geminilight/mindos/agent/turn';

const encoder = new TextEncoder();
const REPLAY_LIMIT = 1000;

function isTerminalStatus(status: AgentRunRecord['status']): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'canceled'
    || status === 'timed_out';
}

function runtimeKind(value: unknown): 'mindos' | 'acp' | 'codex' | 'claude' | undefined {
  return value === 'mindos' || value === 'acp' || value === 'codex' || value === 'claude'
    ? value
    : undefined;
}

function permissionRuntime(value: unknown): 'acp' | 'codex' | 'claude' | undefined {
  return value === 'acp' || value === 'codex' || value === 'claude'
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function eventMatchesFilter(event: AgentEvent, input: {
  chatSessionId: string;
  rootRunId: string;
}): boolean {
  const record = event.record;
  if (record.chatSessionId !== input.chatSessionId) return false;
  return record.rootRunId === input.rootRunId || record.id === input.rootRunId;
}

function listFilteredRuns(input: {
  chatSessionId: string;
  rootRunId: string;
}): AgentRunRecord[] {
  return listAgentRuns({
    chatSessionId: input.chatSessionId,
    rootRunId: input.rootRunId,
    limit: 500,
  });
}

function terminalEventForRuns(runs: AgentRunRecord[]): MindOSSSEvent | null {
  if (runs.length === 0 || runs.some((run) => !isTerminalStatus(run.status))) return null;
  const failed = runs.find((run) => run.status === 'failed' || run.status === 'timed_out' || run.status === 'canceled');
  if (!failed) return { type: 'done' };
  return {
    type: 'error',
    message: failed.error || (
      failed.status === 'timed_out'
        ? 'Agent run timed out.'
        : failed.status === 'canceled'
          ? 'Agent run was canceled.'
          : 'Agent run failed.'
    ),
  };
}

function textEventToMindos(event: AgentEvent): MindOSSSEvent | null {
  if (event.data?.kind !== 'text') return null;
  if (!event.data.text) return null;
  if (event.data.channel === 'reasoning') {
    return { type: 'thinking_delta', delta: event.data.text };
  }
  return { type: 'text_delta', delta: event.data.text };
}

function toolEventToMindos(event: AgentEvent): MindOSSSEvent | null {
  const data = event.data?.kind === 'tool' ? event.data : undefined;
  const toolCallId = event.toolCallId;
  if (!data || !toolCallId) return null;
  const runtime = runtimeKind(event.runtime);
  const toolName = event.toolName || data.name || 'tool';
  if (event.type === 'tool_started') {
    return {
      type: 'tool_start',
      toolCallId,
      toolName,
      args: data.inputSummary ?? event.message ?? {},
      ...(runtime ? { runtime } : {}),
    };
  }
  if (event.type === 'tool_updated') {
    return {
      type: 'tool_delta',
      toolCallId,
      toolName,
      delta: data.outputSummary ?? event.message ?? '',
      ...(runtime ? { runtime } : {}),
    };
  }
  if (event.type === 'tool_completed') {
    return {
      type: 'tool_end',
      toolCallId,
      toolName,
      output: data.error ?? data.outputSummary ?? event.message ?? '',
      isError: data.status === 'failed',
      ...(runtime ? { runtime } : {}),
    };
  }
  return null;
}

function permissionEventToMindos(event: AgentEvent): MindOSSSEvent | null {
  const data = event.data?.kind === 'permission' ? event.data : undefined;
  const runtime = permissionRuntime(event.runtime);
  const toolCallId = event.toolCallId;
  if (!data || !runtime || !toolCallId) return null;
  const metadata = asRecord(event.metadata);
  const requestId = data.requestId || stringValue(metadata?.requestId);
  const bridgeRunId = stringValue(metadata?.bridgeRunId) ?? event.runId;
  if (!requestId) return null;
  if (event.type === 'permission_requested') {
    return {
      type: 'runtime_permission_request',
      runId: bridgeRunId,
      requestId,
      runtime,
      toolCallId,
      toolName: event.toolName || data.action || 'approval_request',
      input: {
        ...(data.resource ? { resource: data.resource } : {}),
        ...(data.prompt ? { prompt: data.prompt } : {}),
      },
      options: data.options ?? [],
      ...(data.prompt ? { reason: data.prompt } : {}),
      ...(data.action ? { action: data.action } : {}),
      ...(data.resource ? { resource: data.resource } : {}),
      ...(data.risk ? { risk: data.risk } : {}),
    };
  }
  if (event.type === 'permission_resolved') {
    return {
      type: 'runtime_permission_resolved',
      runId: bridgeRunId,
      requestId,
      runtime,
      toolCallId,
      decision: data.decision ?? '',
      cancelled: data.status === 'expired',
      ...(data.decisionLabel ? { decisionLabel: data.decisionLabel } : {}),
      ...(data.decisionIntent ? { decisionIntent: data.decisionIntent } : {}),
      ...(data.decisionScope ? { decisionScope: data.decisionScope } : {}),
    };
  }
  return null;
}

function questionEventToMindos(event: AgentEvent): MindOSSSEvent | null {
  const data = event.data?.kind === 'question' ? event.data : undefined;
  const toolCallId = event.toolCallId;
  if (!data || !toolCallId) return null;
  const metadata = asRecord(event.metadata);
  const bridgeRunId = stringValue(metadata?.bridgeRunId) ?? event.runId;
  if (event.type === 'user_question_started') {
    return {
      type: 'user_question_start',
      runId: bridgeRunId,
      toolCallId,
      questions: metadata?.questions ?? data.prompt ?? [],
    };
  }
  if (event.type === 'user_question_resolved' && data.status === 'answered') {
    return {
      type: 'user_question_answered',
      runId: bridgeRunId,
      toolCallId,
      answers: metadata?.answers ?? [],
    };
  }
  if (event.type === 'user_question_resolved') {
    return {
      type: 'user_question_cancelled',
      runId: bridgeRunId,
      toolCallId,
      reason: data.summary ?? 'cancelled',
    };
  }
  return null;
}

function eventToMindos(event: AgentEvent): MindOSSSEvent | null {
  if (event.type === 'text') return textEventToMindos(event);
  if (event.category === 'tool') return toolEventToMindos(event);
  if (event.category === 'permission') return permissionEventToMindos(event);
  if (event.category === 'question') return questionEventToMindos(event);
  if (event.type === 'runtime_status' && event.message) {
    return {
      type: 'status',
      visible: true,
      message: event.message,
      ...(runtimeKind(event.runtime) ? { runtime: runtimeKind(event.runtime) } : {}),
    };
  }
  if (event.category === 'error' && event.message) {
    return { type: 'error', message: event.message };
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatSessionId = url.searchParams.get('chatSessionId')?.trim();
  const rootRunId = url.searchParams.get('rootRunId')?.trim();
  if (!chatSessionId || !rootRunId) {
    return new Response(JSON.stringify({ error: 'chatSessionId and rootRunId are required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const initialRuns = listFilteredRuns({ chatSessionId, rootRunId });
  const contextRun = initialRuns.find((run) => run.id === rootRunId || run.rootRunId === rootRunId) ?? initialRuns[0];
  if (!contextRun) {
    return new Response(JSON.stringify({ error: 'agent run was not found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const filter = { chatSessionId, rootRunId };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let replaying = true;
      const queuedLiveEvents: AgentEvent[] = [];
      const sentEventIds = new Set<string>();
      let stopHeartbeat: (() => void) | undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        stopHeartbeat?.();
        stopHeartbeat = undefined;
        unsubscribe();
        req.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      };

      const send = (event: MindOSSSEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeMindosSseEvent(event)));
        } catch {
          close();
        }
      };

      const sendLedgerEvent = (event: AgentEvent) => {
        if (sentEventIds.has(event.id)) return;
        sentEventIds.add(event.id);
        const mindosEvent = eventToMindos(event);
        if (mindosEvent) send(mindosEvent);
      };

      const sendTerminalIfReady = () => {
        const terminal = terminalEventForRuns(listFilteredRuns(filter));
        if (!terminal) return false;
        send(terminal);
        close();
        return true;
      };

      const unsubscribe = subscribeAgentRunEvents((event) => {
        if (!eventMatchesFilter(event, filter)) return;
        if (replaying) {
          queuedLiveEvents.push(event);
          return;
        }
        sendLedgerEvent(event);
        sendTerminalIfReady();
      });

      send({
        type: 'agent_run_context',
        rootRunId,
        chatSessionId,
        startedAt: contextRun.startedAt,
      });

      for (const event of listAgentEvents({
        chatSessionId,
        rootRunId,
        limit: REPLAY_LIMIT,
      }).reverse()) {
        sendLedgerEvent(event);
      }

      replaying = false;
      for (const event of queuedLiveEvents) {
        sendLedgerEvent(event);
      }
      queuedLiveEvents.length = 0;

      if (!sendTerminalIfReady()) {
        stopHeartbeat = startMindosAgentTurnSseHeartbeat(send, { onError: close });
      }

      if (req.signal.aborted) {
        close();
      } else {
        req.signal.addEventListener('abort', close);
      }
    },
  });

  return new Response(stream, {
    headers: MINDOS_SSE_HEADERS,
  });
}
