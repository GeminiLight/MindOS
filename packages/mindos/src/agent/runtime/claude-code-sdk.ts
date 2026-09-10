import {
  createClaudeStreamJsonMapperState,
  mapClaudeStreamJsonRecordToSseEvents,
} from './claude-stream-json-mapper.js';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { nativeImport } from '../../foundation/native-import.js';
import type {
  MindosRuntimePermissionRequest,
  MindosRuntimePermissionResult,
  MindosRuntimeUserQuestion,
  MindosRuntimeUserQuestionAnswer,
  MindosRuntimeUserQuestionRequest,
  MindosRuntimeUserQuestionResult,
} from './run.js';
import type { ClaudeCodeCliClient } from './claude-code-cli.js';
import { mindosSelectedSkillNames } from '../selected-skills.js';
import {
  getMindosRuntimeAttachmentImages,
  readMindosRuntimeImageAsBase64,
  type MindosRuntimeAttachment,
} from './attachments.js';
import { buildRuntimePermissionRequest } from './lane-runner.js';

export type ClaudeCodeSdkQuery = AsyncIterable<Record<string, unknown>> & {
  interrupt?(): Promise<void>;
  close?(): void;
};

export type ClaudeCodeSdkTextBlock = {
  type: 'text';
  text: string;
};

export type ClaudeCodeSdkImageBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
};

export type ClaudeCodeSdkUserMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: Array<ClaudeCodeSdkTextBlock | ClaudeCodeSdkImageBlock>;
  };
  parent_tool_use_id: null;
};

export type ClaudeCodeSdkPrompt = string | AsyncIterable<ClaudeCodeSdkUserMessage>;

export type ClaudeCodeSdkModule = {
  query(params: {
    prompt: ClaudeCodeSdkPrompt;
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

// Lazy: a module-scope `createRequire(import.meta.url)` would crash the whole
// agent runtime import graph if a bundler ships this file with a broken
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
      const state = createClaudeStreamJsonMapperState();
      let lastSessionId: string | null = null;
      const selectedSkillNames = mindosSelectedSkillNames(input.selectedSkills);
      const prompt = await createClaudeCodeSdkPrompt(input.prompt, input.attachments);
      queryHandle = services.sdk.query({
        prompt,
        options: {
          cwd: input.cwd,
          outputFormat: 'stream-json',
          ...(input.model ? { model: input.model } : {}),
          ...(input.effort ? { effort: input.effort } : {}),
          permissionMode: input.permissionMode ?? 'default',
          ...(selectedSkillNames.length > 0 ? { skills: selectedSkillNames } : {}),
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

          for (const event of mapClaudeStreamJsonRecordToSseEvents(message, state)) {
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

async function createClaudeCodeSdkPrompt(
  prompt: string,
  attachments: MindosRuntimeAttachment[] | undefined,
): Promise<ClaudeCodeSdkPrompt> {
  const imageBlocks: ClaudeCodeSdkImageBlock[] = [];
  for (const attachment of getMindosRuntimeAttachmentImages(attachments)) {
    const data = await readMindosRuntimeImageAsBase64(attachment);
    if (!data) continue;
    imageBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType ?? 'image/png',
        data,
      },
    });
  }

  if (imageBlocks.length === 0) return prompt;
  return createClaudeCodeSdkUserMessageIterable([
    ...imageBlocks,
    { type: 'text', text: prompt },
  ]);
}

function createClaudeCodeSdkUserMessageIterable(
  content: Array<ClaudeCodeSdkTextBlock | ClaudeCodeSdkImageBlock>,
): AsyncIterable<ClaudeCodeSdkUserMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'user',
        message: {
          role: 'user',
          content,
        },
        parent_tool_use_id: null,
      };
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
  // Shared permission shaping (spec-runtime-lane-contract 方案 8): the Claude
  // SDK lane only offers acceptForSession when the SDK supplied session rules
  // to persist; the option set itself comes from the single source.
  return buildRuntimePermissionRequest({
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
    ...(options.title ?? options.description ?? options.decisionReason
      ? { reason: options.title ?? options.description ?? options.decisionReason }
      : {}),
    allowSessionScope: hasSessionSuggestion,
  });
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
