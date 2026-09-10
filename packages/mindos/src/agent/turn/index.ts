import {
  sanitizeToolArgs,
  sanitizeToolOutput,
} from './tool-event-safety.js';
import {
  renderMindosContextPrompt,
  type MindosContextPromptSection,
} from '../prompt/context-prompt.js';

export { redactSensitiveObject, redactSensitiveText } from './redaction.js';
export {
  safeParseMindosJsonObject,
  sanitizeToolArgs,
  sanitizeToolOutput,
} from './tool-event-safety.js';
export {
  buildMindosCompatEndpointCandidates,
  mindosPiMessagesToOpenAI,
  parseMindosOpenAICompatResponse,
  reassembleMindosOpenAISse,
  runMindosNonStreamingFallback,
  runMindosOpenAICompatFallback,
} from './openai-compat-fallback.js';
export type {
  MindosNonStreamingFallbackOptions,
  MindosOpenAICompatChoice,
  MindosOpenAICompatCompletion,
  MindosOpenAICompatFallbackEvent,
  MindosOpenAICompatFallbackOptions,
  MindosOpenAIMessage,
  MindosOpenAIToolCall,
} from './openai-compat-fallback.js';
// Turn-execution control (retry / timeout) and the ACP lane live in sibling
// modules; re-exported here so the barrel stays the single import surface.
export {
  isMindosRetryableError,
  isMindosTransientError,
  mindosRetryDelay,
  resolveMindosAgentTimeoutMs,
  runMindosAgentTurnWithRetry,
  runMindosWithTimeout,
  sleepMindos,
} from './retry.js';
export type { MindosAgentTurnRetryOptions } from './retry.js';
export {
  mapMindosAcpUpdateToSseEvents,
  MindosAcpReportedError,
  runMindosAcpAgentTurn,
} from './acp-lane.js';
export type {
  MindosAcpAgentTurnCloseOptions,
  MindosAcpAgentTurnOptions,
  MindosAcpAgentTurnPromptOptions,
  MindosAcpAgentTurnResult,
  MindosAcpAgentTurnServices,
  MindosAcpAgentTurnSession,
  MindosAcpAgentTurnSessionOptions,
  MindosAcpSessionPoolKey,
  MindosAcpSessionUpdate,
  MindosAcpUpdateMappingOptions,
} from './acp-lane.js';
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
  let finalAnswerSteered = false;
  let lastModelError = '';
  const loopWarningMessage = options.loopWarningMessage
    ?? '[SYSTEM WARNING] You appear to be in a loop — repeating the same tool calls in a cycle. Try a completely different approach or ask the user for clarification.';
  const finalAnswerWarningMessage = '[SYSTEM WARNING] You have reached the tool step budget. Stop using tools and provide a concise final answer from the evidence already gathered.';

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
          if (toolResults.length > 0 && !finalAnswerSteered && !effect.steerMessage) {
            finalAnswerSteered = true;
            effect.steerMessage = finalAnswerWarningMessage;
            return effect;
          }
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
    if (!(MINDOS_AGENT_TURN_STREAM_EVENT_TYPES as readonly string[]).includes(parsed.type)) return null;
    return parsed as MindOSSSEvent;
  } catch {
    return null;
  }
}

export type MindosAgentFileValidationResult = {
  valid: boolean;
  newCumulativeSize: number;
  error?: string;
};

export const MINDOS_AGENT_DEFAULT_MAX_STEPS = 100;
export const MINDOS_AGENT_ATTACHMENT_MAX_CHARS = 20_000;

export type MindosAgentFileContextIssueCode =
  | 'content_too_large'
  | 'validation_failed'
  | 'read_failed';

export type MindosAgentFileContextIssue = {
  path: string;
  code: MindosAgentFileContextIssueCode;
  message: string;
  chars?: number;
  maxChars?: number;
};

export type MindosAgentFileContextServices = {
  readFile(filePath: string): string;
  truncate?: (content: string) => string;
  maxContentChars?: number;
  validateFileSize?: (filePath: string, cumulativeSize: number) => MindosAgentFileValidationResult;
  warn?: (message: string, error?: unknown) => void;
};

export type MindosAgentFileContextReference = {
  path: string;
  label: 'attached' | 'current';
  contentHash?: string;
  size?: number;
};

export type MindosAgentFileContext = {
  contextParts: string[];
  failedFiles: string[];
  fileIssues?: MindosAgentFileContextIssue[];
  fileReferences?: MindosAgentFileContextReference[];
  mode?: 'full' | 'reference';
};

export function normalizeMindosAgentStepLimit(options: {
  requestedMaxSteps?: unknown;
  agentMaxSteps?: number;
}): number {
  const defaultMaxSteps = options.agentMaxSteps ?? MINDOS_AGENT_DEFAULT_MAX_STEPS;
  const raw = typeof options.requestedMaxSteps === 'number' && Number.isFinite(options.requestedMaxSteps)
    ? options.requestedMaxSteps
    : defaultMaxSteps;
  return Math.min(999, Math.max(1, Number(raw)));
}

export function expandMindosAgentAttachedFiles(
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

export function loadMindosAgentFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
  services: MindosAgentFileContextServices,
): MindosAgentFileContext {
  const contextParts: string[] = [];
  const failedFiles: string[] = [];
  const fileIssues: MindosAgentFileContextIssue[] = [];
  const fileReferences: MindosAgentFileContextReference[] = [];
  const seen = new Set<string>();
  let cumulativeSize = 0;

  function appendFile(filePath: string, label: 'Attached file from the MindOS knowledge base' | 'Current file from the MindOS knowledge base') {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    const reference: MindosAgentFileContextReference = {
      path: filePath,
      label: label.startsWith('Attached') ? 'attached' : 'current',
    };
    fileReferences.push(reference);

    const validation = services.validateFileSize?.(filePath, cumulativeSize) ?? {
      valid: true,
      newCumulativeSize: cumulativeSize,
    };
    if (!validation.valid) {
      const message = validation.error ?? 'File could not be validated for AI context.';
      services.warn?.(`[agent] file size validation failed for "${filePath}": ${message}`);
      failedFiles.push(filePath);
      fileIssues.push({ path: filePath, code: 'validation_failed', message });
      return;
    }

    try {
      const raw = services.readFile(filePath);
      const maxContentChars = services.maxContentChars;
      if (typeof maxContentChars === 'number' && maxContentChars > 0 && raw.length > maxContentChars) {
        const message = `File "${filePath}" is too large for AI context: ${raw.length} chars (limit: ${maxContentChars}).`;
        reference.size = raw.length;
        services.warn?.(`[agent] attached file content too large for "${filePath}": ${raw.length} chars`);
        failedFiles.push(filePath);
        fileIssues.push({
          path: filePath,
          code: 'content_too_large',
          message,
          chars: raw.length,
          maxChars: maxContentChars,
        });
        return;
      }
      const content = services.truncate ? services.truncate(raw) : raw;
      reference.contentHash = stableMindosFileContextHash(raw);
      reference.size = raw.length;
      contextParts.push(`### ${label}: ${filePath}\n\n${content}`);
      cumulativeSize = validation.newCumulativeSize;
    } catch (error) {
      services.warn?.(`[agent] failed to read ${label.startsWith('Attached') ? 'attached file' : 'currentFile'} "${filePath}":`, error);
      failedFiles.push(filePath);
      fileIssues.push({
        path: filePath,
        code: 'read_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const filePath of attachedFiles ?? []) appendFile(filePath, 'Attached file from the MindOS knowledge base');
  if (currentFile) appendFile(currentFile, 'Current file from the MindOS knowledge base');

  return {
    contextParts,
    failedFiles,
    ...(fileIssues.length > 0 ? { fileIssues } : {}),
    fileReferences,
    mode: 'full',
  };
}

function stableMindosFileContextHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
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
  fileContext?: MindosAgentFileContext;
  uploadedParts?: string[];
  recalledKnowledge?: Array<{
    path: string;
    content: string;
    startLine?: number;
    endLine?: number;
    headingPath?: string[];
  }>;
};

export function buildMindosExternalRuntimePrompt(input: MindosExternalRuntimePromptInput): string {
  const prompt = input.prompt.trim();
  const sections: MindosContextPromptSection[] = [];

  if (input.fileContext?.contextParts.length) {
    sections.push({
      title: 'Attached files from the MindOS knowledge base',
      content: [
        'The following content already exists in MindOS and was explicitly attached for this turn. Cite stable paths when using it.',
        input.fileContext.contextParts.join('\n\n---\n\n'),
      ],
    });
  } else if (input.fileContext?.mode === 'reference' && input.fileContext.fileReferences?.length) {
    sections.push({
      title: 'Attached files from the MindOS knowledge base',
      content: [
        'These selected MindOS files are unchanged since the last turn, so their full content is not repeated. Use file tools to re-read exact content if needed.',
        input.fileContext.fileReferences.map((file) => `- ${file.label === 'current' ? 'Current' : 'Attached'}: ${file.path}`).join('\n'),
      ],
    });
  }

  if (input.uploadedParts?.length) {
    sections.push({
      title: 'Files uploaded by the user for this request',
      content: [
        'The user uploaded the following file content for this turn. It may not exist in the MindOS knowledge base yet; use it directly unless it is saved first.',
        input.uploadedParts.join('\n\n---\n\n'),
      ],
    });
  }

  if (input.recalledKnowledge?.length) {
    const block = input.recalledKnowledge
      .map((item) => {
        const hasLineRange = Number.isFinite(item.startLine) && Number.isFinite(item.endLine);
        const location = hasLineRange ? `${item.path}:${item.startLine}-${item.endLine}` : item.path;
        const heading = item.headingPath?.filter(Boolean).join(' > ');
        return [
          `### ${location}`,
          heading ? `Heading: ${heading}` : '',
          item.content,
        ].filter(Boolean).join('\n\n');
      })
      .join('\n\n---\n\n');
    sections.push({
      title: 'Auto-Recalled MindOS Knowledge',
      content: [
        'MindOS found these related note excerpts for the user request. They may be partial. Cite file paths and line ranges when relying on them.',
        block,
      ],
    });
  }

  if (input.fileContext?.failedFiles.length) {
    sections.push({
      title: 'Unavailable MindOS Context',
      content: `These attached files could not be loaded: ${input.fileContext.failedFiles.join(', ')}`,
    });
  }

  return renderMindosContextPrompt({
    prompt,
    sections,
    selectedSkills: [],
  });
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

export type MindosUiAgentMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  skillName?: string;
  parts?: MindosUiMessagePart[];
  images?: MindosUiImagePart[];
};

export type MindosAgentHistoryMessage = Record<string, unknown>;

export function toMindosAgentMessages(messages: MindosUiAgentMessage[]): MindosAgentHistoryMessage[] {
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

export { detectMindosAgentLoop as detectLoop };
export {
  isMindosRetryableError as isRetryableError,
  isMindosTransientError as isTransientError,
  mindosRetryDelay as retryDelay,
  sleepMindos as sleep,
} from './retry.js';
