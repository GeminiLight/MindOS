import {
  redactSensitiveText,
  sanitizeToolArgs,
  sanitizeToolOutput,
  type MindOSSSEvent,
} from '../session/index.js';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { nativeImport } from '../foundation/native-import.js';
import type {
  MindosRuntimePermissionRequest,
  MindosRuntimePermissionResult,
  MindosRuntimeUserQuestion,
  MindosRuntimeUserQuestionAnswer,
  MindosRuntimeUserQuestionRequest,
  MindosRuntimeUserQuestionResult,
} from './run.js';
import type { ClaudeCodeCliClient } from './claude-code-cli.js';

export type ClaudeCodeSdkQuery = AsyncIterable<Record<string, unknown>> & {
  interrupt?(): Promise<void>;
  close?(): void;
};

export type ClaudeCodeSdkModule = {
  query(params: {
    prompt: string;
    options?: Record<string, unknown>;
  }): ClaudeCodeSdkQuery;
};

export const CLAUDE_CODE_SDK_BINARY_SENTINEL = 'sdk:@anthropic-ai/claude-agent-sdk';

export type ClaudeCodeSdkNativeBinaryResolution = {
  platformKey: string;
  candidates: string[];
  path?: string;
  reason?: string;
};

export type ClaudeCodeSdkClientServices = {
  sdk: ClaudeCodeSdkModule;
  pathToClaudeCodeExecutable?: string;
  env?: NodeJS.ProcessEnv;
  requestRuntimePermission?(
    request: MindosRuntimePermissionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimePermissionResult>;
  requestUserQuestion?(
    request: MindosRuntimeUserQuestionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimeUserQuestionResult>;
};

type ClaudeCodeSdkState = {
  emittedText: boolean;
  emittedDone: boolean;
};

// Lazy: a module-scope `createRequire(import.meta.url)` would crash the whole
// agent-runtime import graph if a bundler ships this file with a broken
// import.meta — keep the failure scoped to binary resolution (which already
// degrades gracefully to the CLI fallback).
let lazyRequireFromHere: NodeRequire | undefined;
function requireFromHere(): NodeRequire {
  lazyRequireFromHere ??= createRequire(import.meta.url);
  return lazyRequireFromHere;
}

let sdkModulePromise: Promise<ClaudeCodeSdkModule> | undefined;

export async function loadClaudeCodeSdkModule(): Promise<ClaudeCodeSdkModule> {
  // Bundler-proof: the SDK spawns its CLI via paths derived from import.meta;
  // a webpack-inlined copy breaks that (see foundation/native-import.ts).
  sdkModulePromise ??= nativeImport<ClaudeCodeSdkModule>('@anthropic-ai/claude-agent-sdk');
  return sdkModulePromise;
}

export function resolveClaudeCodeSdkNativeBinaryPath(input: {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  isMusl?: boolean;
  requireResolve?: (id: string) => string;
  exists?: (path: string) => boolean;
} = {}): ClaudeCodeSdkNativeBinaryResolution {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const isMusl = input.isMusl ?? isMuslRuntime(platform);
  const candidates = claudeCodeSdkNativeBinaryCandidates(platform, arch, isMusl);
  const requireResolve = input.requireResolve ?? createClaudeCodeSdkPackageRequireResolve();
  const exists = input.exists ?? existsSync;
  const platformKey = platform === 'linux' && isMusl ? `${platform}-${arch}-musl` : `${platform}-${arch}`;

  if (candidates.length === 0) {
    return {
      platformKey,
      candidates,
      reason: `Claude Agent SDK does not publish a native CLI binary for ${platformKey}.`,
    };
  }

  for (const candidate of candidates) {
    try {
      const resolved = requireResolve(candidate);
      if (exists(resolved)) {
        return { platformKey, candidates, path: resolved };
      }
    } catch {
      // Try the next platform package candidate.
    }
  }

  return {
    platformKey,
    candidates,
    reason: `Claude Agent SDK native CLI binary for ${platformKey} was not found. Install the local Claude Code CLI or pass options.pathToClaudeCodeExecutable.`,
  };
}

function createClaudeCodeSdkPackageRequireResolve(): (id: string) => string {
  try {
    // Resolve platform binary packages relative to the SDK itself (they are
    // the SDK's optional deps, not necessarily visible from here). Avoids
    // `import.meta.resolve`, which webpack neither supports nor tolerates.
    const sdkPackageJson = requireFromHere().resolve('@anthropic-ai/claude-agent-sdk/package.json');
    const requireFromSdk = createRequire(sdkPackageJson);
    return requireFromSdk.resolve.bind(requireFromSdk);
  } catch {
    const fallback = requireFromHere();
    return fallback.resolve.bind(fallback);
  }
}

export function isClaudeCodeSdkNativeBinaryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Native CLI binary for .+ not found/i.test(message)
    || /Claude Code native binary .*not found/i.test(message)
    || /pathToClaudeCodeExecutable/i.test(message);
}

function claudeCodeSdkNativeBinaryCandidates(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  isMusl: boolean,
): string[] {
  if (arch !== 'x64' && arch !== 'arm64') return [];
  const suffix = platform === 'win32' ? '/claude.exe' : '/claude';
  if (platform === 'darwin') return [`@anthropic-ai/claude-agent-sdk-darwin-${arch}${suffix}`];
  if (platform === 'win32') return [`@anthropic-ai/claude-agent-sdk-win32-${arch}${suffix}`];
  if (platform === 'linux') {
    const glibc = `@anthropic-ai/claude-agent-sdk-linux-${arch}${suffix}`;
    const musl = `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl${suffix}`;
    return isMusl ? [musl, glibc] : [glibc, musl];
  }
  return [];
}

function isMuslRuntime(platform: NodeJS.Platform): boolean {
  if (platform !== 'linux') return false;
  try {
    const report = typeof process.report?.getReport === 'function'
      ? process.report.getReport()
      : null;
    const header = report && typeof report === 'object' && 'header' in report && report.header && typeof report.header === 'object'
      ? report.header as { glibcVersionRuntime?: unknown }
      : undefined;
    return header?.glibcVersionRuntime === undefined;
  } catch {
    return false;
  }
}

export function createClaudeCodeSdkClient(services: ClaudeCodeSdkClientServices): ClaudeCodeCliClient {
  let queryHandle: ClaudeCodeSdkQuery | null = null;

  return {
    async *startTurn(input) {
      const state: ClaudeCodeSdkState = { emittedText: false, emittedDone: false };
      let lastSessionId: string | null = null;
      queryHandle = services.sdk.query({
        prompt: input.prompt,
        options: {
          cwd: input.cwd,
          outputFormat: 'stream-json',
          permissionMode: input.permissionMode ?? 'default',
          ...(services.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: services.pathToClaudeCodeExecutable } : {}),
          ...(services.env ? { env: services.env } : {}),
          ...(input.sessionId ? { resume: input.sessionId } : {}),
          canUseTool: createClaudeCodeSdkPermissionHandler(services),
        },
      });

      const abort = () => {
        void queryHandle?.interrupt?.().catch(() => {});
        queryHandle?.close?.();
      };
      input.signal?.addEventListener('abort', abort, { once: true });

      const queryIterator = queryHandle[Symbol.asyncIterator]();
      let completed = false;

      try {
        while (true) {
          const next = await nextClaudeSdkQueryMessage(queryIterator, input.signal);
          if (next.done) {
            completed = true;
            break;
          }
          const message = next.value;
          const sessionId = getStringField(message, 'session_id');
          if (sessionId && sessionId !== lastSessionId) {
            lastSessionId = sessionId;
            yield { type: 'session_id', sessionId };
          }

          for (const event of mapClaudeCodeSdkMessageToSseEvents(message, state)) {
            yield event;
          }
        }

        if (!state.emittedDone) {
          yield { type: 'done' };
        }
      } finally {
        input.signal?.removeEventListener('abort', abort);
        if (!completed) {
          settleClaudeSdkIteratorReturn(queryIterator);
        }
      }
    },
    close() {
      queryHandle?.close?.();
    },
  };
}

function claudeSdkAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(reason ? String(reason) : 'Claude Agent SDK query aborted.');
}

function throwIfClaudeSdkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw claudeSdkAbortError(signal);
  }
}

function settleClaudeSdkIteratorReturn(iterator: AsyncIterator<Record<string, unknown>>): void {
  const result = iterator.return?.();
  if (result && typeof (result as PromiseLike<IteratorResult<Record<string, unknown>>>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
  }
}

async function nextClaudeSdkQueryMessage(
  iterator: AsyncIterator<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<IteratorResult<Record<string, unknown>>> {
  throwIfClaudeSdkAborted(signal);

  const nextPromise = Promise.resolve(iterator.next());
  nextPromise.catch(() => {});
  if (!signal) return nextPromise;

  let removeAbortListener = () => {};
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(claudeSdkAbortError(signal));
    removeAbortListener = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
  });

  try {
    return await Promise.race([nextPromise, abortPromise]);
  } catch (error) {
    if (signal.aborted) throw claudeSdkAbortError(signal);
    throw error;
  } finally {
    removeAbortListener();
  }
}

function createClaudeCodeSdkPermissionHandler(services: ClaudeCodeSdkClientServices) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      suggestions?: unknown[];
      blockedPath?: string;
      decisionReason?: string;
      title?: string;
      displayName?: string;
      description?: string;
      toolUseID: string;
      agentID?: string;
    },
  ): Promise<Record<string, unknown>> => {
    if (isAskUserQuestionToolName(toolName)) {
      const result = services.requestUserQuestion
        ? await services.requestUserQuestion(buildClaudeSdkUserQuestionRequest(toolName, input, options), { signal: options.signal })
        : { answers: [], cancelled: true, error: 'no_bridge' };
      return claudeSdkAskUserQuestionPermissionResult(input, result, options.toolUseID);
    }

    const permissionRequest = buildClaudeSdkPermissionRequest(toolName, input, options);
    const result = services.requestRuntimePermission
      ? await services.requestRuntimePermission(permissionRequest, { signal: options.signal })
      : { decision: 'cancel', cancelled: true };
    return claudeSdkPermissionResult(result, input, options);
  };
}

function buildClaudeSdkPermissionRequest(
  toolName: string,
  input: Record<string, unknown>,
  options: {
    suggestions?: unknown[];
    blockedPath?: string;
    decisionReason?: string;
    title?: string;
    displayName?: string;
    description?: string;
    toolUseID: string;
    agentID?: string;
  },
): MindosRuntimePermissionRequest {
  const hasSessionSuggestion = Array.isArray(options.suggestions) && options.suggestions.length > 0;
  return {
    runtime: 'claude',
    toolCallId: options.toolUseID,
    toolName,
    input: {
      ...input,
      ...(options.agentID ? { agentID: options.agentID } : {}),
      ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
      ...(options.displayName ? { displayName: options.displayName } : {}),
      ...(options.description ? { description: options.description } : {}),
    },
    reason: options.title ?? options.description ?? options.decisionReason,
    options: [
      { id: 'accept', label: 'Allow once', description: 'Run this action one time.', intent: 'allow' },
      ...(hasSessionSuggestion ? [{
        id: 'acceptForSession',
        label: 'Allow for session',
        description: 'Allow matching Claude Code actions for the rest of this session.',
        intent: 'allow' as const,
      }] : []),
      { id: 'decline', label: 'Deny', description: 'Reject this action.', intent: 'deny' },
    ],
  };
}

function claudeSdkPermissionResult(
  result: MindosRuntimePermissionResult,
  input: Record<string, unknown>,
  options: {
    suggestions?: unknown[];
    toolUseID: string;
  },
): Record<string, unknown> {
  if (result.cancelled || result.decision === 'cancel' || result.decision === 'decline') {
    return {
      behavior: 'deny',
      message: 'Denied in MindOS.',
      toolUseID: options.toolUseID,
      decisionClassification: 'user_reject',
    };
  }

  return {
    behavior: 'allow',
    updatedInput: input,
    toolUseID: options.toolUseID,
    decisionClassification: result.decision === 'acceptForSession' ? 'user_permanent' : 'user_temporary',
    ...(result.decision === 'acceptForSession' && Array.isArray(options.suggestions) && options.suggestions.length > 0
      ? { updatedPermissions: options.suggestions }
      : {}),
  };
}

function buildClaudeSdkUserQuestionRequest(
  toolName: string,
  input: Record<string, unknown>,
  options: {
    toolUseID: string;
    title?: string;
    description?: string;
  },
): MindosRuntimeUserQuestionRequest {
  const questions = normalizeClaudeSdkUserQuestions(input);
  return {
    runtime: 'claude',
    toolCallId: options.toolUseID,
    questions: questions.length > 0 ? questions : [{
      header: options.title ?? 'Claude Code question',
      question: options.description ?? 'Claude Code needs your input to continue.',
      options: [
        { label: 'Continue', description: 'Continue this Claude Code run.' },
        { label: 'Cancel', description: 'Cancel this request.' },
      ],
    }],
  };
}

function claudeSdkAskUserQuestionPermissionResult(
  input: Record<string, unknown>,
  result: MindosRuntimeUserQuestionResult,
  toolUseID: string,
): Record<string, unknown> {
  if (result.cancelled || result.error) {
    return {
      behavior: 'deny',
      message: result.error ?? 'The user did not answer the questions.',
      toolUseID,
      decisionClassification: 'user_reject',
    };
  }

  const questions = normalizeClaudeSdkUserQuestions(input);
  const answers = answersByQuestion(questions, result.answers);
  if (Object.keys(answers).length === 0) {
    return {
      behavior: 'deny',
      message: 'The user did not answer the questions.',
      toolUseID,
      decisionClassification: 'user_reject',
    };
  }

  return {
    behavior: 'allow',
    updatedInput: {
      questions,
      answers,
    },
    toolUseID,
    decisionClassification: 'user_temporary',
  };
}

function normalizeClaudeSdkUserQuestions(input: Record<string, unknown>): MindosRuntimeUserQuestion[] {
  const rawQuestions = Array.isArray(input.questions)
    ? input.questions
    : isRecord(input.input) && Array.isArray(input.input.questions)
      ? input.input.questions
      : [];

  return rawQuestions.filter(isRecord).map((question, index) => ({
    question: getStringField(question, 'question')
      ?? getStringField(question, 'text')
      ?? getStringField(question, 'message')
      ?? `Question ${index + 1}`,
    header: getStringField(question, 'header')
      ?? getStringField(question, 'title')
      ?? `Question ${index + 1}`,
    multiSelect: question.multiSelect === true || question.multiselect === true,
    options: normalizeClaudeSdkUserQuestionOptions(question.options),
  }));
}

function normalizeClaudeSdkUserQuestionOptions(value: unknown): MindosRuntimeUserQuestion['options'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option): MindosRuntimeUserQuestion['options'] => {
    if (typeof option === 'string' && option.trim()) {
      return [{ label: option, description: option }];
    }
    if (!isRecord(option)) return [];
    const label = getStringField(option, 'label')
      ?? getStringField(option, 'value')
      ?? getStringField(option, 'title');
    if (!label) return [];
    return [{
      label,
      description: getStringField(option, 'description') ?? getStringField(option, 'hint') ?? label,
      ...(getStringField(option, 'preview') ? { preview: getStringField(option, 'preview') } : {}),
    }];
  });
}

function answersByQuestion(
  questions: MindosRuntimeUserQuestion[],
  answers: MindosRuntimeUserQuestionAnswer[],
): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const answer of answers) {
    const question = questions[answer.questionIndex];
    const questionText = question?.question ?? answer.question;
    if (!questionText) continue;
    if (Array.isArray(answer.selected) && answer.selected.length > 0) {
      output[questionText] = answer.selected;
      continue;
    }
    if (typeof answer.answer === 'string' && answer.answer.trim()) {
      output[questionText] = answer.answer;
      continue;
    }
    if (typeof answer.notes === 'string' && answer.notes.trim()) {
      output[questionText] = answer.notes;
    }
  }
  return output;
}

function mapClaudeCodeSdkMessageToSseEvents(
  message: Record<string, unknown>,
  state: ClaudeCodeSdkState,
): MindOSSSEvent[] {
  if (message.type === 'assistant' || message.type === 'user') {
    return contentBlocksFromRecord(message).flatMap((block) => mapClaudeContentBlock(block, state));
  }

  if (message.type === 'system' && message.subtype === 'api_retry') {
    return mapClaudeApiRetryRecord(message);
  }

  if (message.type === 'system' && message.subtype === 'permission_denied') {
    return mapClaudePermissionDeniedRecord(message);
  }

  if (message.type === 'system' && message.subtype === 'status') {
    return mapClaudeStatusRecord(message);
  }

  if (message.type === 'rate_limit_event') {
    return mapClaudeRateLimitRecord(message);
  }

  if (message.type === 'tool_progress') {
    const toolName = getStringField(message, 'tool_name') ?? 'tool';
    const elapsed = getNumberField(message, 'elapsed_time_seconds');
    return [{
      type: 'status',
      visible: true,
      runtime: 'claude',
      message: elapsed !== undefined
        ? `Claude Code is still running ${toolName} (${Math.round(elapsed)}s).`
        : `Claude Code is still running ${toolName}.`,
    }];
  }

  if (message.type === 'result') {
    state.emittedDone = true;
    if (message.is_error === true || message.subtype !== 'success') {
      return [{ type: 'error', message: redactSensitiveText(getResultErrorText(message) || 'Claude Code turn failed') }];
    }
    const resultText = getStringField(message, 'result');
    return [
      ...(!state.emittedText && resultText ? [{ type: 'text_delta' as const, delta: resultText }] : []),
      { type: 'done' },
    ];
  }

  return [];
}

function mapClaudeApiRetryRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const attempt = getNumberField(record, 'attempt');
  const maxRetries = getNumberField(record, 'max_retries');
  const retryDelayMs = getNumberField(record, 'retry_delay_ms');
  const errorStatus = getNumberField(record, 'error_status');
  const error = getStringField(record, 'error');
  const retrySeconds = retryDelayMs !== undefined ? Math.max(1, Math.round(retryDelayMs / 1000)) : null;
  const attemptText = attempt !== undefined && maxRetries !== undefined
    ? ` (${attempt}/${maxRetries})`
    : '';
  const statusText = errorStatus ? `HTTP ${errorStatus}` : (error ?? 'API request failed');
  const delayText = retrySeconds ? ` Retrying in ${retrySeconds}s.` : ' Retrying.';
  return [{
    type: 'status',
    visible: true,
    runtime: 'claude',
    message: `Claude Code ${statusText}; retrying${attemptText}.${delayText}`,
  }];
}

function mapClaudeStatusRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const status = getStringField(record, 'status');
  if (status === 'compacting') {
    return [{ type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is compacting context.' }];
  }
  if (status === 'requesting') {
    return [{ type: 'status', visible: true, runtime: 'claude', message: 'Claude Code is contacting Claude.' }];
  }
  return [];
}

function mapClaudeRateLimitRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const info = isRecord(record.rate_limit_info) ? record.rate_limit_info : null;
  const status = getStringField(info, 'status');
  if (!status || status === 'allowed') return [];
  const reset = getNumberField(info, 'resetsAt');
  const resetText = reset ? ` Resets ${new Date(reset).toLocaleString()}.` : '';
  return [{
    type: 'status',
    visible: true,
    runtime: 'claude',
    message: `Claude Code rate limit is ${status.replace(/_/g, ' ')}.${resetText}`,
  }];
}

function mapClaudePermissionDeniedRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const toolCallId = getStringField(record, 'tool_use_id')
    ?? getStringField(record, 'toolUseID')
    ?? getStringField(record, 'toolUseId')
    ?? getStringField(record, 'tool_call_id')
    ?? getStringField(record, 'id')
    ?? `claude-permission-denied-${Date.now().toString(36)}`;
  const toolName = getStringField(record, 'tool_name')
    ?? getStringField(record, 'toolName')
    ?? getStringField(record, 'name')
    ?? 'permission_denied';
  const message = getStringField(record, 'message')
    ?? getStringField(record, 'reason')
    ?? getStringField(record, 'decision_reason')
    ?? 'Claude Code denied this tool call.';
  return [
    {
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, {
        ...(getStringField(record, 'decision_reason') ? { reason: getStringField(record, 'decision_reason') } : {}),
      }),
      runtime: 'claude',
    },
    {
      type: 'tool_end',
      toolCallId,
      output: sanitizeToolOutput(message),
      isError: true,
      runtime: 'claude',
    },
  ];
}

function mapClaudeContentBlock(
  block: Record<string, unknown>,
  state: ClaudeCodeSdkState,
): MindOSSSEvent[] {
  if (block.type === 'text') {
    const text = getStringField(block, 'text');
    if (!text) return [];
    state.emittedText = true;
    return [{ type: 'text_delta', delta: text }];
  }

  if (block.type === 'thinking') {
    const text = getStringField(block, 'thinking') ?? getStringField(block, 'text');
    return text ? [{ type: 'thinking_delta', delta: text }] : [];
  }

  if (block.type === 'tool_use') {
    const toolCallId = getStringField(block, 'id');
    const toolName = getStringField(block, 'name');
    if (!toolCallId || !toolName) return [];
    return [{
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, block.input),
      runtime: 'claude',
    }];
  }

  if (block.type === 'tool_result') {
    const toolCallId = getStringField(block, 'tool_use_id');
    if (!toolCallId) return [];
    return [{
      type: 'tool_end',
      toolCallId,
      output: sanitizeToolOutput(stringifyClaudeToolResult(block.content)),
      isError: block.is_error === true,
      runtime: 'claude',
    }];
  }

  return [];
}

function contentBlocksFromRecord(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = isRecord(record.message) ? record.message : null;
  const content = Array.isArray(message?.content) ? message.content : record.content;
  if (typeof content === 'string' && content) {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    const block = isRecord(item) ? item : null;
    return block ? [block] : [];
  });
}

function stringifyClaudeToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const block = isRecord(item) ? item : null;
      return getStringField(block, 'text') ?? JSON.stringify(item);
    }).join('\n');
  }
  return value === undefined ? '' : JSON.stringify(value);
}

function getResultErrorText(record: Record<string, unknown>): string {
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return errors.join('\n') || getStringField(record, 'result') || getStringField(record, 'message') || '';
}

function isAskUserQuestionToolName(toolName: string): boolean {
  const shortName = toolName.split('__').pop() ?? toolName;
  return shortName === 'AskUserQuestion';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getStringField(record: Record<string, unknown> | null, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === 'string' && value ? value : undefined;
}

function getNumberField(record: Record<string, unknown> | null, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
