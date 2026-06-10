import { redactSensitiveObject, redactSensitiveText } from './redaction.js';

export { redactSensitiveObject, redactSensitiveText } from './redaction.js';

export type MindosSessionEventType =
  | 'session.started'
  | 'message.delta'
  | 'tool.started'
  | 'tool.completed'
  | 'session.completed'
  | 'session.failed';

export type MindosSessionEvent<TData = unknown> = {
  id: string;
  type: MindosSessionEventType;
  sessionId: string;
  timestamp: string;
  data?: TData;
};

export type MindosSessionStreamSchema = {
  protocol: 'mindos.session.events';
  version: 1;
  events: MindosSessionEventType[];
};

export const MINDOS_SESSION_STREAM_SCHEMA: MindosSessionStreamSchema = {
  protocol: 'mindos.session.events',
  version: 1,
  events: [
    'session.started',
    'message.delta',
    'tool.started',
    'tool.completed',
    'session.completed',
    'session.failed',
  ],
};

export function createMindosSessionEvent<TData>(
  input: Omit<MindosSessionEvent<TData>, 'timestamp'> & { timestamp?: string },
): MindosSessionEvent<TData> {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export type MindOSSSEvent =
  | { type: 'agent_run_context'; rootRunId: string; chatSessionId?: string; startedAt: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' }
  | { type: 'tool_delta'; toolCallId: string; delta: string; toolName?: string; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' }
  | { type: 'tool_end'; toolCallId: string; output: string; isError: boolean; toolName?: string; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' }
  | {
      type: 'runtime_permission_request';
      runId: string;
      requestId: string;
      runtime: 'codex' | 'claude';
      toolCallId: string;
      toolName: string;
      input: unknown;
      options: Array<{ id: string; label: string; description?: string; intent?: 'allow' | 'deny' | 'cancel' }>;
      reason?: string;
    }
  | {
      type: 'runtime_permission_resolved';
      runId: string;
      requestId: string;
      runtime: 'codex' | 'claude';
      toolCallId: string;
      decision: string;
      cancelled?: boolean;
    }
  | { type: 'user_question_start'; runId: string; toolCallId: string; questions: unknown }
  | { type: 'user_question_answered'; runId: string; toolCallId: string; answers?: unknown }
  | { type: 'user_question_cancelled'; runId: string; toolCallId: string; reason: string }
  | {
      type: 'runtime_binding';
      runtime: 'acp' | 'codex' | 'claude';
      externalSessionId: string;
      cwd?: string;
      status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
      reason?: string;
    }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string; visible?: boolean; runtime?: 'mindos' | 'acp' | 'codex' | 'claude' };

export const MINDOS_ASK_STREAM_EVENT_TYPES = [
  'text_delta',
  'thinking_delta',
  'agent_run_context',
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

export type MessageUpdateEvent = {
  type: 'message_update';
  assistantMessageEvent?: { type: string; delta?: string };
};

export type ToolExecStartEvent = {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ToolExecEndEvent = {
  type: 'tool_execution_end';
  toolCallId: string;
  result?: { content?: Array<{ type: string; text?: string }> };
  isError?: boolean;
};

export type TurnEndEvent = {
  type: 'turn_end';
  toolResults?: Array<{ toolName: string; content: unknown }>;
  usage?: { inputTokens: number; outputTokens?: number };
};

export type AgentEndEvent = {
  type: 'agent_end';
  messages?: Array<{
    role: string;
    content?: Array<{ type: string; text?: string }>;
    stopReason?: string;
    errorMessage?: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

export function isTextDeltaEvent(event: unknown): event is MessageUpdateEvent {
  if (!isRecord(event) || event.type !== 'message_update') return false;
  return nestedRecord(event, 'assistantMessageEvent')?.type === 'text_delta';
}

export function getTextDelta(event: unknown): string {
  if (!isRecord(event)) return '';
  const assistantEvent = nestedRecord(event, 'assistantMessageEvent');
  return typeof assistantEvent?.delta === 'string' ? assistantEvent.delta : '';
}

export function isThinkingDeltaEvent(event: unknown): event is MessageUpdateEvent {
  if (!isRecord(event) || event.type !== 'message_update') return false;
  return nestedRecord(event, 'assistantMessageEvent')?.type === 'thinking_delta';
}

export function getThinkingDelta(event: unknown): string {
  return getTextDelta(event);
}

export function isToolExecutionStartEvent(event: unknown): event is ToolExecStartEvent {
  return isRecord(event) && event.type === 'tool_execution_start';
}

export function getToolExecutionStart(event: unknown): { toolCallId: string; toolName: string; args: unknown } {
  if (!isRecord(event)) return { toolCallId: '', toolName: 'unknown', args: {} };
  return {
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : '',
    toolName: typeof event.toolName === 'string' ? event.toolName : 'unknown',
    args: event.args ?? {},
  };
}

export function isToolExecutionEndEvent(event: unknown): event is ToolExecEndEvent {
  return isRecord(event) && event.type === 'tool_execution_end';
}

export function getToolExecutionEnd(event: unknown): { toolCallId: string; output: string; isError: boolean } {
  if (!isRecord(event)) return { toolCallId: '', output: '', isError: false };
  const result = nestedRecord(event, 'result');
  const content = Array.isArray(result?.content) ? result.content : [];
  const output = content
    .filter((part): part is { type: string; text?: string } => isRecord(part) && part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');

  return {
    toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : '',
    output,
    isError: event.isError === true,
  };
}

export function isTurnEndEvent(event: unknown): event is TurnEndEvent {
  return isRecord(event) && event.type === 'turn_end';
}

export function getTurnEndData(event: unknown): { toolResults: Array<{ toolName: string; content: unknown }> } {
  if (!isRecord(event)) return { toolResults: [] };
  return {
    toolResults: Array.isArray(event.toolResults)
      ? event.toolResults.filter((item): item is { toolName: string; content: unknown } => isRecord(item) && typeof item.toolName === 'string')
      : [],
  };
}

export type MindosAgentEventReducerOptions = {
  stepLimit: number;
  loopWarningMessage?: string;
};

export type MindosAgentEventEffect = {
  events: MindOSSSEvent[];
  hasVisibleContent: boolean;
  toolExecutions?: number;
  tokenUsage?: { input: number; output: number };
  stepCount?: number;
  shouldAbort?: boolean;
  steerMessage?: string;
  lastModelError?: string;
};

export type MindosAgentEventReducer = {
  readonly lastModelError: string;
  readonly stepCount: number;
  handle(event: unknown): MindosAgentEventEffect;
};

export function createMindosAgentEventReducer(options: MindosAgentEventReducerOptions): MindosAgentEventReducer {
  const stepHistory: MindosAgentStepEntry[] = [];
  let stepCount = 0;
  let loopCooldown = 0;
  let lastModelError = '';
  const loopWarningMessage = options.loopWarningMessage
    ?? '[SYSTEM WARNING] You appear to be in a loop — repeating the same tool calls in a cycle. Try a completely different approach or ask the user for clarification.';

  return {
    get lastModelError() {
      return lastModelError;
    },
    get stepCount() {
      return stepCount;
    },
    handle(event: unknown): MindosAgentEventEffect {
      if (isTextDeltaEvent(event)) {
        return { events: [{ type: 'text_delta', delta: getTextDelta(event) }], hasVisibleContent: true };
      }
      if (isThinkingDeltaEvent(event)) {
        return { events: [{ type: 'thinking_delta', delta: getThinkingDelta(event) }], hasVisibleContent: true };
      }
      if (isToolExecutionStartEvent(event)) {
        const { toolCallId, toolName, args } = getToolExecutionStart(event);
        return {
          events: [{ type: 'tool_start', toolCallId, toolName, args: sanitizeToolArgs(toolName, args) }],
          hasVisibleContent: true,
        };
      }
      if (isToolExecutionEndEvent(event)) {
        const { toolCallId, output, isError } = getToolExecutionEnd(event);
        return {
          events: [{ type: 'tool_end', toolCallId, output: sanitizeToolOutput(output), isError }],
          hasVisibleContent: false,
          toolExecutions: 1,
        };
      }
      if (isTurnEndEvent(event)) {
        stepCount += 1;
        const effect: MindosAgentEventEffect = {
          events: [],
          hasVisibleContent: false,
          stepCount,
        };

        const turnUsage = event.usage;
        if (turnUsage && typeof turnUsage.inputTokens === 'number') {
          effect.tokenUsage = { input: turnUsage.inputTokens, output: turnUsage.outputTokens ?? 0 };
        }

        const { toolResults } = getTurnEndData(event);
        if (toolResults.length > 0) {
          const newEntries = toolResults.map((toolResult) => ({
            tool: toolResult.toolName ?? 'unknown',
            input: JSON.stringify(toolResult.content, null, 0),
          }));
          stepHistory.push(...newEntries);
          if (stepHistory.length > 20) stepHistory.splice(0, stepHistory.length - 20);
        }

        if (loopCooldown > 0) {
          loopCooldown -= 1;
        } else if (detectMindosAgentLoop(stepHistory)) {
          loopCooldown = 3;
          effect.steerMessage = loopWarningMessage;
        }

        if (stepCount >= options.stepLimit) {
          effect.shouldAbort = true;
        }

        return effect;
      }
      if (isRecord(event) && event.type === 'agent_end') {
        const msgs = Array.isArray(event.messages) ? event.messages : [];
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          const message = msgs[i];
          if (
            isRecord(message)
            && message.role === 'assistant'
            && message.stopReason === 'error'
            && typeof message.errorMessage === 'string'
          ) {
            lastModelError = message.errorMessage;
            return { events: [], hasVisibleContent: false, lastModelError };
          }
        }
      }

      return { events: [], hasVisibleContent: false };
    },
  };
}

export function sanitizeToolArgs(toolName: string, args: unknown): unknown {
  if (!isRecord(args)) return typeof args === 'string' ? redactSensitiveText(args) : redactSensitiveObject(args);

  if (toolName === 'batch_create_files' && Array.isArray(args.files)) {
    return redactSensitiveObject({
      ...args,
      files: args.files
        .filter(isRecord)
        .map((file) => ({
          path: file.path,
          ...(file.description ? { description: file.description } : {}),
        })),
    });
  }

  if (typeof args.content === 'string' && args.content.length > 200) {
    return redactSensitiveObject({ ...args, content: `[${args.content.length} chars]` });
  }
  if (typeof args.text === 'string' && args.text.length > 200) {
    return redactSensitiveObject({ ...args, text: `[${args.text.length} chars]` });
  }
  return redactSensitiveObject(args);
}

export function sanitizeToolOutput(output: string): string {
  return redactSensitiveText(output);
}

export function encodeMindosSseEvent(event: MindOSSSEvent): string {
  return `data:${JSON.stringify(event)}\n\n`;
}

export function parseMindosSseLine(line: string): MindOSSSEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const json = trimmed.slice(5).trim();
  if (!json || json === '[DONE]') return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;
    if (!(MINDOS_ASK_STREAM_EVENT_TYPES as readonly string[]).includes(parsed.type)) return null;
    return parsed as MindOSSSEvent;
  } catch {
    return null;
  }
}

export type MindosAskMode = 'chat' | 'agent' | 'organize';

export type MindosAskFileValidationResult = {
  valid: boolean;
  newCumulativeSize: number;
  error?: string;
};

export type MindosAskFileContextServices = {
  readFile(filePath: string): string;
  truncate?: (content: string) => string;
  validateFileSize?: (filePath: string, cumulativeSize: number) => MindosAskFileValidationResult;
  warn?: (message: string, error?: unknown) => void;
};

export type MindosAskFileContext = {
  contextParts: string[];
  failedFiles: string[];
};

export function normalizeMindosAskMode(mode: unknown): MindosAskMode {
  if (mode === 'organize') return 'organize';
  if (mode === 'chat') return 'chat';
  return 'agent';
}

export function normalizeMindosAskStepLimit(options: {
  mode: MindosAskMode;
  requestedMaxSteps?: unknown;
  agentMaxSteps?: number;
}): number {
  const defaultMaxSteps = options.mode === 'chat' ? 8 : (options.agentMaxSteps ?? 20);
  const raw = typeof options.requestedMaxSteps === 'number' && Number.isFinite(options.requestedMaxSteps)
    ? options.requestedMaxSteps
    : defaultMaxSteps;
  return Math.min(999, Math.max(1, Number(raw)));
}

export function resolveMindosAgentTimeoutMs(raw: string | undefined = undefined, defaultMs = 600_000): number {
  if (!raw) return defaultMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

export function expandMindosAskAttachedFiles(
  raw: string[] | undefined,
  collectAllFiles: () => string[],
  maxDirFiles = 30,
): string[] | undefined {
  if (!Array.isArray(raw)) return raw;
  const result: string[] = [];
  let allFiles: string[] | undefined;
  for (const entry of raw) {
    if (entry.endsWith('/')) {
      allFiles ??= collectAllFiles();
      let count = 0;
      for (const filePath of allFiles) {
        if (filePath.startsWith(entry) && ++count <= maxDirFiles) result.push(filePath);
      }
    } else {
      result.push(entry);
    }
  }
  return result;
}

export function loadMindosAskFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
  mode: string,
  services: MindosAskFileContextServices,
): MindosAskFileContext {
  const contextParts: string[] = [];
  const failedFiles: string[] = [];
  const seen = new Set<string>();
  let cumulativeSize = 0;

  function appendFile(filePath: string, label: 'Attached' | 'Current file') {
    if (seen.has(filePath)) return;
    seen.add(filePath);

    const validation = services.validateFileSize?.(filePath, cumulativeSize) ?? {
      valid: true,
      newCumulativeSize: cumulativeSize,
    };
    if (!validation.valid) {
      services.warn?.(`[ask] ${mode}: file size validation failed for "${filePath}": ${validation.error ?? 'invalid'}`);
      failedFiles.push(filePath);
      return;
    }

    try {
      const raw = services.readFile(filePath);
      const content = services.truncate ? services.truncate(raw) : raw;
      contextParts.push(`## ${label}: ${filePath}\n\n${content}`);
      cumulativeSize = validation.newCumulativeSize;
    } catch (error) {
      services.warn?.(`[ask] ${mode}: failed to read ${label === 'Attached' ? 'attached file' : 'currentFile'} "${filePath}":`, error);
      failedFiles.push(filePath);
    }
  }

  for (const filePath of attachedFiles ?? []) appendFile(filePath, 'Attached');
  if (currentFile) appendFile(currentFile, 'Current file');

  return { contextParts, failedFiles };
}

export function createMindosUploadedFileParts(
  uploadedFiles: unknown,
  options: { maxBytes?: number; limit?: number } = {},
): string[] {
  if (!Array.isArray(uploadedFiles)) return [];
  const maxBytes = options.maxBytes ?? 100_000;
  const limit = options.limit ?? 8;
  const parts: string[] = [];
  for (const file of uploadedFiles.slice(0, limit)) {
    if (!file || typeof file !== 'object') continue;
    const record = file as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.content !== 'string') continue;
    const content = record.content.length > maxBytes
      ? `${record.content.slice(0, maxBytes)}\n\n[...truncated]`
      : record.content;
    parts.push(`### ${record.name}\n\n${content}`);
  }
  return parts;
}

export type MindosExternalRuntimePromptInput = {
  prompt: string;
  mode?: 'chat' | 'agent' | 'organize';
  fileContext?: MindosAskFileContext;
  uploadedParts?: string[];
  recalledKnowledge?: Array<{ path: string; content: string }>;
};

export function buildMindosExternalRuntimePrompt(input: MindosExternalRuntimePromptInput): string {
  const prompt = input.prompt.trim();
  const contextSections: string[] = [];
  const modeGuidance = getExternalRuntimeModeGuidance(input.mode);

  if (modeGuidance) {
    contextSections.push([
      '## MindOS Runtime Mode',
      modeGuidance,
    ].join('\n'));
  }

  contextSections.push([
    '## MindOS Chat Panel Bridge',
    'If the available tools include `AskUserQuestion`, use it for user confirmations or structured choices that affect the next action. Keep questions concise and include concrete options.',
  ].join('\n'));

  if (input.fileContext?.contextParts.length) {
    contextSections.push([
      '## Attached MindOS Context',
      'The following content was explicitly attached from the MindOS knowledge base for this turn.',
      '',
      input.fileContext.contextParts.join('\n\n---\n\n'),
    ].join('\n'));
  }

  if (input.uploadedParts?.length) {
    contextSections.push([
      '## Uploaded Files',
      'The user uploaded the following file content in MindOS for this turn.',
      '',
      input.uploadedParts.join('\n\n---\n\n'),
    ].join('\n'));
  }

  if (input.recalledKnowledge?.length) {
    const block = input.recalledKnowledge
      .map((item) => `### ${item.path}\n\n${item.content}`)
      .join('\n\n---\n\n');
    contextSections.push([
      '## Auto-Recalled MindOS Knowledge',
      'MindOS found these related notes for the user request. Cite file paths when relying on them.',
      '',
      block,
    ].join('\n'));
  }

  if (input.fileContext?.failedFiles.length) {
    contextSections.push([
      '## Unavailable MindOS Context',
      `These attached files could not be loaded: ${input.fileContext.failedFiles.join(', ')}`,
    ].join('\n'));
  }

  if (contextSections.length === 0) return prompt;
  return [
    prompt,
    '---',
    '## MindOS Turn Context',
    ...contextSections,
  ].filter(Boolean).join('\n\n');
}

function getExternalRuntimeModeGuidance(mode: MindosExternalRuntimePromptInput['mode']): string | null {
  if (mode === 'chat') {
    return 'MindOS composer mode: chat. Treat this as read-oriented unless the user explicitly asks you to modify files.';
  }
  if (mode === 'organize') {
    return 'MindOS composer mode: organize. Prioritize classification, cleanup, and knowledge organization tasks.';
  }
  if (mode === 'agent') {
    return 'MindOS composer mode: agent. The user expects you to complete the requested task using your local runtime capabilities.';
  }
  return null;
}

export function safeParseMindosJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function dirnameOfMindosPath(filePath?: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

export type MindosAgentStepEntry = {
  tool: string;
  input: string;
};

export function isMindosTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return true;
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
  if (/\b5\d{2}\b/.test(msg) || msg.includes('internal server error') || msg.includes('service unavailable')) return true;
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket hang up')) return true;
  if (msg.includes('overloaded') || msg.includes('capacity')) return true;
  return false;
}

const MINDOS_NON_RETRYABLE_STATUS = new Set([401, 403, 429]);
const MINDOS_NON_RETRYABLE_PATTERNS = [
  /api.?key/i,
  /model.*not.?found/i,
  /authentication/i,
  /unauthorized/i,
  /forbidden/i,
];

export function isMindosRetryableError(err: unknown, httpStatus?: number): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (httpStatus && MINDOS_NON_RETRYABLE_STATUS.has(httpStatus)) return false;

  if (err instanceof Error) {
    const msg = err.message;
    if (MINDOS_NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(msg))) return false;
  }

  return true;
}

export function mindosRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}

export function sleepMindos(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    const abortReason = () => signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    if (signal?.aborted) {
      reject(abortReason());
      return;
    }
    const timer = setTimeout(resolveSleep, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortReason());
    }, { once: true });
  });
}

export type MindosAskRetryOptions = {
  maxRetries?: number;
  signal?: AbortSignal;
  hasContent(): boolean;
  onVisibleContent?(): void;
  send(event: MindOSSSEvent): void;
  execute(attempt: number): Promise<void>;
  onAttemptError?(error: Error, attempt: number): Promise<void> | void;
  isTransientError?: (error: Error) => boolean;
  retryDelay?: (attempt: number) => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryMessage?: (attempt: number, maxRetries: number) => string;
};

export async function runMindosAskWithRetry(options: MindosAskRetryOptions): Promise<Error | null> {
  const maxRetries = options.maxRetries ?? 3;
  const isTransient = options.isTransientError ?? isMindosTransientError;
  const delayForAttempt = options.retryDelay ?? mindosRetryDelay;
  const wait = options.sleep ?? sleepMindos;
  const retryMessage = options.retryMessage ?? ((attempt, max) => `Request failed, retrying (${attempt}/${max})...`);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await options.execute(attempt);
      return null;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await options.onAttemptError?.(lastError, attempt);

      const canRetry = !options.hasContent() && attempt < maxRetries && isTransient(lastError);
      if (!canRetry) break;

      options.send({ type: 'status', message: retryMessage(attempt, maxRetries) });
      await wait(delayForAttempt(attempt), options.signal);
    }
  }

  return lastError;
}

export type MindosAcpSessionUpdate = {
  type: string;
  text?: string;
  error?: string;
  toolCall?: {
    toolCallId: string;
    title?: string;
    kind?: string;
    rawInput?: string;
    rawOutput?: string;
    status?: string;
  };
  plan?: {
    entries?: Array<{ status?: string; content?: string }>;
  };
};

export type MindosAcpUpdateMappingOptions = {
  suppressErrors?: boolean;
};

export function mapMindosAcpUpdateToSseEvents(
  update: MindosAcpSessionUpdate,
  options: MindosAcpUpdateMappingOptions = {},
): { events: MindOSSSEvent[]; hasVisibleContent: boolean } {
  switch (update.type) {
    case 'agent_message_chunk':
    case 'text':
      if (!update.text) return { events: [], hasVisibleContent: false };
      return { events: [{ type: 'text_delta', delta: update.text }], hasVisibleContent: true };

    case 'agent_thought_chunk':
      if (!update.text) return { events: [], hasVisibleContent: false };
      return { events: [{ type: 'thinking_delta', delta: update.text }], hasVisibleContent: true };

    case 'tool_call':
      if (!update.toolCall) return { events: [], hasVisibleContent: false };
      return {
        events: [{
          type: 'tool_start',
          toolCallId: update.toolCall.toolCallId,
          toolName: update.toolCall.title ?? update.toolCall.kind ?? 'tool',
          args: sanitizeToolArgs(
            update.toolCall.title ?? update.toolCall.kind ?? 'tool',
            safeParseMindosJsonObject(update.toolCall.rawInput),
          ),
        }],
        hasVisibleContent: true,
      };

    case 'tool_call_update':
      if (!update.toolCall || (update.toolCall.status !== 'completed' && update.toolCall.status !== 'failed')) {
        return { events: [], hasVisibleContent: false };
      }
      return {
        events: [{
          type: 'tool_end',
          toolCallId: update.toolCall.toolCallId,
          output: sanitizeToolOutput(update.toolCall.rawOutput ?? ''),
          isError: update.toolCall.status === 'failed',
        }],
        hasVisibleContent: false,
      };

    case 'plan':
      if (!update.plan?.entries) return { events: [], hasVisibleContent: false };
      return {
        events: [{
          type: 'text_delta',
          delta: `\n\n${update.plan.entries.map((entry) => `${planEntryIcon(entry.status)} ${entry.content ?? ''}`).join('\n')}\n\n`,
        }],
        hasVisibleContent: true,
      };

    case 'error':
      if (options.suppressErrors) return { events: [], hasVisibleContent: false };
      return { events: [{ type: 'error', message: update.error ?? 'ACP agent error' }], hasVisibleContent: false };

    default:
      return { events: [], hasVisibleContent: false };
  }
}

function planEntryIcon(status: string | undefined): string {
  if (status === 'completed') return '\u2705';
  if (status === 'in_progress') return '\u26a1';
  return '\u23f3';
}

export type MindosAcpAskSessionServices = {
  createSession(agentId: string, options: { cwd: string; permissionMode?: 'agent' | 'readonly' }): Promise<{ id: string }>;
  promptStream(
    sessionId: string,
    prompt: string,
    onUpdate: (update: MindosAcpSessionUpdate) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelPrompt?(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
};

export type MindosAcpAskSessionOptions = MindosAcpAskSessionServices & {
  agentId: string;
  cwd: string;
  prompt: string;
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  hasContent(): boolean;
  onVisibleContent?(): void;
  send(event: MindOSSSEvent): void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryDelay?: (attempt: number) => number;
  timeoutMessage?: (timeoutMs: number) => string;
  errorMessage?: (error: Error) => string;
};

export type MindosAcpAskSessionResult = {
  error?: Error;
};

export async function runMindosAcpAskSession(options: MindosAcpAskSessionOptions): Promise<MindosAcpAskSessionResult> {
  let sessionId: string | undefined;

  const closeCurrentSession = async () => {
    if (!sessionId) return;
    const id = sessionId;
    sessionId = undefined;
    await options.closeSession(id).catch(() => {});
  };

  try {
    const timeoutMs = options.timeoutMs ?? resolveMindosAgentTimeoutMs();
    const lastError = await runMindosAskWithRetry({
      maxRetries: options.maxRetries,
      signal: options.signal,
      hasContent: options.hasContent,
      send: options.send,
      sleep: options.sleep,
      retryDelay: options.retryDelay,
      onAttemptError: closeCurrentSession,
      execute: async () => {
        await closeCurrentSession();
        const session = await options.createSession(options.agentId, { cwd: options.cwd });
        sessionId = session.id;
        let removeAbortListener: (() => void) | undefined;
        const abortPrompt = new Promise<never>((_resolve, reject) => {
          if (!options.signal) return;
          const abortReason = () => options.signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
          if (options.signal.aborted) {
            void options.cancelPrompt?.(session.id).catch(() => {});
            reject(abortReason());
            return;
          }
          const onAbort = () => {
            void options.cancelPrompt?.(session.id).catch(() => {});
            reject(abortReason());
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);
        });
        await runMindosWithTimeout(
          Promise.race([
            options.promptStream(sessionId, options.prompt, (update) => {
              const mapped = mapMindosAcpUpdateToSseEvents(update, { suppressErrors: options.hasContent() });
              if (mapped.hasVisibleContent) options.onVisibleContent?.();
              for (const event of mapped.events) options.send(event);
            }, options.signal),
            abortPrompt,
          ]).finally(() => removeAbortListener?.()),
          timeoutMs,
          options.timeoutMessage?.(timeoutMs) ?? `ACP agent execution timeout after ${timeoutMs / 1000} seconds`,
        );
      },
    });

    if (lastError) {
      options.send({ type: 'error', message: options.errorMessage?.(lastError) ?? `ACP Agent Error: ${lastError.message}` });
      return { error: lastError };
    }

    options.send({ type: 'done' });
    return {};
  } finally {
    await closeCurrentSession();
  }
}

export async function runMindosWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message) as Error & { code?: string };
      error.code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type MindosPiAgentSessionAdapter = {
  subscribe(callback: (event: unknown) => void): void;
  prompt(prompt: string, options?: unknown): Promise<void>;
  steer(message: string): Promise<void> | void;
  abort(): Promise<void> | void;
};

export type MindosPiAgentAskSessionOptions = {
  session: MindosPiAgentSessionAdapter;
  prompt: string;
  promptOptions?: unknown;
  stepLimit: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  provider: string;
  baseUrl?: string;
  effectiveBaseUrlKey?: string;
  compatMode?: string;
  send(event: MindOSSSEvent): void;
  runFallback(): Promise<void>;
  proxyMessages: MindosAskProxyFallbackMessages;
  writeCompat?(key: string, mode: 'non-streaming'): void;
  onToolExecution?(): void;
  onTokens?(input: number, output: number): void;
  onStep?(step: number, stepLimit: number): void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryDelay?: (attempt: number) => number;
  timeoutMessage?: (timeoutMs: number) => string;
};

export type MindosPiAgentAskSessionResult = {
  hasContent: boolean;
  lastModelError: string;
};

async function runMindosAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void> | void,
  message: string,
): Promise<T> {
  if (!signal) return promise;

  const abortReason = () => {
    const reason = signal.reason;
    if (reason instanceof Error) return reason;
    const error = new Error(typeof reason === 'string' && reason ? reason : message);
    error.name = 'AbortError';
    return error;
  };

  if (signal.aborted) {
    await onAbort();
    throw abortReason();
  }

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const abort = () => {
      void Promise.resolve(onAbort()).finally(() => reject(abortReason()));
    };
    signal.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', abort);
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    removeAbortListener?.();
  }
}

export async function runMindosPiAgentAskSession(options: MindosPiAgentAskSessionOptions): Promise<MindosPiAgentAskSessionResult> {
  let hasContent = false;
  let lastModelError = '';
  const effectiveBaseUrlKey = options.effectiveBaseUrlKey ?? options.baseUrl ?? 'default';
  const reducer = createMindosAgentEventReducer({ stepLimit: options.stepLimit });

  options.session.subscribe((event) => {
    const effect = reducer.handle(event);
    if (effect.hasVisibleContent) hasContent = true;
    for (const sseEvent of effect.events) options.send(sseEvent);
    if (effect.toolExecutions) options.onToolExecution?.();
    if (effect.tokenUsage) options.onTokens?.(effect.tokenUsage.input, effect.tokenUsage.output);
    if (effect.steerMessage) void options.session.steer(effect.steerMessage);
    if (effect.shouldAbort) void options.session.abort();
    if (effect.lastModelError) lastModelError = effect.lastModelError;
    if (effect.stepCount) options.onStep?.(effect.stepCount, options.stepLimit);
  });

  const handledCachedProxyFallback = await runMindosAskProxyFallback({
    phase: 'before-stream',
    provider: options.provider,
    baseUrl: options.baseUrl,
    compatMode: options.compatMode,
    send: options.send,
    messages: options.proxyMessages,
    runFallback: options.runFallback,
  });
  if (handledCachedProxyFallback) return { hasContent, lastModelError };

  const timeoutMs = options.timeoutMs ?? resolveMindosAgentTimeoutMs();
  const lastPromptError = await runMindosAskWithRetry({
    signal: options.signal,
    hasContent: () => hasContent,
    send: options.send,
    sleep: options.sleep,
    retryDelay: options.retryDelay,
    execute: async () => {
      await runMindosWithTimeout(
        runMindosAbortable(
          options.session.prompt(options.prompt, options.promptOptions),
          options.signal,
          () => options.session.abort(),
          'Agent run was canceled.',
        ),
        timeoutMs,
        options.timeoutMessage?.(timeoutMs) ?? `Agent execution timeout after ${timeoutMs / 1000} seconds`,
      );
    },
  });
  if (lastPromptError) throw lastPromptError;

  const handledProxyFallback = await runMindosAskProxyFallback({
    phase: 'after-stream',
    provider: options.provider,
    baseUrl: options.baseUrl,
    effectiveBaseUrlKey,
    hasContent,
    lastModelError,
    send: options.send,
    messages: options.proxyMessages,
    runFallback: options.runFallback,
    writeCompat: options.writeCompat,
  });
  if (!handledProxyFallback) options.send({ type: 'done' });

  return { hasContent, lastModelError };
}

export type MindosResolvedModelConfig = {
  model: unknown;
  modelName: string;
  apiKey: string;
  provider: string;
  baseUrl?: string;
};

export type MindosPiResourceLoaderAdapter = {
  reload(): Promise<void>;
  getSkills?(): { skills: MindosDiscoveredSkill[] };
};

export type MindosDiscoveredSkill = {
  name: string;
  disableModelInvocation?: boolean;
};

export type MindosPiRuntimeResourceLoaderConfig = {
  cwd: string;
  agentDir: string;
  settingsManager: unknown;
  systemPrompt: string;
  appendSystemPrompt: string[];
  agentsFilesOverride(result: { agentsFiles: unknown[] }): { agentsFiles: unknown[] };
  skillsOverride(result: { skills: MindosDiscoveredSkill[] }): { skills: MindosDiscoveredSkill[] };
  additionalSkillPaths: string[];
  additionalExtensionPaths: string[];
};

export type MindosPiRuntimeCreateAgentSessionConfig = {
  cwd: string;
  model: unknown;
  thinkingLevel: 'medium' | 'off';
  authStorage: unknown;
  modelRegistry: unknown;
  resourceLoader: MindosPiResourceLoaderAdapter;
  sessionManager: unknown;
  settingsManager: unknown;
  tools: unknown[];
  customTools?: unknown[];
};

export type MindosPiSessionManagerAdapter = {
  appendMessage(message: unknown): void;
};

export type MindosPiAgentRuntimeServices = {
  resolveModelConfig(input: {
    providerOverride?: string;
    modelOverride?: string;
    messages: MindosUiAskMessage[];
    hasImages: boolean;
  }): MindosResolvedModelConfig;
  toRuntimeProvider(provider: string): string;
  createAuthStorage(): { setRuntimeApiKey(provider: string, apiKey: string): void };
  createModelRegistry(authStorage: unknown): unknown;
  createSettingsManager(settings: Record<string, unknown>): unknown;
  createSessionManager(): MindosPiSessionManagerAdapter;
  createResourceLoader(config: MindosPiRuntimeResourceLoaderConfig): MindosPiResourceLoaderAdapter;
  createAgentSession(config: MindosPiRuntimeCreateAgentSessionConfig): Promise<{ session: MindosPiAgentSessionAdapter }>;
  convertToLlm(messages: MindosAgentHistoryMessage[]): unknown[];
  setKbMode(mode: MindosAskMode): void;
  generateSkillsXml?(skills: MindosDiscoveredSkill[]): string;
  getOllamaContextWindow?(baseUrl: string, modelName: string): Promise<number | undefined>;
  estimateTokens?(content: string): number;
  compactPrompt?(prompt: string, options: { maxPromptTokens: number; estimateTokens(content: string): number; onStrip?(section: string, sectionTokens: number): void }): string;
  onOllamaContext?(data: { modelName: string; contextWindow?: number; promptTokens: number; maxPromptTokens?: number }): void;
  onOllamaCompactStrip?(section: string, sectionTokens: number): void;
  onOllamaCompacted?(data: { beforeTokens: number; afterTokens: number }): void;
};

export type MindosPiAgentRuntimeOptions = {
  mode: MindosAskMode;
  messages: MindosUiAskMessage[];
  systemPrompt: string;
  providerOverride?: string;
  modelOverride?: string;
  projectRoot: string;
  agentDir: string;
  mindRoot: string;
  agentConfig?: {
    enableThinking?: boolean;
    thinkingBudget?: number;
    contextStrategy?: string;
  };
  serverSettings?: {
    disabledSkills?: string[];
  };
  additionalSkillPaths?: string[];
  additionalExtensionPaths?: string[];
  requestTools: MindosExecutableTool[];
  bashTool: unknown;
  services: MindosPiAgentRuntimeServices;
};

export type MindosPiAgentRuntime = {
  session: MindosPiAgentSessionAdapter;
  llmHistoryMessages: unknown[];
  requestTools: MindosExecutableTool[];
  systemPrompt: string;
  model: unknown;
  modelName: string;
  apiKey: string;
  provider: string;
  baseUrl?: string;
  lastUserContent: string;
  lastUserImages?: MindosUiImagePart[];
  lastUserSkillName?: string;
};

export async function createMindosPiAgentRuntime(options: MindosPiAgentRuntimeOptions): Promise<MindosPiAgentRuntime> {
  const lastMessage = options.messages.length > 0 ? options.messages[options.messages.length - 1] : undefined;
  const lastUserContent = lastMessage?.role === 'user' ? lastMessage.content : '';
  const lastUserSkillName = lastMessage?.role === 'user' && typeof lastMessage.skillName === 'string'
    ? lastMessage.skillName
    : undefined;
  const lastUserImages = extractMindosUserImages(lastMessage);

  const modelConfig = options.services.resolveModelConfig({
    providerOverride: options.providerOverride,
    modelOverride: options.modelOverride,
    messages: options.messages,
    hasImages: hasMindosMessageImages(options.messages),
  });

  let systemPrompt = options.systemPrompt;
  if (modelConfig.provider === 'ollama' && options.services.getOllamaContextWindow && options.services.estimateTokens && options.services.compactPrompt) {
    const ollamaBase = modelConfig.baseUrl || 'http://localhost:11434/v1';
    const contextWindow = await options.services.getOllamaContextWindow(ollamaBase, modelConfig.modelName);
    const promptTokens = options.services.estimateTokens(systemPrompt);
    const maxPromptTokens = contextWindow ? Math.floor(contextWindow * 0.7) : undefined;
    options.services.onOllamaContext?.({ modelName: modelConfig.modelName, contextWindow, promptTokens, maxPromptTokens });

    if (maxPromptTokens && promptTokens > maxPromptTokens) {
      systemPrompt = options.services.compactPrompt(systemPrompt, {
        maxPromptTokens,
        estimateTokens: options.services.estimateTokens,
        onStrip: options.services.onOllamaCompactStrip,
      });
      options.services.onOllamaCompacted?.({
        beforeTokens: promptTokens,
        afterTokens: options.services.estimateTokens(systemPrompt),
      });
    }
  }

  const agentMessages = toMindosAgentMessages(options.messages);
  const historyMessages = agentMessages.slice(0, -1);
  const llmHistoryMessages = options.services.convertToLlm(historyMessages);

  options.services.setKbMode(options.mode);

  const authStorage = options.services.createAuthStorage();
  authStorage.setRuntimeApiKey(options.services.toRuntimeProvider(modelConfig.provider), modelConfig.apiKey);
  const modelRegistry = options.services.createModelRegistry(authStorage);
  const settingsManager = options.services.createSettingsManager(createMindosPiSettingsConfig(options.agentConfig, modelConfig.provider));
  const coreSkillNames = new Set(['mindos', 'mindos-zh', 'mindos-max', 'mindos-max-zh']);
  const resourceLoader = options.services.createResourceLoader({
    cwd: options.projectRoot,
    agentDir: options.agentDir,
    settingsManager,
    systemPrompt,
    appendSystemPrompt: [],
    agentsFilesOverride: (result) => ({ ...result, agentsFiles: [] }),
    skillsOverride: (result) => ({
      ...result,
      skills: result.skills.filter((skill) => !coreSkillNames.has(skill.name)),
    }),
    additionalSkillPaths: options.additionalSkillPaths ?? [],
    additionalExtensionPaths: options.additionalExtensionPaths ?? [],
  });

  await resourceLoader.reload();

  if (options.mode === 'agent') {
    const disabledSkillNames = new Set(options.serverSettings?.disabledSkills ?? []);
    const discoveredSkills = resourceLoader.getSkills?.().skills ?? [];
    const thirdPartySkills = discoveredSkills.filter(
      (skill) => !coreSkillNames.has(skill.name) && !skill.disableModelInvocation && !disabledSkillNames.has(skill.name),
    );
    if (thirdPartySkills.length > 0 && options.services.generateSkillsXml) {
      systemPrompt += `\n\n---\n\n${options.services.generateSkillsXml(thirdPartySkills)}`;
      await resourceLoader.reload();
    }

    if (lastUserSkillName) {
      systemPrompt += '\n\n---\n\n## Active Skill Request\n\n'
        + `The user has selected the "${lastUserSkillName}" skill via slash command. You MUST:\n`
        + `1. Immediately call \`load_skill("${lastUserSkillName}")\` to load the skill's full content\n`
        + "2. Follow the skill's instructions to handle the user's request\n"
        + '3. Do NOT ask the user which skill they mean — they have already selected it';
      await resourceLoader.reload();
    }
  }

  const sessionManager = options.services.createSessionManager();
  for (const message of llmHistoryMessages) {
    sessionManager.appendMessage(message);
  }

  const { session } = await options.services.createAgentSession({
    cwd: options.projectRoot,
    model: modelConfig.model,
    thinkingLevel: options.agentConfig?.enableThinking && modelConfig.provider === 'anthropic' ? 'medium' : 'off',
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager,
    settingsManager,
    tools: options.mode === 'agent' ? [options.bashTool] : [],
    customTools: options.requestTools,
  });

  return {
    session,
    llmHistoryMessages,
    requestTools: options.requestTools,
    systemPrompt,
    model: modelConfig.model,
    modelName: modelConfig.modelName,
    apiKey: modelConfig.apiKey,
    provider: modelConfig.provider,
    baseUrl: modelConfig.baseUrl,
    lastUserContent,
    lastUserImages,
    lastUserSkillName,
  };
}

function createMindosPiSettingsConfig(
  agentConfig: MindosPiAgentRuntimeOptions['agentConfig'] = {},
  provider: string,
): Record<string, unknown> {
  return {
    enableSkillCommands: true,
    ...(agentConfig.enableThinking && provider === 'anthropic'
      ? { thinkingBudgets: { medium: agentConfig.thinkingBudget ?? 5000 } }
      : {}),
    ...(agentConfig.contextStrategy === 'off' ? { compaction: { enabled: false } } : {}),
  };
}

function hasMindosMessageImages(messages: MindosUiAskMessage[]): boolean {
  return messages.some((message) => (extractMindosUserImages(message)?.length ?? 0) > 0);
}

function extractMindosUserImages(message: MindosUiAskMessage | undefined): MindosUiImagePart[] | undefined {
  if (!message || message.role !== 'user') return undefined;
  const images = message.images?.filter((image) => image.data);
  return images && images.length > 0 ? images : undefined;
}

export type MindosAskProxyFallbackMessages = {
  proxyCompatMode: string;
  proxyCompatDetecting: string;
  proxyCompatFailed(message: string): string;
  proxyCompatAlsoFailed(message: string): string;
};

export type MindosAskProxyFallbackOptions = {
  phase: 'before-stream' | 'after-stream';
  provider: string;
  baseUrl?: string;
  effectiveBaseUrlKey?: string;
  compatMode?: string;
  hasContent?: boolean;
  lastModelError?: string;
  send(event: MindOSSSEvent): void;
  runFallback(): Promise<void>;
  writeCompat?(key: string, mode: 'non-streaming'): void;
  messages: MindosAskProxyFallbackMessages;
};

export async function runMindosAskProxyFallback(options: MindosAskProxyFallbackOptions): Promise<boolean> {
  if (options.phase === 'before-stream') {
    if (options.compatMode !== 'non-streaming' || !isOpenAiCompatibleProxy(options)) return false;
    options.send({ type: 'status', message: options.messages.proxyCompatMode });
    try {
      await options.runFallback();
      options.send({ type: 'done' });
    } catch (error) {
      options.send({ type: 'error', message: options.messages.proxyCompatFailed(errorMessage(error)) });
    }
    return true;
  }

  if (options.hasContent) return false;
  if (!options.lastModelError && !isOpenAiCompatibleProxy(options)) return false;

  if (isOpenAiCompatibleProxy(options)) {
    options.send({
      type: 'status',
      message: options.lastModelError ? options.messages.proxyCompatDetecting : options.messages.proxyCompatMode,
    });
    try {
      await options.runFallback();
      options.writeCompat?.(options.effectiveBaseUrlKey ?? options.baseUrl ?? 'default', 'non-streaming');
      options.send({ type: 'done' });
    } catch (error) {
      options.send({ type: 'error', message: options.messages.proxyCompatAlsoFailed(errorMessage(error)) });
    }
    return true;
  }

  if (options.lastModelError) {
    options.send({ type: 'error', message: options.lastModelError });
    return true;
  }

  return false;
}

function isOpenAiCompatibleProxy(options: Pick<MindosAskProxyFallbackOptions, 'provider' | 'baseUrl'>): boolean {
  return !!options.baseUrl && options.provider === 'openai';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildMindosCompatEndpointCandidates(baseUrl: string, endpointPath: string, apiType: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  const cleanPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const hasVersionPrefix = /\/v\d+(?:$|\/)/.test(base);
  const candidates = new Set<string>();

  candidates.add(`${base}${cleanPath}`);

  if (!hasVersionPrefix && (
    apiType === 'openai-completions'
    || apiType === 'openai-responses'
    || apiType === 'anthropic-messages'
  )) {
    candidates.add(`${base}/v1${cleanPath}`);
  }

  return Array.from(candidates);
}

type MindosOpenAIMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
};

type MindosOpenAIChunkToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type MindosOpenAIToolCall = {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

export function reassembleMindosOpenAISse(sseText: string): {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: MindosOpenAIToolCall[];
    };
    finish_reason: string;
  }>;
} {
  const lines = sseText.split('\n');
  let content = '';
  let role = 'assistant';
  let finishReason = 'stop';
  const toolCalls = new Map<number, MindosOpenAIToolCall>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    const chunk = parseUnknownJson(payload);
    if (!isRecord(chunk)) continue;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const firstChoice = choices[0];
    if (!isRecord(firstChoice)) continue;
    const delta = firstChoice.delta;
    if (!isRecord(delta)) continue;

    if (typeof delta.role === 'string') role = delta.role;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof firstChoice.finish_reason === 'string') finishReason = firstChoice.finish_reason;

    if (Array.isArray(delta.tool_calls)) {
      for (const rawToolCall of delta.tool_calls) {
        if (!isRecord(rawToolCall)) continue;
        const toolCall = rawToolCall as MindosOpenAIChunkToolCall;
        const idx = typeof toolCall.index === 'number' ? toolCall.index : 0;
        const existing = toolCalls.get(idx);
        if (!existing) {
          toolCalls.set(idx, {
            id: toolCall.id ?? '',
            type: toolCall.type ?? 'function',
            function: {
              name: toolCall.function?.name ?? '',
              arguments: toolCall.function?.arguments ?? '',
            },
          });
        } else {
          if (toolCall.id) existing.id = toolCall.id;
          if (toolCall.function?.name) existing.function.name += toolCall.function.name;
          if (toolCall.function?.arguments) existing.function.arguments += toolCall.function.arguments;
        }
      }
    }
  }

  const message: {
    role: string;
    content: string | null;
    tool_calls?: MindosOpenAIToolCall[];
  } = { role, content: content || null };
  if (toolCalls.size > 0) message.tool_calls = Array.from(toolCalls.values());

  return {
    choices: [{ message, finish_reason: finishReason }],
  };
}

export function mindosPiMessagesToOpenAI(piMessages: unknown[]): MindosOpenAIMessage[] {
  return piMessages
    .map((message) => {
      if (!isRecord(message)) return null;
      const role = message.role;

      if (role === 'system') return null;

      if (role === 'user') {
        return {
          role: 'user',
          content: typeof message.content === 'string' ? message.content : message.content,
        };
      }

      if (role === 'assistant') {
        const assistantContent = message.content;
        let textContent = '';
        const toolCalls: MindosOpenAIToolCall[] = [];

        if (Array.isArray(assistantContent)) {
          for (const rawPart of assistantContent) {
            if (!isRecord(rawPart)) continue;
            if (rawPart.type === 'text' && typeof rawPart.text === 'string') {
              textContent += rawPart.text;
            } else if (rawPart.type === 'toolCall') {
              toolCalls.push({
                id: typeof rawPart.id === 'string' ? rawPart.id : `call_${Date.now()}`,
                type: 'function',
                function: {
                  name: typeof rawPart.name === 'string' ? rawPart.name : 'unknown',
                  arguments: JSON.stringify(rawPart.arguments ?? {}),
                },
              });
            }
          }
        }

        const result: MindosOpenAIMessage = { role: 'assistant', content: textContent || '' };
        if (toolCalls.length > 0) result.tool_calls = toolCalls;
        return result;
      }

      if (role === 'toolResult') {
        const contentText = Array.isArray(message.content)
          ? message.content
              .filter((part): part is { type: string; text?: string } => isRecord(part) && part.type === 'text')
              .map((part) => part.text ?? '')
              .join('\n')
          : String(message.content ?? '');

        return {
          role: 'tool',
          tool_call_id: typeof message.toolCallId === 'string' ? message.toolCallId : 'unknown',
          content: contentText,
        };
      }

      return null;
    })
    .filter((message): message is MindosOpenAIMessage => message !== null);
}

export type MindosExecutableTool = {
  name: string;
  description?: string;
  parameters?: unknown;
  execute(toolCallId: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
};

export type MindosNonStreamingFallbackOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  historyMessages: unknown[];
  userContent: string;
  tools: MindosExecutableTool[];
  send(event: MindOSSSEvent): void;
  signal: AbortSignal;
  maxSteps: number;
  fetch?: typeof fetch;
  chunkDelayMs?: number;
};

export async function runMindosNonStreamingFallback(options: MindosNonStreamingFallbackOptions): Promise<void> {
  const {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    historyMessages,
    userContent,
    tools,
    send,
    signal,
    maxSteps,
  } = options;
  const fetchImpl = options.fetch ?? fetch;
  const chunkDelayMs = options.chunkDelayMs ?? 8;

  const openaiTools = tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    },
  }));

  const messages: MindosOpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mindosPiMessagesToOpenAI(historyMessages),
    { role: 'user', content: userContent },
  ];

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const endpoints = buildMindosCompatEndpointCandidates(baseUrl, '/chat/completions', 'openai-completions');
  let step = 0;

  while (step < maxSteps) {
    if (signal.aborted) throw new Error('Request aborted');
    step += 1;

    let response: Response | null = null;
    let lastEndpointError = '';

    for (const endpoint of endpoints) {
      const attempt = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
          stream: true,
        }),
        signal,
      });

      if (attempt.ok) {
        response = attempt;
        break;
      }

      const errorText = await attempt.text().catch(() => '');
      lastEndpointError = `HTTP ${attempt.status} @ ${endpoint}: ${errorText.slice(0, 200)}`;
      if (attempt.status !== 404) {
        throw new Error(`Non-streaming API error ${lastEndpointError}`);
      }
    }

    if (!response) {
      throw new Error(`Non-streaming API error ${lastEndpointError || 'all endpoint candidates failed'}; tried ${endpoints.length} endpoint candidate(s)`);
    }

    const rawText = await response.text();
    const trimmed = rawText.trimStart();
    const data = trimmed.startsWith('data:')
      ? reassembleMindosOpenAISse(trimmed)
      : parseUnknownJson(rawText);

    if (!isRecord(data)) {
      throw new Error(`API returned invalid response: ${rawText.slice(0, 200)}`);
    }

    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = choices[0];
    if (!isRecord(choice)) throw new Error('Empty response from API');

    const message = isRecord(choice.message) ? choice.message : isRecord(choice.delta) ? choice.delta : {};
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop';

    if (typeof message.content === 'string' && message.content) {
      const chunkSize = 40;
      for (let i = 0; i < message.content.length; i += chunkSize) {
        send({ type: 'text_delta', delta: message.content.slice(i, i + chunkSize) });
        if (chunkDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, chunkDelayMs));
      }
    }

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (finishReason === 'stop' || toolCalls.length === 0) break;

    const toolResultMessages: MindosOpenAIMessage[] = [];
    for (const rawToolCall of toolCalls) {
      if (!isRecord(rawToolCall)) continue;
      const functionCall = isRecord(rawToolCall.function) ? rawToolCall.function : {};
      const toolName = typeof functionCall.name === 'string' ? functionCall.name : '';
      const toolCallId = typeof rawToolCall.id === 'string' ? rawToolCall.id : `call_${Date.now()}`;
      const parsedArgs = safeParseMindosJsonObject(
        typeof functionCall.arguments === 'string' ? functionCall.arguments : '{}',
      );

      const tool = toolMap.get(toolName);
      send({ type: 'tool_start', toolCallId, toolName, args: sanitizeToolArgs(toolName, parsedArgs) });

      let resultText = '';
      let isError = false;
      if (tool) {
        try {
          const result = await tool.execute(toolCallId, parsedArgs, signal);
          resultText = result.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text ?? '')
            .join('\n');
        } catch (error) {
          resultText = errorMessage(error);
          isError = true;
        }
      } else {
        resultText = `Tool "${toolName}" not found`;
        isError = true;
      }

      send({ type: 'tool_end', toolCallId, output: sanitizeToolOutput(resultText), isError });
      toolResultMessages.push({ role: 'tool', tool_call_id: toolCallId, content: resultText });
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });
    messages.push(...toolResultMessages);
  }
}

function parseUnknownJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function detectMindosAgentLoop(history: MindosAgentStepEntry[], threshold = 3): boolean {
  if (history.length < threshold) return false;

  const lastN = history.slice(-threshold);
  if (lastN.every((step) => step.tool === lastN[0]?.tool && step.input === lastN[0]?.input)) {
    return true;
  }

  if (history.length >= 4) {
    const window = history.slice(-8);
    for (let cycleLen = 2; cycleLen <= 4 && cycleLen * 2 <= window.length; cycleLen += 1) {
      const tail = window.slice(-cycleLen * 2);
      let toolsMatch = true;
      let anyArgsMatch = false;
      for (let i = 0; i < cycleLen; i += 1) {
        const left = tail[i];
        const right = tail[i + cycleLen];
        if (!left || !right || left.tool !== right.tool) {
          toolsMatch = false;
          break;
        }
        if (left.input === right.input) anyArgsMatch = true;
      }
      if (toolsMatch && anyArgsMatch) return true;
    }
  }

  return false;
}

export type MindosUiImagePart = {
  type: 'image';
  data?: string;
  mimeType?: string;
};

export type MindosUiTextPart = {
  type: 'text';
  text?: string;
};

export type MindosUiReasoningPart = {
  type: 'reasoning';
  text?: string;
};

export type MindosUiToolCallPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  output?: string;
  state?: 'pending' | 'running' | 'done' | 'error';
};

export type MindosUiRuntimeStatusPart = {
  type: 'runtime-status';
  message: string;
  runtime?: 'mindos' | 'acp' | 'codex' | 'claude';
};

export type MindosUiMessagePart =
  | MindosUiImagePart
  | MindosUiTextPart
  | MindosUiReasoningPart
  | MindosUiToolCallPart
  | MindosUiRuntimeStatusPart;

export type MindosUiAskMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  skillName?: string;
  parts?: MindosUiMessagePart[];
  images?: MindosUiImagePart[];
};

export type MindosAgentHistoryMessage = Record<string, unknown>;

export function toMindosAgentMessages(messages: MindosUiAskMessage[]): MindosAgentHistoryMessage[] {
  const result: MindosAgentHistoryMessage[] = [];

  for (const msg of messages) {
    const timestamp = msg.timestamp ?? Date.now();

    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: buildMindosUserContent(msg.content, msg.images),
        timestamp,
      });
      continue;
    }

    if (msg.content.startsWith('__error__')) continue;

    if (!msg.parts || msg.parts.length === 0) {
      if (msg.content) {
        result.push(createMindosAssistantHistoryMessage({
          content: [{ type: 'text', text: msg.content }],
          stopReason: 'stop',
          timestamp,
        }));
      }
      continue;
    }

    const assistantContent: Array<Record<string, unknown>> = [];
    const toolCalls: MindosUiToolCallPart[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text') {
        if (part.text) assistantContent.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool-call') {
        assistantContent.push({
          type: 'toolCall',
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.input ?? {},
        });
        toolCalls.push(part);
      } else if (part.type === 'runtime-status') {
        // UI-only runtime diagnostics should not become model conversation history.
      }
    }

    if (assistantContent.length > 0) {
      result.push(createMindosAssistantHistoryMessage({
        content: assistantContent,
        stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp,
      }));
    }

    for (const toolCall of toolCalls) {
      result.push({
        role: 'toolResult',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        content: [{ type: 'text', text: toolCall.output ?? '' }],
        isError: toolCall.state === 'error',
        timestamp,
      });
    }
  }

  return result;
}

function buildMindosUserContent(text: string, images?: MindosUiImagePart[]): string | Array<Record<string, unknown>> {
  const validImages = images?.filter((image) => image.data);
  if (!validImages || validImages.length === 0) return text;

  const parts: Array<Record<string, unknown>> = validImages.map((image) => ({
    type: 'image',
    data: image.data,
    mimeType: image.mimeType,
  }));
  if (text) parts.push({ type: 'text', text });
  return parts;
}

function createMindosAssistantHistoryMessage(input: {
  content: Array<Record<string, unknown>>;
  stopReason: 'stop' | 'toolUse';
  timestamp: number;
}): MindosAgentHistoryMessage {
  return {
    role: 'assistant',
    content: input.content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: input.stopReason,
    timestamp: input.timestamp,
  };
}

export {
  detectMindosAgentLoop as detectLoop,
  isMindosRetryableError as isRetryableError,
  isMindosTransientError as isTransientError,
  mindosRetryDelay as retryDelay,
  sleepMindos as sleep,
};
