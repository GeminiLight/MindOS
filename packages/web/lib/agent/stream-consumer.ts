/**
 * Parse the MindOS SSE stream into structured Message parts.
 *
 * MindOS SSE format (backend: route.ts):
 * - text_delta: { type, delta }
 * - thinking_delta: { type, delta } (Anthropic extended thinking)
 * - tool_start: { type, toolCallId, toolName, args }
 * - tool_delta/tool_end: { type, toolCallId, delta/output, isError }
 * - done: { type, usage? }
 * - error: { type, message }
 *
 * Frontend Message structure:
 * - role: 'assistant'
 * - content: concatenated text deltas (for display)
 * - parts: structured [TextPart | ReasoningPart | ToolCallPart | RuntimeStatusPart] (for detailed view)
 */
import type { Message, MessagePart, ToolCallPart, TextPart, ReasoningPart, RuntimeStatusPart, AskUserQuestion, AskUserQuestionAnswer } from '@/lib/types';
import { parseMindosSseLine } from '@geminilight/mindos/session';

/** Tools that modify files — trigger files-changed notification on completion */
const FILE_MUTATING_TOOLS = new Set([
  'write_file', 'create_file', 'batch_create_files',
  'append_to_file', 'insert_after_heading', 'update_section',
  'edit_lines', 'delete_file', 'rename_file', 'move_file',
  'append_csv', 'create_space',
]);

export interface RuntimeBindingMetadata {
  runtime: 'acp' | 'codex' | 'claude';
  externalSessionId: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
  reason?: string;
}

export interface AgentRunContextMetadata {
  rootRunId: string;
  chatSessionId?: string;
  startedAt: number;
}

export interface ConsumeUIMessageStreamOptions {
  onRuntimeBinding?: (binding: RuntimeBindingMetadata) => void;
  onAgentRunContext?: (context: AgentRunContextMetadata) => void;
}

/** Notify the app that files were changed by the AI agent */
function notifyFilesChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('mindos:files-changed'));
  }
}

function parseSseLineAsRecord(line: string): Record<string, unknown> | null {
  const parsed = parseMindosSseLine(line);
  if (parsed) return parsed as Record<string, unknown>;
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const fallback = JSON.parse(payload);
    return fallback && typeof fallback === 'object' && !Array.isArray(fallback)
      ? fallback as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isRuntimeBindingStatus(value: unknown): value is NonNullable<RuntimeBindingMetadata['status']> {
  return value === 'active'
    || value === 'missing'
    || value === 'signed-out'
    || value === 'archived'
    || value === 'failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeUserQuestionAnswers(value: unknown): AskUserQuestionAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((answer) => ({
    questionIndex: typeof answer.questionIndex === 'number' ? answer.questionIndex : -1,
    question: typeof answer.question === 'string' ? answer.question : '',
    kind: answer.kind === 'custom' || answer.kind === 'chat' || answer.kind === 'multi' ? answer.kind : 'option',
    answer: typeof answer.answer === 'string' ? answer.answer : null,
    ...(Array.isArray(answer.selected) ? { selected: answer.selected.filter((item): item is string => typeof item === 'string') } : {}),
    ...(typeof answer.notes === 'string' ? { notes: answer.notes } : {}),
    ...(typeof answer.preview === 'string' ? { preview: answer.preview } : {}),
  }));
}

function normalizeRuntime(value: unknown): ToolCallPart['runtime'] | undefined {
  return value === 'mindos' || value === 'acp' || value === 'codex' || value === 'claude'
    ? value
    : undefined;
}

function normalizeRuntimePermissionIntent(value: unknown): 'allow' | 'deny' | 'cancel' | undefined {
  return value === 'allow' || value === 'deny' || value === 'cancel' ? value : undefined;
}

function shortToolName(toolName: string): string {
  const parts = toolName.split('__');
  return parts[parts.length - 1] || toolName;
}

function isAskUserQuestionToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const normalized = shortToolName(toolName).replace(/[-_\s]/g, '').toLowerCase();
  return normalized === 'askuserquestion';
}

function isGenericToolCompletionOutput(output: string): boolean {
  return /^Codex item (completed|success|succeeded)$/i.test(output.trim());
}

function extractQuestionPayload(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (Array.isArray(input.questions)) return input.questions;
  if (isRecord(input.input) && Array.isArray(input.input.questions)) return input.input.questions;
  if (isRecord(input.params) && Array.isArray(input.params.questions)) return input.params.questions;
  if (isRecord(input.arguments) && Array.isArray(input.arguments.questions)) return input.arguments.questions;
  return undefined;
}

export async function consumeUIMessageStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (message: Message) => void,
  signal?: AbortSignal,
  options: ConsumeUIMessageStreamOptions = {},
): Promise<Message> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Mutable working copies
  const parts: MessagePart[] = [];
  const toolCalls = new Map<string, ToolCallPart>();
  let currentTextId: string | null = null;
  let currentReasoningPart: ReasoningPart | null = null;

  const startedAt = Date.now();

  /** Build an immutable Message snapshot from current parts */
  function buildMessage(): Message {
    const clonedParts: MessagePart[] = parts.map(p => {
      if (p.type === 'text') return { type: 'text' as const, text: p.text };
      if (p.type === 'reasoning') return { type: 'reasoning' as const, text: p.text };
      if (p.type === 'image') return { ...p };
      if (p.type === 'runtime-status') return { ...p };
      if (p.type === 'agent-run-timeline') {
        return {
          ...p,
          runs: p.runs.map(run => ({
            ...run,
            ...(run.metadata ? { metadata: { ...run.metadata } } : {}),
          })),
        };
      }
      // ToolCallPart — shallow copy safe (primitive fields, input is replaced not mutated)
      return {
        ...p,
        ...(p.userQuestion ? {
          userQuestion: {
            ...p.userQuestion,
            questions: p.userQuestion.questions.map(q => ({
              ...q,
              options: q.options.map(o => ({ ...o })),
            })),
            ...(p.userQuestion.answers ? { answers: p.userQuestion.answers.map(a => ({ ...a, selected: a.selected ? [...a.selected] : undefined })) } : {}),
          },
        } : {}),
        ...(p.runtimePermission ? {
          runtimePermission: {
            ...p.runtimePermission,
            options: p.runtimePermission.options.map(option => ({ ...option })),
          },
        } : {}),
      };
    });
    const textContent = clonedParts
      .filter((p): p is TextPart => p.type === 'text')
      .map(p => p.text)
      .join('');
    return {
      role: 'assistant',
      content: textContent,
      parts: clonedParts,
      timestamp: startedAt,
    };
  }

  /** Get or create the last text part with given ID */
  function findOrCreateTextPart(id: string): TextPart {
    if (currentTextId === id) {
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') return last;
    }
    const part: TextPart = { type: 'text', text: '' };
    parts.push(part);
    currentTextId = id;
    return part;
  }

  /** Get or create a tool call part */
  function findOrCreateToolCall(toolCallId: string, toolName?: string): ToolCallPart {
    let tc = toolCalls.get(toolCallId);
    if (!tc) {
      tc = {
        type: 'tool-call',
        toolCallId,
        toolName: toolName ?? 'unknown',
        input: undefined,
        state: 'pending',
      };
      toolCalls.set(toolCallId, tc);
      parts.push(tc);
      currentTextId = null;
    }
    return tc;
  }

  function upsertRuntimeStatus(message: string, runtime?: RuntimeStatusPart['runtime']): void {
    const last = parts[parts.length - 1];
    if (last?.type === 'runtime-status' && last.runtime === runtime) {
      last.message = message;
      return;
    }
    parts.push({
      type: 'runtime-status',
      message,
      ...(runtime ? { runtime } : {}),
    });
    currentTextId = null;
  }

  function normalizeUserQuestions(value: unknown): AskUserQuestion[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((question) => ({
        question: typeof question.question === 'string' ? question.question : '',
        header: typeof question.header === 'string' ? question.header : '',
        multiSelect: question.multiSelect === true,
        options: Array.isArray(question.options)
          ? question.options
              .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object' && !Array.isArray(option))
              .map(option => ({
                label: typeof option.label === 'string' ? option.label : '',
                description: typeof option.description === 'string' ? option.description : '',
                ...(typeof option.preview === 'string' ? { preview: option.preview } : {}),
              }))
          : [],
      }));
  }

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done && !buffer) break;
      if (!done) buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = done ? [buffer] : buffer.split('\n');
      buffer = done ? '' : lines.pop() ?? ''; // keep incomplete last line

      let changed = false;

      for (const line of lines) {
        const trimmed = line.trim();

        const eventRecord = parseSseLineAsRecord(trimmed);
        if (!eventRecord) continue;

        const type = typeof eventRecord.type === 'string' ? eventRecord.type : '';

        switch (type) {
          case 'agent_run_context': {
            if (typeof eventRecord.rootRunId !== 'string' || !eventRecord.rootRunId) break;
            options.onAgentRunContext?.({
              rootRunId: eventRecord.rootRunId,
              ...(typeof eventRecord.chatSessionId === 'string' ? { chatSessionId: eventRecord.chatSessionId } : {}),
              startedAt: typeof eventRecord.startedAt === 'number' && Number.isFinite(eventRecord.startedAt)
                ? eventRecord.startedAt
                : Date.now(),
            });
            break;
          }

          case 'text_delta': {
            // Regular text from assistant
            const part = findOrCreateTextPart('text');
            part.text += (eventRecord.delta as string) ?? '';
            changed = true;
            break;
          }

          case 'thinking_delta': {
            // Extended thinking (Anthropic)
            if (!currentReasoningPart) {
              currentReasoningPart = { type: 'reasoning', text: '' };
              parts.push(currentReasoningPart);
              currentTextId = null;
            }
            currentReasoningPart.text += (eventRecord.delta as string) ?? '';
            changed = true;
            break;
          }

          case 'tool_start': {
            // Beginning of tool execution
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const toolName = eventRecord.toolName as string;
            const tc = findOrCreateToolCall(toolCallId, toolName);
            tc.input = eventRecord.args;
            tc.runtime = normalizeRuntime(eventRecord.runtime);
            if (isAskUserQuestionToolName(toolName)) {
              const questions = normalizeUserQuestions(extractQuestionPayload(eventRecord.args));
              if (questions.length > 0) {
                const runId = typeof eventRecord.runId === 'string' ? eventRecord.runId : '';
                tc.userQuestion = {
                  runId,
                  questions,
                  status: 'waiting',
                  readOnly: !runId,
                  ...(tc.runtime ? { runtime: tc.runtime } : {}),
                };
              }
            }
            tc.state = 'running';
            changed = true;
            break;
          }

          case 'tool_delta': {
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const toolName = typeof eventRecord.toolName === 'string' ? eventRecord.toolName : undefined;
            const tc = findOrCreateToolCall(toolCallId, toolName);
            if (toolName && tc.toolName === 'unknown') tc.toolName = toolName;
            tc.runtime = normalizeRuntime(eventRecord.runtime) ?? tc.runtime;
            tc.output = `${tc.output ?? ''}${typeof eventRecord.delta === 'string' ? eventRecord.delta : ''}`;
            if (tc.state === 'pending') tc.state = 'running';
            changed = true;
            break;
          }

          case 'tool_end': {
            // Tool execution finished
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            // Use findOrCreateToolCall so tool_end still works even if tool_start was lost
            const tc = findOrCreateToolCall(toolCallId, eventRecord.toolName as string | undefined);
            if (typeof eventRecord.toolName === 'string' && eventRecord.toolName && tc.toolName === 'unknown') {
              tc.toolName = eventRecord.toolName;
            }
            tc.runtime = normalizeRuntime(eventRecord.runtime) ?? tc.runtime;
            const output = typeof eventRecord.output === 'string' ? eventRecord.output : '';
            const shouldPreserveExistingOutput = Boolean(
              tc.output &&
              !eventRecord.isError &&
              (!output || isGenericToolCompletionOutput(output)),
            );
            if (!shouldPreserveExistingOutput) {
              tc.output = output;
            }
            tc.state = (eventRecord.isError ? 'error' : 'done');
            if (eventRecord.isError && tc.userQuestion?.readOnly) {
              tc.userQuestion.status = 'cancelled';
              tc.userQuestion.reason = output || 'tool_error';
            }
            changed = true;
            // Notify when a file-modifying tool completes successfully
            if (!eventRecord.isError && FILE_MUTATING_TOOLS.has(tc.toolName)) {
              notifyFilesChanged();
            }
            break;
          }

          case 'runtime_permission_request': {
            const toolCallId = eventRecord.toolCallId as string;
            const runId = eventRecord.runId as string;
            const requestId = eventRecord.requestId as string;
            const runtime = normalizeRuntime(eventRecord.runtime);
            if (!toolCallId || !runId || !requestId || (runtime !== 'codex' && runtime !== 'claude')) break;
            const toolName = typeof eventRecord.toolName === 'string' && eventRecord.toolName ? eventRecord.toolName : 'approval_request';
            const tc = findOrCreateToolCall(toolCallId, toolName);
            tc.toolName = toolName;
            tc.input = eventRecord.input;
            tc.runtime = runtime;
            tc.runtimePermission = {
              runId,
              requestId,
              runtime,
              status: 'waiting',
              options: Array.isArray(eventRecord.options)
                ? eventRecord.options
                    .filter(isRecord)
                    .map(option => ({
                      id: typeof option.id === 'string' ? option.id : '',
                      label: typeof option.label === 'string' ? option.label : '',
                      ...(typeof option.description === 'string' ? { description: option.description } : {}),
                      ...(normalizeRuntimePermissionIntent(option.intent) ? { intent: normalizeRuntimePermissionIntent(option.intent) } : {}),
                    }))
                    .filter(option => option.id && option.label)
                : [],
              ...(typeof eventRecord.reason === 'string' ? { reason: eventRecord.reason } : {}),
            };
            tc.state = 'running';
            changed = true;
            break;
          }

          case 'runtime_permission_resolved': {
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const tc = findOrCreateToolCall(toolCallId, 'approval_request');
            tc.runtime = normalizeRuntime(eventRecord.runtime) ?? tc.runtime;
            const decision = typeof eventRecord.decision === 'string' ? eventRecord.decision : '';
            const denied = decision === 'decline' || decision === 'deny' || decision === 'denied';
            if (tc.runtimePermission) {
              tc.runtimePermission.decision = decision;
              tc.runtimePermission.status = eventRecord.cancelled === true
                ? 'cancelled'
                : denied
                  ? 'denied'
                  : 'approved';
            }
            if (eventRecord.cancelled === true || denied) {
              tc.state = 'error';
              tc.output = decision
                ? `Permission decision forwarded: ${decision}`
                : 'Permission decision forwarded.';
            }
            changed = true;
            break;
          }

          case 'user_question_start': {
            const toolCallId = eventRecord.toolCallId as string;
            const runId = eventRecord.runId as string;
            if (!toolCallId || !runId) break;
            const tc = findOrCreateToolCall(toolCallId, 'ask_user_question');
            tc.toolName = 'ask_user_question';
            tc.userQuestion = {
              runId,
              questions: normalizeUserQuestions(eventRecord.questions),
              status: 'waiting',
            };
            tc.state = 'running';
            changed = true;
            break;
          }

          case 'user_question_answered': {
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const tc = findOrCreateToolCall(toolCallId, 'ask_user_question');
            if (tc.userQuestion) {
              tc.userQuestion.status = 'submitted';
              tc.userQuestion.answers = normalizeUserQuestionAnswers(eventRecord.answers);
            }
            tc.state = 'done';
            changed = true;
            break;
          }

          case 'user_question_cancelled': {
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const tc = findOrCreateToolCall(toolCallId, 'ask_user_question');
            if (tc.userQuestion) {
              tc.userQuestion.status = 'cancelled';
              tc.userQuestion.reason = typeof eventRecord.reason === 'string' ? eventRecord.reason : undefined;
            }
            tc.state = 'error';
            tc.output = typeof eventRecord.reason === 'string' && eventRecord.reason
              ? eventRecord.reason
              : 'Question cancelled.';
            changed = true;
            break;
          }

          case 'runtime_binding': {
            const runtime = eventRecord.runtime;
            const externalSessionId = eventRecord.externalSessionId;
            if (
              (runtime === 'acp' || runtime === 'codex' || runtime === 'claude') &&
              typeof externalSessionId === 'string' &&
              externalSessionId
            ) {
              options.onRuntimeBinding?.({
                runtime,
                externalSessionId,
                ...(typeof eventRecord.cwd === 'string' ? { cwd: eventRecord.cwd } : {}),
                ...(isRuntimeBindingStatus(eventRecord.status) ? { status: eventRecord.status } : {}),
                ...(typeof eventRecord.reason === 'string' ? { reason: eventRecord.reason } : {}),
              });
            }
            break;
          }

          case 'status': {
            if (eventRecord.visible !== true || typeof eventRecord.message !== 'string' || !eventRecord.message.trim()) {
              break;
            }
            upsertRuntimeStatus(eventRecord.message.trim(), normalizeRuntime(eventRecord.runtime));
            changed = true;
            break;
          }

          case 'error': {
            // Stream error
            const message = eventRecord.message as string;
            parts.push({
              type: 'text',
              text: `\n\n**Stream Error:** ${message}`,
            });
            currentTextId = null;
            changed = true;
            break;
          }

          case 'done': {
            // Stream completed cleanly — usage data is optional
            // No state change needed; just marks end of SSE stream
            break;
          }

          default:
            // Ignore unknown event types
            break;
        }
      }

      // Emit once per reader batch, not per SSE line
      if (changed) {
        onUpdate(buildMessage());
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  // Finalize any tool calls still in running/pending state
  // (stream ended unexpectedly — abort, network error, step limit)
  let finalized = false;
  for (const tc of toolCalls.values()) {
    if (tc.state === 'running' || tc.state === 'pending') {
      tc.state = 'error';
      tc.output = tc.output ?? 'Stream ended before tool completed';
      finalized = true;
    }
  }
  if (finalized) {
    onUpdate(buildMessage());
  }

  return buildMessage();
}
