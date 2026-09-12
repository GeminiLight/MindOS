import {
  sanitizeToolArgs,
  sanitizeToolOutput,
} from './tool-event-safety.js';
import {
  type MindOSSSEvent,
} from './sse.js';
import {
  renderMindosContextPrompt,
  type MindosContextPromptSection,
} from '../prompt/context-prompt.js';

export { redactSensitiveObject, redactSensitiveText } from '../../foundation/security/redaction.js';
// Turn-request wire contract and context-omission signatures are shared by the
// Product Server handler and the Next host route; the barrel stays the single
// import surface (spec-runtime-lane-contract).
export * from './request.js';
export * from './context.js';
export {
  safeParseMindosJsonObject,
  sanitizeToolArgs,
  sanitizeToolOutput,
} from './tool-event-safety.js';
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
// Turn-clock suspension while permission / question bridge waits are pending
// (spec-runtime-lane-contract item 3); the timeout helpers consult it.
export * from './turn-deadline.js';
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

// The SSE wire surface lives in a sibling module; re-exported explicitly so
// the barrel stays the single import surface (contract: opencode-architecture
// -alignment pins these names on this file).
export {
  encodeMindosSseEvent,
  isHiddenMindosSseStatusEvent,
  MINDOS_AGENT_TURN_SSE_HEARTBEAT_EVENT,
  MINDOS_AGENT_TURN_SSE_HEARTBEAT_MS,
  MINDOS_AGENT_TURN_STREAM_EVENT_TYPES,
  MINDOS_SSE_HEADERS,
  startMindosAgentTurnSseHeartbeat,
} from './sse.js';
export type { MindOSSSEvent } from './sse.js';

export * from './ui-events.js';
import {
  isRecord, isTextDeltaEvent, getTextDelta, isThinkingDeltaEvent, getThinkingDelta,
  isToolExecutionStartEvent, getToolExecutionStart, isToolExecutionEndEvent,
  getToolExecutionEnd, isTurnEndEvent, getTurnEndData,
} from './ui-events.js';

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

        if (stepCount >= options.stepLimit && toolResults.length > 0) {
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


export { parseMindosSseLine } from './ui-events.js';

export type MindosAgentFileValidationResult = {
  valid: boolean;
  newCumulativeSize: number;
  error?: string;
};

export const MINDOS_AGENT_DEFAULT_MAX_STEPS = 100;
export { MINDOS_AGENT_ATTACHMENT_MAX_CHARS } from './attachment-limits.js';
import { MINDOS_AGENT_ATTACHMENT_MAX_CHARS } from './attachment-limits.js';

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

// UI message types + the UI-message → model-history conversion live in a
// sibling module; re-exported explicitly so the barrel surface is unchanged.
export { toMindosAgentMessages } from './ui-messages.js';
export type {
  MindosAgentHistoryMessage,
  MindosUiAgentMessage,
  MindosUiImagePart,
  MindosUiMessagePart,
  MindosUiReasoningPart,
  MindosUiRuntimeStatusPart,
  MindosUiTextPart,
  MindosUiToolCallPart,
} from './ui-messages.js';

export { detectMindosAgentLoop as detectLoop };
export {
  isMindosRetryableError as isRetryableError,
  isMindosTransientError as isTransientError,
  mindosRetryDelay as retryDelay,
  sleepMindos as sleep,
} from './retry.js';

export { executeAgentTurn, executeMindosPiRuntimeTurn } from './execute.js';
export type { AgentTurnResult } from './execute.js';
