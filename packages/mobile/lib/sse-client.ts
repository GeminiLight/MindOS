/**
 * SSE (Server-Sent Events) client for React Native (Hermes).
 *
 * IMPORTANT: Hermes does NOT support ReadableStream or TextDecoder.
 * This implementation uses XMLHttpRequest with onprogress, which is
 * the only reliable way to get streaming data in React Native.
 *
 * MindOS agent turn SSE format (one JSON object per `data:` block):
 *   data:{"type":"text_delta","delta":"hello"}\n\n
 *   data:{"type":"done"}\n\n
 *
 * Wire framing (line splitting, CRLF, multi-line `data:`, comment lines,
 * chunk boundaries) is handled by the spec-compliant parser in
 * `./sse-parser`; this file only turns each frame's payload into an
 * `SSEEvent`.
 */

import { createSseParser, type SseFrame } from './sse-parser';
import type {
  Message,
  MessagePart,
  ReasoningPart,
  RuntimePermissionOption,
  RuntimePermissionRequest,
  RuntimePermissionState,
  ToolCallPart,
} from './types';

// ─── SSE Event Types ───────────────────────────────────────────

export type SSEEventType =
  | 'agent_run_context'
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_delta'
  | 'tool_end'
  | 'runtime_permission_request'
  | 'runtime_permission_resolved'
  | 'runtime_binding'
  | 'user_question_start'
  | 'user_question_answered'
  | 'user_question_cancelled'
  | 'done'
  | 'error'
  | 'status';

export interface SSEEvent {
  type: SSEEventType;
  delta?: string;
  runId?: string;
  requestId?: string;
  runtime?: 'mindos' | 'acp' | 'codex' | 'claude';
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  input?: unknown;
  options?: RuntimePermissionOption[];
  reason?: string;
  action?: string;
  resource?: string;
  risk?: RuntimePermissionRequest['risk'];
  decision?: string;
  cancelled?: boolean;
  decisionLabel?: string;
  decisionIntent?: RuntimePermissionState['decisionIntent'];
  decisionScope?: RuntimePermissionState['decisionScope'];
  output?: string;
  isError?: boolean;
  message?: string;
  usage?: { input: number; output: number };
}

export interface StreamConsumerCallbacks {
  onEvent: (event: SSEEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

// ─── XMLHttpRequest-based SSE Stream ───────────────────────────

/**
 * Stream SSE events from the agent session turn endpoint using XMLHttpRequest.
 * Returns a cancel function.
 */
export function streamChat(
  baseUrl: string,
  body: Record<string, unknown>,
  callbacks: StreamConsumerCallbacks,
  options: { authToken?: string } = {},
): () => void {
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : '';
  if (!sessionId) {
    callbacks.onError(new Error('sessionId is required for agent turns'));
    callbacks.onComplete();
    return () => {};
  }
  const { sessionId: _sessionId, ...turnBody } = body;
  let isClosed = false;
  let completed = false;
  let processedLength = 0;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/turns`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');
  if (options.authToken) {
    xhr.setRequestHeader('Authorization', `Bearer ${options.authToken}`);
  }

  const completeOnce = () => {
    if (completed) return;
    completed = true;
    callbacks.onComplete();
  };

  const processEvent = (event: SSEEvent) => {
    callbacks.onEvent(event);
    if (event.type === 'done' || event.type === 'error') {
      isClosed = true;
      completeOnce();
    }
  };

  const onFrame = (frame: SseFrame) => {
    // A single push() can dispatch several frames; anything after done/error
    // (or after cancel) must be dropped.
    if (isClosed) return;
    let event: SSEEvent;
    try {
      event = JSON.parse(frame.data) as SSEEvent;
    } catch {
      // Skip frames whose payload is not JSON.
      return;
    }
    processEvent(event);
  };

  const parser = createSseParser(onFrame);

  const responseErrorMessage = () => {
    const status = xhr.status || 0;
    const fallback = status ? `MindOS request failed with HTTP ${status}` : 'MindOS request failed';
    if (!xhr.responseText) return fallback;
    try {
      const data = JSON.parse(xhr.responseText) as { error?: unknown; message?: unknown };
      if (typeof data.message === 'string' && data.message) return data.message;
      if (typeof data.error === 'string' && data.error) return data.error;
    } catch {
      // Non-JSON response body; use HTTP status fallback.
    }
    return fallback;
  };

  xhr.onprogress = () => {
    if (isClosed) return;

    // Feed only the bytes that arrived since the last progress event; the
    // parser keeps partial lines / blocks across calls.
    const newData = xhr.responseText.slice(processedLength);
    processedLength = xhr.responseText.length;
    parser.push(newData);
  };

  xhr.onload = () => {
    if (!completed && xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
      isClosed = true;
      callbacks.onError(new Error(responseErrorMessage()));
      return;
    }

    if (!completed) {
      if (!isClosed) {
        // The final bytes can land without a trailing onprogress; drain them
        // before flushing so a truncated last frame is still delivered.
        parser.push(xhr.responseText.slice(processedLength));
        processedLength = xhr.responseText.length;
        parser.flush();
      }
      completeOnce();
    }
    isClosed = true;
  };

  xhr.onerror = () => {
    if (!isClosed) {
      callbacks.onError(new Error('Network error — check your connection'));
    }
    isClosed = true;
  };

  xhr.ontimeout = () => {
    if (!isClosed) {
      callbacks.onError(new Error('Request timed out'));
    }
    isClosed = true;
  };

  // 5 minute timeout for long-running agent tasks
  xhr.timeout = 300_000;

  try {
    xhr.send(JSON.stringify(turnBody));
  } catch (e) {
    callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    isClosed = true;
  }

  return () => {
    if (!isClosed) {
      isClosed = true;
      xhr.abort();
    }
  };
}

// ─── Message Builder ───────────────────────────────────────────

/**
 * Build a Message from accumulated SSE events.
 * Merges text_delta into content; structures tool calls into parts[].
 */
export class MessageBuilder {
  private parts: MessagePart[] = [];
  private currentText = '';
  private toolCalls = new Map<string, ToolCallPart>();
  private startedAt = Date.now();

  addTextDelta(delta: string): void {
    this.currentText += delta;
  }

  addThinkingDelta(delta: string): void {
    const last = this.parts[this.parts.length - 1];
    if (last && last.type === 'reasoning') {
      (last as ReasoningPart).text += delta;
    } else {
      this.parts.push({ type: 'reasoning', text: delta });
    }
  }

  addToolStart(toolCallId: string, toolName: string, args: unknown): void {
    const toolCall = this.findOrCreateToolCall(toolCallId, toolName);
    toolCall.toolName = toolName;
    toolCall.input = args;
    toolCall.state = 'running';
  }

  addToolEnd(toolCallId: string, output: string, isError: boolean): void {
    const tc = this.toolCalls.get(toolCallId);
    if (tc) {
      tc.output = output;
      tc.state = isError ? 'error' : 'done';
    }
  }

  addToolDelta(toolCallId: string, delta: string): void {
    const tc = this.toolCalls.get(toolCallId);
    if (tc) {
      tc.output = `${tc.output ?? ''}${delta}`;
    }
  }

  addRuntimePermissionRequest(event: SSEEvent): void {
    const runtime = normalizeRuntime(event.runtime);
    if (!event.toolCallId || !event.runId || !event.requestId || !runtime) return;

    const toolName = event.toolName || 'approval_request';
    const tc = this.findOrCreateToolCall(event.toolCallId, toolName);
    tc.toolName = toolName;
    tc.input = event.input ?? event.args ?? tc.input;
    tc.runtime = runtime;
    tc.runtimePermission = {
      type: 'runtime_permission_request',
      runId: event.runId,
      requestId: event.requestId,
      runtime,
      toolCallId: event.toolCallId,
      toolName,
      input: event.input ?? event.args,
      options: normalizePermissionOptions(event.options),
      status: 'waiting',
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.action ? { action: event.action } : {}),
      ...(event.resource ? { resource: event.resource } : {}),
      ...(normalizePermissionRisk(event.risk) ? { risk: normalizePermissionRisk(event.risk) } : {}),
    };
    tc.state = 'running';
  }

  addRuntimePermissionResolved(event: SSEEvent): void {
    if (!event.toolCallId) return;
    const runtime = normalizeRuntime(event.runtime);
    const tc = this.findOrCreateToolCall(event.toolCallId, event.toolName || 'approval_request');
    if (runtime) tc.runtime = runtime;

    if (!tc.runtimePermission && event.runId && event.requestId && runtime) {
      tc.runtimePermission = {
        type: 'runtime_permission_request',
        runId: event.runId,
        requestId: event.requestId,
        runtime,
        toolCallId: event.toolCallId,
        toolName: tc.toolName,
        options: [],
        status: 'waiting',
      };
    }

    const decision = typeof event.decision === 'string' ? event.decision : '';
    const decisionIntent = normalizePermissionIntent(event.decisionIntent);
    const denied = decisionIntent === 'deny' || decision === 'decline' || decision === 'deny' || decision === 'denied';

    if (tc.runtimePermission) {
      tc.runtimePermission.decision = decision;
      if (event.decisionLabel) tc.runtimePermission.decisionLabel = event.decisionLabel;
      if (decisionIntent) tc.runtimePermission.decisionIntent = decisionIntent;
      const decisionScope = normalizePermissionScope(event.decisionScope);
      if (decisionScope) tc.runtimePermission.decisionScope = decisionScope;
      tc.runtimePermission.status = event.cancelled
        ? 'cancelled'
        : denied
          ? 'denied'
          : 'approved';
    }

    if (event.cancelled || denied) {
      tc.state = 'error';
      tc.output = decision
        ? `Permission decision forwarded: ${decision}`
        : 'Permission decision forwarded.';
    }
  }

  /** Build the current snapshot of the assistant message. */
  build(): Message {
    return {
      role: 'assistant',
      content: this.currentText,
      parts: this.parts.length > 0 ? [...this.parts] : undefined,
      timestamp: this.startedAt,
    };
  }

  /** Finalize: mark unfinished tool calls as errored. */
  finalize(): Message {
    for (const tc of this.toolCalls.values()) {
      if (tc.state === 'running') {
        tc.state = 'error';
        tc.output = tc.output || 'Stream ended before tool completed';
      }
    }
    return this.build();
  }

  private findOrCreateToolCall(toolCallId: string, toolName: string): ToolCallPart {
    const existing = this.toolCalls.get(toolCallId);
    if (existing) return existing;
    const toolCall: ToolCallPart = {
      type: 'tool-call',
      toolCallId,
      toolName,
      input: {},
      state: 'running',
    };
    this.toolCalls.set(toolCallId, toolCall);
    this.parts.push(toolCall);
    return toolCall;
  }
}

function normalizeRuntime(runtime: SSEEvent['runtime']): 'codex' | 'claude' | undefined {
  return runtime === 'codex' || runtime === 'claude' ? runtime : undefined;
}

function normalizePermissionOptions(options: SSEEvent['options']): RuntimePermissionOption[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => option && typeof option.id === 'string' && typeof option.label === 'string')
    .map((option) => ({
      id: option.id,
      label: option.label,
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
      ...(normalizePermissionIntent(option.intent) ? { intent: normalizePermissionIntent(option.intent) } : {}),
      ...(normalizePermissionScope(option.scope) ? { scope: normalizePermissionScope(option.scope) } : {}),
    }));
}

function normalizePermissionIntent(intent: unknown): RuntimePermissionState['decisionIntent'] | undefined {
  return intent === 'allow' || intent === 'deny' || intent === 'cancel' ? intent : undefined;
}

function normalizePermissionScope(scope: unknown): RuntimePermissionState['decisionScope'] | undefined {
  return scope === 'once' || scope === 'session' || scope === 'always' || scope === 'turn'
    ? scope
    : undefined;
}

function normalizePermissionRisk(risk: unknown): RuntimePermissionRequest['risk'] | undefined {
  if (!risk || typeof risk !== 'object') return undefined;
  const record = risk as Record<string, unknown>;
  const level = record.level;
  if (level !== 'low' && level !== 'medium' && level !== 'high') return undefined;
  if (typeof record.summary !== 'string') return undefined;
  return {
    level,
    summary: record.summary,
    ...(Array.isArray(record.reasons)
      ? { reasons: record.reasons.filter((reason): reason is string => typeof reason === 'string') }
      : {}),
  };
}
