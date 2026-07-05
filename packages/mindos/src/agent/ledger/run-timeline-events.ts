import {
  isHiddenMindosSseStatusEvent,
  type MindOSSSEvent,
} from '../turn/index.js';
import {
  appendAgentRunEvent,
} from './run-ledger.js';
import type {
  AgentEventData,
  AppendAgentEventInput,
} from './run-ledger-types.js';
import {
  redactSensitiveObject,
  redactSensitiveText,
} from '../redaction.js';

type PermissionOptionSummary = {
  id: string;
  label: string;
  intent?: 'allow' | 'deny' | 'cancel';
  scope?: 'once' | 'session' | 'always' | 'turn';
};

function safeAuditString(value: unknown): string {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value == null) return '';
  try {
    return redactSensitiveText(JSON.stringify(redactSensitiveObject(value)));
  } catch {
    return redactSensitiveText(String(value));
  }
}

function isNativeRuntimeStatus(event: Extract<MindOSSSEvent, { type: 'status' }>): boolean {
  return event.runtime === 'codex' || event.runtime === 'claude';
}

function isRoutineNativeRuntimeStatus(message: string): boolean {
  const normalized = message.trim();
  return /^Starting (Claude Code|Codex) locally\.$/.test(normalized)
    || /^Resuming (Claude Code|Codex) locally\.$/.test(normalized)
    || /^(Claude Code|Codex) is connected and working in this chat\.$/.test(normalized)
    || normalized === 'Claude Code is compacting context.'
    || normalized === 'Claude Code is contacting Claude.';
}

function permissionStatusFromDecision(input: {
  cancelled?: boolean;
  decision: string;
  decisionIntent?: 'allow' | 'deny' | 'cancel';
}): Extract<AgentEventData, { kind: 'permission' }>['status'] {
  if (input.cancelled || input.decisionIntent === 'cancel') return 'expired';
  if (input.decisionIntent === 'deny') return 'denied';
  if (input.decisionIntent === 'allow') return 'approved';
  const normalized = input.decision.toLowerCase();
  if (normalized === 'cancel' || normalized === 'cancelled' || normalized === 'canceled') return 'expired';
  if (normalized === 'decline' || normalized === 'deny' || normalized === 'denied' || normalized.includes('deny')) return 'denied';
  return 'approved';
}

function permissionOptionsSummary(options: Extract<MindOSSSEvent, { type: 'runtime_permission_request' }>['options']): PermissionOptionSummary[] {
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    ...(option.intent ? { intent: option.intent } : {}),
    ...(option.scope ? { scope: option.scope } : {}),
  }));
}

function append(runId: string, input: AppendAgentEventInput): void {
  appendAgentRunEvent(runId, input);
}

export function appendSseEventToAgentRun(runId: string, event: MindOSSSEvent): void {
  if (event.type === 'text_delta') {
    if (!event.delta.trim()) return;
    append(runId, {
      type: 'text',
      category: 'text',
      message: event.delta,
      data: { kind: 'text', text: event.delta, channel: 'assistant' },
      visibility: 'debug',
    });
    return;
  }
  if (event.type === 'thinking_delta') {
    if (!event.delta.trim()) return;
    append(runId, {
      type: 'text',
      category: 'text',
      message: event.delta,
      data: { kind: 'text', text: event.delta, channel: 'reasoning' },
      visibility: 'debug',
    });
    return;
  }
  if (event.type === 'tool_start') {
    append(runId, {
      type: 'tool_started',
      category: 'tool',
      message: event.toolName,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      ...(event.runtime ? { runtime: event.runtime } : {}),
      data: {
        kind: 'tool',
        name: event.toolName,
        status: 'started',
        inputSummary: safeAuditString(event.args),
      },
    });
    return;
  }
  if (event.type === 'tool_delta') {
    append(runId, {
      type: 'tool_updated',
      category: 'tool',
      message: event.delta,
      toolCallId: event.toolCallId,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(event.runtime ? { runtime: event.runtime } : {}),
      data: {
        kind: 'tool',
        name: event.toolName ?? 'tool',
        status: 'running',
        outputSummary: event.delta,
      },
      visibility: 'debug',
    });
    return;
  }
  if (event.type === 'tool_end') {
    append(runId, {
      type: 'tool_completed',
      category: 'tool',
      message: event.output,
      toolCallId: event.toolCallId,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(event.runtime ? { runtime: event.runtime } : {}),
      data: {
        kind: 'tool',
        name: event.toolName ?? 'tool',
        status: event.isError ? 'failed' : 'completed',
        ...(event.isError ? { error: event.output } : { outputSummary: event.output }),
      },
    });
    return;
  }
  if (event.type === 'runtime_permission_request') {
    const prompt = event.reason ?? event.resource ?? event.toolName;
    append(runId, {
      type: 'permission_requested',
      category: 'permission',
      message: prompt,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      runtime: event.runtime,
      metadata: {
        bridgeRunId: event.runId,
        requestId: event.requestId,
      },
      data: {
        kind: 'permission',
        action: event.action ?? event.toolName,
        status: 'requested',
        requestId: event.requestId,
        ...(event.resource ? { resource: event.resource } : {}),
        ...(prompt ? { prompt } : {}),
        options: permissionOptionsSummary(event.options),
        ...(event.risk ? { risk: event.risk } : {}),
      },
    });
    return;
  }
  if (event.type === 'runtime_permission_resolved') {
    const status = permissionStatusFromDecision(event);
    append(runId, {
      type: 'permission_resolved',
      category: 'permission',
      message: event.decision,
      toolCallId: event.toolCallId,
      runtime: event.runtime,
      metadata: {
        bridgeRunId: event.runId,
        requestId: event.requestId,
      },
      data: {
        kind: 'permission',
        action: event.toolCallId,
        status,
        requestId: event.requestId,
        decision: event.decision,
        ...(event.decisionLabel ? { decisionLabel: event.decisionLabel } : {}),
        ...(event.decisionIntent ? { decisionIntent: event.decisionIntent } : {}),
        ...(event.decisionScope ? { decisionScope: event.decisionScope } : {}),
      },
    });
    return;
  }
  if (event.type === 'user_question_start') {
    append(runId, {
      type: 'user_question_started',
      category: 'question',
      message: 'User question requested',
      toolCallId: event.toolCallId,
      metadata: {
        bridgeRunId: event.runId,
        questions: redactSensitiveObject(event.questions),
      },
      data: {
        kind: 'question',
        status: 'requested',
        prompt: safeAuditString(event.questions),
      },
    });
    return;
  }
  if (event.type === 'user_question_answered' || event.type === 'user_question_cancelled') {
    const metadata = event.type === 'user_question_answered'
      ? {
          bridgeRunId: event.runId,
          answers: redactSensitiveObject(event.answers ?? []),
        }
      : {
          bridgeRunId: event.runId,
        };
    append(runId, {
      type: 'user_question_resolved',
      category: 'question',
      message: event.type === 'user_question_cancelled' ? event.reason : 'User answered',
      toolCallId: event.toolCallId,
      metadata,
      data: {
        kind: 'question',
        status: event.type === 'user_question_cancelled' ? 'cancelled' : 'answered',
        summary: event.type === 'user_question_cancelled' ? event.reason : safeAuditString(event.answers ?? []),
      },
    });
    return;
  }
  if (event.type === 'status') {
    if (isHiddenMindosSseStatusEvent(event)) return;
    append(runId, {
      type: 'runtime_status',
      category: 'status',
      message: event.message,
      ...(event.runtime ? { runtime: event.runtime } : {}),
      data: {
        kind: 'status',
        nextStatus: 'running',
        summary: event.message,
      },
      ...(isNativeRuntimeStatus(event) && isRoutineNativeRuntimeStatus(event.message) ? { visibility: 'debug' as const } : {}),
    });
    return;
  }
  if (event.type === 'error') {
    append(runId, {
      type: 'error',
      category: 'error',
      message: event.message,
      data: {
        kind: 'error',
        message: event.message,
      },
    });
  }
}
