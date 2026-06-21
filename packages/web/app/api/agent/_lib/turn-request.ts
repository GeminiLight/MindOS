import type {
  MindosActiveAssistantPrompt,
} from '@geminilight/mindos/agent';
import type {
  AgentMode,
  AgentPermissionMode,
  AgentRuntimeIdentity,
  RuntimeSessionBinding,
  NativeRuntimeOptions,
  NativeRuntimeEffort,
  SessionContextSelection,
  SessionWorkDir,
  Message as FrontendMessage,
} from '@/lib/types';
import { apiError, ErrorCodes } from '@/lib/errors';

export type AgentTurnRequestBody = {
  messages: FrontendMessage[];
  /** Per-turn agent behavior. Behavior defaults to the normal agent loop. */
  agentMode?: AgentMode;
  /** Per-turn permission policy compiled by each runtime adapter. */
  permissionMode?: AgentPermissionMode;
  currentFile?: string;
  attachedFiles?: string[];
  uploadedFiles?: Array<{
    name: string;
    content: string;
    mimeType?: string;
    size?: number;
    dataBase64?: string;
  }>;
  maxSteps?: number;
  /** Assistant binding. This is not an ask mode. */
  assistantId?: string;
  /** ACP agent selection: if present, route to ACP instead of MindOS */
  selectedAcpAgent?: { id: string; name: string } | null;
  /** Unified runtime selection. ACP values mirror selectedAcpAgent for compatibility. */
  selectedRuntime?: AgentRuntimeIdentity | null;
  /** Typed external runtime binding for native Codex/Claude resume. */
  runtimeBinding?: RuntimeSessionBinding | null;
  /** Session-bound execution cwd. */
  workDir?: SessionWorkDir;
  /** Dynamic selected Spaces / Assistants for this turn. */
  contextSelection?: SessionContextSelection;
  /** Per-request provider override from the chat panel capsule */
  providerOverride?: string;
  /** Per-request model override from the inline model picker */
  modelOverride?: string;
  /** Per-request native runtime controls for Codex / Claude Code. */
  runtimeOptions?: NativeRuntimeOptions;
  /** Per-request MindOS PI agent controls. */
  agentOptions?: { enableThinking?: boolean; thinkingBudget?: number };
  /** MindOS Chat Panel session id for run ledger correlation. */
  chatSessionId?: string;
};

export type AgentSessionTurnRouteContext = {
  params?: Promise<{ sessionId?: string }> | { sessionId?: string };
};

export type AgentTurnRequestContext = {
  headers?: Headers;
  signal?: AbortSignal;
  request?: Request;
  activeAssistant?: MindosActiveAssistantPrompt;
};

export function normalizeNativeRuntimeOptions(value: unknown): NativeRuntimeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const reasoningEffort = record.reasoningEffort === 'low'
    || record.reasoningEffort === 'medium'
    || record.reasoningEffort === 'high'
    || record.reasoningEffort === 'xhigh'
    ? record.reasoningEffort as NativeRuntimeEffort
    : undefined;
  const modelOverride = typeof record.modelOverride === 'string' && record.modelOverride.trim()
    ? record.modelOverride.trim()
    : undefined;
  return {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(modelOverride ? { modelOverride } : {}),
  };
}

export function validateNativeRuntimeOptions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const unknown = firstUnknownField(record, NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions');
  if (unknown) {
    return apiError(
      ErrorCodes.INVALID_REQUEST,
      unknown,
      400,
    );
  }
  return null;
}

export function normalizeAgentMode(value: unknown): AgentMode | undefined {
  return value === 'default' || value === 'plan' || value === 'goal'
    ? value
    : undefined;
}

export function normalizeAgentPermissionMode(value: unknown): AgentPermissionMode | undefined {
  return value === 'read' || value === 'ask' || value === 'auto' || value === 'full'
    ? value
    : undefined;
}

export function validateAgentMode(value: unknown) {
  if (value === undefined || normalizeAgentMode(value)) return null;
  return apiError(
    ErrorCodes.INVALID_REQUEST,
    'agentMode must be default, plan, or goal',
    400,
  );
}

export function validateAgentPermissionMode(value: unknown) {
  if (value === undefined || normalizeAgentPermissionMode(value)) return null;
  return apiError(
    ErrorCodes.INVALID_REQUEST,
    'permissionMode must be read, ask, auto, or full',
    400,
  );
}

export function normalizeMindosAgentOptions(value: unknown): { enableThinking?: boolean; thinkingBudget?: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const options: { enableThinking?: boolean; thinkingBudget?: number } = {};

  if (typeof record.enableThinking === 'boolean') {
    options.enableThinking = record.enableThinking;
  }

  if (typeof record.thinkingBudget === 'number' && Number.isFinite(record.thinkingBudget)) {
    options.thinkingBudget = Math.min(50000, Math.max(1000, Math.floor(record.thinkingBudget)));
  }

  return options;
}

export function normalizeAssistantId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getLastUserContent(messages: FrontendMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message.content === 'string') return message.content;
  }
  return '';
}

export function getLastUserSkillName(messages: FrontendMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as FrontendMessage & { skillName?: unknown } | undefined;
    if (message?.role !== 'user') continue;
    return typeof message.skillName === 'string' && message.skillName.trim()
      ? message.skillName.trim()
      : undefined;
  }
  return undefined;
}

export function getLastUserImages(messages: FrontendMessage[]): unknown[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    return Array.isArray(message.images) ? message.images : [];
  }
  return [];
}

export function normalizeAgentSessionTurnBody(
  rawBody: unknown,
  sessionId: string,
): { ok: true; body: AgentTurnRequestBody } | { ok: false; message: string } {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, message: 'Invalid agent session turn request body' };
  }

  const record = rawBody as Record<string, unknown>;
  const unknownTopLevel = firstUnknownField(record, AGENT_SESSION_TURN_TOP_LEVEL_FIELDS);
  if (unknownTopLevel) return { ok: false, message: unknownTopLevel };
  const unknownRuntimeOptions = objectField(record, 'runtimeOptions')
    ? firstUnknownField(objectField(record, 'runtimeOptions')!, NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions')
    : null;
  if (unknownRuntimeOptions) return { ok: false, message: unknownRuntimeOptions };
  const unknownAgentOptions = objectField(record, 'agentOptions')
    ? firstUnknownField(objectField(record, 'agentOptions')!, MINDOS_AGENT_OPTION_FIELDS, 'agentOptions')
    : null;
  if (unknownAgentOptions) return { ok: false, message: unknownAgentOptions };
  const unknownSelectedRuntime = objectField(record, 'selectedRuntime')
    ? firstUnknownField(objectField(record, 'selectedRuntime')!, SELECTED_RUNTIME_FIELDS, 'selectedRuntime')
    : null;
  if (unknownSelectedRuntime) return { ok: false, message: unknownSelectedRuntime };
  const unknownRuntimeBinding = objectField(record, 'runtimeBinding')
    ? firstUnknownField(objectField(record, 'runtimeBinding')!, RUNTIME_BINDING_FIELDS, 'runtimeBinding')
    : null;
  if (unknownRuntimeBinding) return { ok: false, message: unknownRuntimeBinding };
  const context = objectField(record, 'context');
  const unknownContext = context ? firstUnknownField(context, AGENT_TURN_CONTEXT_FIELDS, 'context') : null;
  if (unknownContext) return { ok: false, message: unknownContext };
  const messageRecord = objectField(record, 'message');
  const unknownMessage = messageRecord ? firstUnknownField(messageRecord, AGENT_TURN_MESSAGE_FIELDS, 'message') : null;
  if (unknownMessage) return { ok: false, message: unknownMessage };
  if (Array.isArray(record.messages)) {
    return {
      ok: true,
      body: {
        ...(record as unknown as AgentTurnRequestBody),
        chatSessionId: sessionId,
      },
    };
  }

  const text = stringField(messageRecord, 'text') ?? stringField(messageRecord, 'content') ?? stringField(record, 'prompt');
  const images = arrayField(messageRecord, 'images') ?? arrayField(record, 'images');
  if (!text && (!images || images.length === 0)) {
    return { ok: false, message: 'message.text is required' };
  }

  const runtimeOptions = record.runtimeOptions;
  const message: FrontendMessage = {
    role: 'user',
    content: text ?? '',
    timestamp: Date.now(),
    ...(images ? { images: images as FrontendMessage['images'] } : {}),
    ...(stringField(messageRecord, 'skillName') ? { skillName: stringField(messageRecord, 'skillName') } : {}),
  };

  return {
    ok: true,
    body: {
      messages: [message],
      chatSessionId: sessionId,
      ...(normalizeAgentMode(record.agentMode) ? { agentMode: normalizeAgentMode(record.agentMode) } : {}),
      ...(normalizeAgentPermissionMode(record.permissionMode) ? { permissionMode: normalizeAgentPermissionMode(record.permissionMode) } : {}),
      ...(stringField(record, 'assistantId') ? { assistantId: stringField(record, 'assistantId') } : {}),
      ...(stringField(context, 'currentFile') ?? stringField(record, 'currentFile')
        ? { currentFile: stringField(context, 'currentFile') ?? stringField(record, 'currentFile') }
        : {}),
      ...(arrayField(context, 'attachedFiles') ?? arrayField(record, 'attachedFiles')
        ? { attachedFiles: stringArrayField(context, 'attachedFiles') ?? stringArrayField(record, 'attachedFiles') ?? [] }
        : {}),
      ...(arrayField(context, 'uploadedFiles') ?? arrayField(record, 'uploadedFiles')
        ? { uploadedFiles: (arrayField(context, 'uploadedFiles') ?? arrayField(record, 'uploadedFiles')) as AgentTurnRequestBody['uploadedFiles'] }
        : {}),
      ...(objectField(context, 'workDir') ?? objectField(record, 'workDir')
        ? { workDir: (objectField(context, 'workDir') ?? objectField(record, 'workDir')) as AgentTurnRequestBody['workDir'] }
        : {}),
      ...(objectField(context, 'contextSelection') ?? objectField(record, 'contextSelection')
        ? { contextSelection: (objectField(context, 'contextSelection') ?? objectField(record, 'contextSelection')) as AgentTurnRequestBody['contextSelection'] }
        : {}),
      ...(objectField(record, 'selectedRuntime')
        ? { selectedRuntime: objectField(record, 'selectedRuntime') as AgentTurnRequestBody['selectedRuntime'] }
        : {}),
      ...(objectField(record, 'runtimeBinding')
        ? { runtimeBinding: objectField(record, 'runtimeBinding') as AgentTurnRequestBody['runtimeBinding'] }
        : {}),
      ...(runtimeOptions && typeof runtimeOptions === 'object' && !Array.isArray(runtimeOptions)
        ? { runtimeOptions: runtimeOptions as AgentTurnRequestBody['runtimeOptions'] }
        : {}),
      ...(objectField(record, 'agentOptions')
        ? { agentOptions: objectField(record, 'agentOptions') as AgentTurnRequestBody['agentOptions'] }
        : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(stringField(record, 'providerOverride') ? { providerOverride: stringField(record, 'providerOverride') } : {}),
      ...(stringField(record, 'modelOverride')
        ? { modelOverride: stringField(record, 'modelOverride') }
        : {}),
    },
  };
}

export function validateAgentTurnRequestContract(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiError(ErrorCodes.INVALID_REQUEST, 'Invalid agent session turn request body', 400);
  }
  const record = body as Record<string, unknown>;
  const unknownTopLevel = firstUnknownField(record, AGENT_SESSION_TURN_TOP_LEVEL_FIELDS);
  if (unknownTopLevel) return apiError(ErrorCodes.INVALID_REQUEST, unknownTopLevel, 400);
  const unknownRuntimeOptions = objectField(record, 'runtimeOptions')
    ? firstUnknownField(objectField(record, 'runtimeOptions')!, NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions')
    : null;
  if (unknownRuntimeOptions) return apiError(ErrorCodes.INVALID_REQUEST, unknownRuntimeOptions, 400);
  const unknownAgentOptions = objectField(record, 'agentOptions')
    ? firstUnknownField(objectField(record, 'agentOptions')!, MINDOS_AGENT_OPTION_FIELDS, 'agentOptions')
    : null;
  if (unknownAgentOptions) return apiError(ErrorCodes.INVALID_REQUEST, unknownAgentOptions, 400);
  const unknownSelectedRuntime = objectField(record, 'selectedRuntime')
    ? firstUnknownField(objectField(record, 'selectedRuntime')!, SELECTED_RUNTIME_FIELDS, 'selectedRuntime')
    : null;
  if (unknownSelectedRuntime) return apiError(ErrorCodes.INVALID_REQUEST, unknownSelectedRuntime, 400);
  const unknownRuntimeBinding = objectField(record, 'runtimeBinding')
    ? firstUnknownField(objectField(record, 'runtimeBinding')!, RUNTIME_BINDING_FIELDS, 'runtimeBinding')
    : null;
  if (unknownRuntimeBinding) return apiError(ErrorCodes.INVALID_REQUEST, unknownRuntimeBinding, 400);
  return null;
}

function objectField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayField(record: Record<string, unknown> | undefined, key: string): unknown[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}

function stringArrayField(record: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const values = arrayField(record, key)?.filter((item): item is string => typeof item === 'string');
  return values && values.length > 0 ? values : undefined;
}

function firstUnknownField(record: Record<string, unknown>, allowed: ReadonlySet<string>, prefix?: string): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return `Unknown field: ${prefix ? `${prefix}.` : ''}${key}`;
  }
  return null;
}

const AGENT_SESSION_TURN_TOP_LEVEL_FIELDS = new Set([
  'messages',
  'message',
  'prompt',
  'images',
  'agentMode',
  'permissionMode',
  'currentFile',
  'attachedFiles',
  'uploadedFiles',
  'maxSteps',
  'assistantId',
  'selectedAcpAgent',
  'selectedRuntime',
  'runtimeBinding',
  'workDir',
  'contextSelection',
  'context',
  'providerOverride',
  'modelOverride',
  'runtimeOptions',
  'agentOptions',
  'chatSessionId',
]);
const AGENT_TURN_CONTEXT_FIELDS = new Set(['currentFile', 'attachedFiles', 'uploadedFiles', 'workDir', 'contextSelection']);
const AGENT_TURN_MESSAGE_FIELDS = new Set(['text', 'content', 'images', 'skillName']);
const NATIVE_RUNTIME_OPTION_FIELDS = new Set(['reasoningEffort', 'modelOverride']);
const MINDOS_AGENT_OPTION_FIELDS = new Set(['enableThinking', 'thinkingBudget']);
const SELECTED_RUNTIME_FIELDS = new Set(['id', 'name', 'kind', 'binaryPath']);
const RUNTIME_BINDING_FIELDS = new Set(['kind', 'runtime', 'runtimeId', 'externalSessionId', 'cwd', 'status', 'updatedAt']);
