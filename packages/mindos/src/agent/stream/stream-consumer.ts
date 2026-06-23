/**
 * Sunk from packages/web/lib/agent/stream-consumer.ts (Wave 4,
 * spec-agent-core-consolidation). Lives in the core package adjacent to the
 * native runtime transports (src/agent/runtime/) as the foundation for the
 * AgentRuntimeAdapter unification — hosts consume runtime SSE streams
 * through this one parser instead of growing per-runtime copies.
 *
 * Parse the MindOS SSE stream into structured Message parts.
 *
 * MindOS SSE format (backend: the /api/agent/sessions/:sessionId/turns route):
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
 *
 * Browser-safe: web-platform globals only (ReadableStream, TextDecoder,
 * setTimeout) — no node builtins. Host-side effects (the web's
 * "mindos:files-changed" window event) are injected via options.
 */
import type {
  AskUserQuestion,
  AskUserQuestionAnswer,
  Message,
  MessagePart,
  ReasoningPart,
  RuntimePermissionRisk,
  RuntimeStatusPart,
  TextPart,
  ToolCallPart,
} from './stream-message-types.js';
import { parseMindosSseLine } from '../turn/index.js';
import { redactSensitiveObject, redactSensitiveText } from '../redaction.js';

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

export interface ContextUsageMetadata {
  runtime?: 'mindos' | 'acp' | 'codex' | 'claude';
  phase: 'preflight' | 'post';
  action:
    | 'none'
    | 'prompt_compacted'
    | 'prompt_truncated'
    | 'history_pruned'
    | 'prompt_compacted_history_pruned'
    | 'prompt_truncated_history_pruned';
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
  prunedMessages?: number;
  message?: string;
}

/**
 * Host sink for "files changed during this run" notifications. The web host
 * forwards these to its coalesced window CustomEvent emitter; headless hosts
 * can ignore them. `queue` receives the touched paths when the tool input
 * exposed them (undefined = unknown, assume anything changed); `flush` is
 * called once when the stream ends.
 */
export interface FilesChangedSink {
  queue(paths?: readonly string[]): void;
  flush(): void;
}

export interface ConsumeUIMessageStreamOptions {
  onRuntimeBinding?: (binding: RuntimeBindingMetadata) => void;
  onAgentRunContext?: (context: AgentRunContextMetadata) => void;
  onContextUsage?: (usage: ContextUsageMetadata) => void;
  /**
   * Minimum interval between onUpdate emissions (leading emit + trailing
   * flush). Terminal state (completion/error/abort) always flushes
   * immediately. Pass 0 to emit per read batch (fine-grained consumers).
   * Default 50ms.
   */
  emitCoalesceMs?: number;
  /** Receives file-mutation notifications (web: window event emitter). */
  filesChanged?: FilesChangedSink;
}

/**
 * Extract the file paths a mutating tool touched from its input args.
 * Returns undefined when no recognizable path input exists — the
 * files-changed event then degrades to "unknown, assume anything changed".
 */
function collectMutatedPaths(input: unknown): string[] | undefined {
  if (!isRecord(input)) return undefined;
  const paths: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.push(value);
  };
  add(input.path);
  add(input.from_path);
  add(input.to_path);
  if (Array.isArray(input.files)) {
    for (const file of input.files) {
      if (isRecord(file)) add(file.path);
    }
  }
  // rename_file: the new path is the old directory + new_name.
  if (typeof input.new_name === 'string' && input.new_name.trim() && typeof input.path === 'string' && input.path.trim()) {
    const slash = input.path.lastIndexOf('/');
    add((slash >= 0 ? input.path.slice(0, slash + 1) : '') + input.new_name);
  }
  return paths.length > 0 ? paths : undefined;
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
    question: typeof answer.question === 'string' ? redactSensitiveText(answer.question) : '',
    kind: answer.kind === 'custom' || answer.kind === 'chat' || answer.kind === 'multi' ? answer.kind : 'option',
    answer: typeof answer.answer === 'string' ? redactSensitiveText(answer.answer) : null,
    ...(Array.isArray(answer.selected) ? { selected: answer.selected.filter((item): item is string => typeof item === 'string').map(redactSensitiveText) } : {}),
    ...(typeof answer.notes === 'string' ? { notes: redactSensitiveText(answer.notes) } : {}),
    ...(typeof answer.preview === 'string' ? { preview: redactSensitiveText(answer.preview) } : {}),
  }));
}

function normalizeRuntime(value: unknown): ToolCallPart['runtime'] | undefined {
  return value === 'mindos' || value === 'acp' || value === 'codex' || value === 'claude'
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeContextUsageAction(value: unknown): ContextUsageMetadata['action'] {
  if (
    value === 'prompt_compacted'
    || value === 'prompt_truncated'
    || value === 'history_pruned'
    || value === 'prompt_compacted_history_pruned'
    || value === 'prompt_truncated_history_pruned'
  ) {
    return value;
  }
  return 'none';
}

function normalizeContextWindowSource(value: unknown): ContextUsageMetadata['contextWindowSource'] {
  if (
    value === 'user'
    || value === 'catalog'
    || value === 'discovered'
    || value === 'pi-ai'
    || value === 'fallback'
    || value === 'model'
  ) {
    return value;
  }
  return undefined;
}

function normalizeContextUsage(eventRecord: Record<string, unknown>): ContextUsageMetadata | null {
  const percent = finiteNumber(eventRecord.percent);
  const usedTokens = finiteNumber(eventRecord.usedTokens);
  const contextWindow = finiteNumber(eventRecord.contextWindow);
  const budgetTokens = finiteNumber(eventRecord.budgetTokens);
  const reserveTokens = finiteNumber(eventRecord.reserveTokens);
  const systemPromptTokens = finiteNumber(eventRecord.systemPromptTokens);
  const turnPromptTokens = finiteNumber(eventRecord.turnPromptTokens);
  const historyTokens = finiteNumber(eventRecord.historyTokens);
  const nativeContextWindow = finiteNumber(eventRecord.nativeContextWindow);
  const contextTokens = finiteNumber(eventRecord.contextTokens);
  const contextWindowSource = normalizeContextWindowSource(eventRecord.contextWindowSource);
  const keepRecentTokens = finiteNumber(eventRecord.keepRecentTokens);
  const originalUsedTokens = finiteNumber(eventRecord.originalUsedTokens);
  const originalHistoryTokens = finiteNumber(eventRecord.originalHistoryTokens);
  const prunedMessages = finiteNumber(eventRecord.prunedMessages);
  if (
    percent === undefined
    || usedTokens === undefined
    || contextWindow === undefined
    || budgetTokens === undefined
    || reserveTokens === undefined
    || systemPromptTokens === undefined
    || turnPromptTokens === undefined
    || historyTokens === undefined
  ) {
    return null;
  }
  return {
    runtime: normalizeRuntime(eventRecord.runtime),
    phase: eventRecord.phase === 'post' ? 'post' : 'preflight',
    action: normalizeContextUsageAction(eventRecord.action),
    ...(typeof eventRecord.modelName === 'string' ? { modelName: redactSensitiveText(eventRecord.modelName) } : {}),
    percent,
    usedTokens,
    contextWindow,
    ...(nativeContextWindow !== undefined ? { nativeContextWindow } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(contextWindowSource ? { contextWindowSource } : {}),
    ...(typeof eventRecord.contextWindowIsFallback === 'boolean' ? { contextWindowIsFallback: eventRecord.contextWindowIsFallback } : {}),
    budgetTokens,
    reserveTokens,
    ...(keepRecentTokens !== undefined ? { keepRecentTokens } : {}),
    systemPromptTokens,
    turnPromptTokens,
    historyTokens,
    ...(originalUsedTokens !== undefined ? { originalUsedTokens } : {}),
    ...(originalHistoryTokens !== undefined ? { originalHistoryTokens } : {}),
    ...(prunedMessages !== undefined ? { prunedMessages } : {}),
    ...(typeof eventRecord.message === 'string' ? { message: redactSensitiveText(eventRecord.message) } : {}),
  };
}

function normalizeRuntimePermissionIntent(value: unknown): 'allow' | 'deny' | 'cancel' | undefined {
  return value === 'allow' || value === 'deny' || value === 'cancel' ? value : undefined;
}

function normalizeRuntimePermissionScope(value: unknown): 'once' | 'session' | 'always' | 'turn' | undefined {
  return value === 'once' || value === 'session' || value === 'always' || value === 'turn' ? value : undefined;
}

function normalizeRuntimePermissionRisk(value: unknown): RuntimePermissionRisk | undefined {
  if (!isRecord(value)) return undefined;
  const level = value.level === 'low' || value.level === 'medium' || value.level === 'high' ? value.level : undefined;
  const summary = typeof value.summary === 'string' ? redactSensitiveText(value.summary) : undefined;
  if (!level || !summary) return undefined;
  return {
    level,
    summary,
    ...(Array.isArray(value.reasons)
      ? { reasons: value.reasons.filter((reason): reason is string => typeof reason === 'string').map(redactSensitiveText) }
      : {}),
  };
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

  const filesChanged = options.filesChanged;

  // Mutable working copies
  const parts: MessagePart[] = [];
  const toolCalls = new Map<string, ToolCallPart>();
  let currentTextId: string | null = null;
  let currentReasoningPart: ReasoningPart | null = null;

  const startedAt = Date.now();

  /**
   * Structural sharing: cache the immutable clone of each mutable part and
   * reuse it across emissions until the part is mutated again (touch()).
   * Unchanged parts keep object identity so memoized children skip re-render.
   */
  const cloneCache = new Map<MessagePart, MessagePart>();

  /** Mark a mutable part as changed — its next snapshot gets a fresh clone. */
  function touch(part: MessagePart): void {
    cloneCache.delete(part);
  }

  function clonePart(p: MessagePart): MessagePart {
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
  }

  /** Build an immutable Message snapshot from current parts */
  function buildMessage(): Message {
    const clonedParts: MessagePart[] = parts.map(p => {
      const cached = cloneCache.get(p);
      if (cached) return cached;
      const clone = clonePart(p);
      cloneCache.set(p, clone);
      return clone;
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

  // ---------------------------------------------------------------------------
  // Emit coalescing: streaming runs can deliver hundreds of chunks per second;
  // emitting per read batch made rendering O(L²). Leading emit + trailing
  // flush within emitCoalesceMs; terminal state always flushes immediately.
  const emitCoalesceMs = options.emitCoalesceMs ?? 50;
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEmit = false;
  let runEnded = false;

  function emitNow(): void {
    pendingEmit = false;
    lastEmitAt = Date.now();
    onUpdate(buildMessage());
  }

  function scheduleEmit(): void {
    if (emitCoalesceMs <= 0) {
      emitNow();
      return;
    }
    if (trailingTimer === null && Date.now() - lastEmitAt >= emitCoalesceMs) {
      emitNow(); // leading edge — first chunk renders without delay
      return;
    }
    pendingEmit = true;
    if (trailingTimer === null) {
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        if (!runEnded && pendingEmit) emitNow();
      }, emitCoalesceMs);
    }
  }

  /** Terminal flush — completion/error/abort must never be delayed. */
  function flushEmit(): void {
    runEnded = true;
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    if (pendingEmit) emitNow();
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
    const safeMessage = redactSensitiveText(message);
    const last = parts[parts.length - 1];
    if (last?.type === 'runtime-status' && last.runtime === runtime) {
      last.message = safeMessage;
      touch(last);
      return;
    }
    parts.push({
      type: 'runtime-status',
      message: safeMessage,
      ...(runtime ? { runtime } : {}),
    });
    currentTextId = null;
  }

  function normalizeUserQuestions(value: unknown): AskUserQuestion[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((question) => ({
        question: typeof question.question === 'string' ? redactSensitiveText(question.question) : '',
        header: typeof question.header === 'string' ? redactSensitiveText(question.header) : '',
        multiSelect: question.multiSelect === true,
        options: Array.isArray(question.options)
          ? question.options
              .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object' && !Array.isArray(option))
              .map(option => ({
                label: typeof option.label === 'string' ? redactSensitiveText(option.label) : '',
                description: typeof option.description === 'string' ? redactSensitiveText(option.description) : '',
                ...(typeof option.preview === 'string' ? { preview: redactSensitiveText(option.preview) } : {}),
              }))
          : [],
      }));
  }

  // Cancelling the reader is the only way to interrupt a pending read();
  // the aborted check at the top of the loop can't fire while the stream is
  // quiet, which left aborted runs awaiting a read that never resolves.
  const cancelOnAbort = () => { void reader.cancel().catch(() => {}); };
  if (signal?.aborted) {
    cancelOnAbort();
  } else {
    signal?.addEventListener('abort', cancelOnAbort, { once: true });
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

          case 'context_usage': {
            const usage = normalizeContextUsage(eventRecord);
            if (usage) options.onContextUsage?.(usage);
            break;
          }

          case 'text_delta': {
            // Regular text from assistant
            const part = findOrCreateTextPart('text');
            part.text += (eventRecord.delta as string) ?? '';
            touch(part);
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
            touch(currentReasoningPart);
            changed = true;
            break;
          }

          case 'tool_start': {
            // Beginning of tool execution
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const toolName = eventRecord.toolName as string;
            const tc = findOrCreateToolCall(toolCallId, toolName);
            const safeArgs = redactSensitiveObject(eventRecord.args);
            tc.input = safeArgs;
            tc.runtime = normalizeRuntime(eventRecord.runtime);
            if (isAskUserQuestionToolName(toolName)) {
              const questions = normalizeUserQuestions(extractQuestionPayload(safeArgs));
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
            touch(tc);
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
            tc.output = `${tc.output ?? ''}${typeof eventRecord.delta === 'string' ? redactSensitiveText(eventRecord.delta) : ''}`;
            if (tc.state === 'pending') tc.state = 'running';
            touch(tc);
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
            const output = typeof eventRecord.output === 'string' ? redactSensitiveText(eventRecord.output) : '';
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
            touch(tc);
            changed = true;
            // Notify when a file-modifying tool completes successfully —
            // batched into one files-changed notification per run.
            if (!eventRecord.isError && FILE_MUTATING_TOOLS.has(tc.toolName)) {
              filesChanged?.queue(collectMutatedPaths(tc.input));
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
            tc.input = redactSensitiveObject(eventRecord.input);
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
                      label: typeof option.label === 'string' ? redactSensitiveText(option.label) : '',
                      ...(typeof option.description === 'string' ? { description: redactSensitiveText(option.description) } : {}),
                      ...(normalizeRuntimePermissionIntent(option.intent) ? { intent: normalizeRuntimePermissionIntent(option.intent) } : {}),
                      ...(normalizeRuntimePermissionScope(option.scope) ? { scope: normalizeRuntimePermissionScope(option.scope) } : {}),
                    }))
                    .filter(option => option.id && option.label)
                : [],
              ...(typeof eventRecord.reason === 'string' ? { reason: redactSensitiveText(eventRecord.reason) } : {}),
              ...(typeof eventRecord.action === 'string' ? { action: redactSensitiveText(eventRecord.action) } : {}),
              ...(typeof eventRecord.resource === 'string' ? { resource: redactSensitiveText(eventRecord.resource) } : {}),
              ...(normalizeRuntimePermissionRisk(eventRecord.risk) ? { risk: normalizeRuntimePermissionRisk(eventRecord.risk) } : {}),
            };
            tc.state = 'running';
            touch(tc);
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
              if (typeof eventRecord.decisionLabel === 'string') tc.runtimePermission.decisionLabel = redactSensitiveText(eventRecord.decisionLabel);
              const decisionIntent = normalizeRuntimePermissionIntent(eventRecord.decisionIntent);
              if (decisionIntent) tc.runtimePermission.decisionIntent = decisionIntent;
              const decisionScope = normalizeRuntimePermissionScope(eventRecord.decisionScope);
              if (decisionScope) tc.runtimePermission.decisionScope = decisionScope;
              tc.runtimePermission.status = eventRecord.cancelled === true
                ? 'cancelled'
                : decisionIntent === 'deny' || denied
                  ? 'denied'
                  : 'approved';
            }
            if (eventRecord.cancelled === true || denied) {
              tc.state = 'error';
              tc.output = decision
                ? `Permission decision forwarded: ${decision}`
                : 'Permission decision forwarded.';
            }
            touch(tc);
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
            touch(tc);
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
            touch(tc);
            changed = true;
            break;
          }

          case 'user_question_cancelled': {
            const toolCallId = eventRecord.toolCallId as string;
            if (!toolCallId) break;
            const tc = findOrCreateToolCall(toolCallId, 'ask_user_question');
            if (tc.userQuestion) {
              tc.userQuestion.status = 'cancelled';
              tc.userQuestion.reason = typeof eventRecord.reason === 'string' ? redactSensitiveText(eventRecord.reason) : undefined;
            }
            tc.state = 'error';
            tc.output = typeof eventRecord.reason === 'string' && eventRecord.reason
              ? redactSensitiveText(eventRecord.reason)
              : 'Question cancelled.';
            touch(tc);
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
                ...(typeof eventRecord.reason === 'string' ? { reason: redactSensitiveText(eventRecord.reason) } : {}),
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
              text: `\n\n**Stream Error:** ${redactSensitiveText(message)}`,
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

      // Emit at most once per coalescing window, not per SSE line/batch
      if (changed) {
        scheduleEmit();
      }
      if (done) break;
    }
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
    if (signal?.aborted) {
      // Release the underlying connection; safe if already cancelled/closed.
      try { await reader.cancel(); } catch { /* stream already settled */ }
    }
    reader.releaseLock();
    // Terminal state (completion, error, abort) must never be delayed:
    // flush any pending coalesced snapshot and the batched files-changed
    // notification before the caller observes the run as finished.
    flushEmit();
    filesChanged?.flush();
  }

  // Finalize any tool calls still in running/pending state
  // (stream ended unexpectedly — abort, network error, step limit)
  let finalized = false;
  for (const tc of toolCalls.values()) {
    if (tc.state === 'running' || tc.state === 'pending') {
      tc.state = 'error';
      tc.output = tc.output ?? 'Stream ended before tool completed';
      touch(tc);
      finalized = true;
    }
  }
  if (finalized) {
    onUpdate(buildMessage());
  }

  return buildMessage();
}
