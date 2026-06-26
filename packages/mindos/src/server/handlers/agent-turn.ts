import {
  MINDOS_SSE_HEADERS,
  type MindOSSSEvent,
} from '../../agent/turn/index.js';
import type { MindosPermissionMode } from '../../agent/permission/index.js';

export type MindosAgentTurnMessage = Record<string, unknown>;

export type MindosAgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';
export type MindosAgentMode = 'default' | 'plan' | 'goal';
export type MindosAgentPermissionMode = MindosPermissionMode;

export type MindosSelectedRuntime = {
  id: string;
  name: string;
  kind: MindosAgentRuntimeKind;
  binaryPath?: string;
};

export type MindosRuntimeSessionBinding = {
  kind: 'codex-thread' | 'claude-session' | 'acp-session';
  runtime: Exclude<MindosAgentRuntimeKind, 'mindos'>;
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
  updatedAt: number;
};

export type MindosUploadedFile = {
  name: string;
  content: string;
  mimeType?: string;
  size?: number;
  dataBase64?: string;
};

export type MindosSessionWorkDir = {
  path?: string;
  label?: string;
  source?: 'mind-root' | 'project-default' | 'runtime-binding' | 'manual';
  updatedAt?: number;
};

export type MindosContextSpaceRef = {
  path: string;
  label?: string;
  icon?: string;
  source?: 'filesystem' | 'project-default' | 'manual';
};

export type MindosContextAssistantRef = {
  id: string;
  name?: string;
  kind?: 'assistant' | 'agent' | 'skill' | 'team';
  source?: 'local-assistant' | 'builtin' | 'project-default' | 'manual';
};

export type MindosSessionContextSelection = {
  version: 1;
  spaces: MindosContextSpaceRef[];
  assistants: MindosContextAssistantRef[];
  updatedAt?: number;
};

export type MindosNativeRuntimeOptions = {
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  modelOverride?: string;
};

export type MindosAcpRuntimeOptions = {
  modeId?: string;
  configValues?: Record<string, string>;
};

export type MindosAgentTurnRequest = {
  messages: MindosAgentTurnMessage[];
  agentMode?: MindosAgentMode;
  permissionMode?: MindosAgentPermissionMode;
  currentFile?: string;
  attachedFiles?: string[];
  uploadedFiles?: MindosUploadedFile[];
  maxSteps?: number;
  assistantId?: string;
  selectedRuntime?: MindosSelectedRuntime | null;
  runtimeBinding?: MindosRuntimeSessionBinding | null;
  selectedAcpAgent?: { id: string; name: string } | null;
  workDir?: MindosSessionWorkDir;
  contextSelection?: MindosSessionContextSelection;
  runtimeOptions?: MindosNativeRuntimeOptions;
  acpRuntimeOptions?: MindosAcpRuntimeOptions;
  chatSessionId?: string;
  providerOverride?: string;
  modelOverride?: string;
};

export type AgentTurnStreamHandlerServices = {
  agentTurnStream(input: MindosAgentTurnRequest): AsyncIterable<MindOSSSEvent>;
};

export type AgentTurnStreamHandlerResult =
  | { ok: true; status: 200; headers: Record<string, string>; body: AsyncIterable<MindOSSSEvent> }
  | { ok: false; status: number; body: { error: string } };

export function handleAgentTurnStream(
  body: unknown,
  services: AgentTurnStreamHandlerServices,
): AgentTurnStreamHandlerResult {
  const parsed = parseAgentTurnRequest(body);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    status: 200,
    headers: MINDOS_SSE_HEADERS,
    body: services.agentTurnStream(parsed.body),
  };
}

export function handleAgentSessionTurnStream(
  sessionId: string,
  body: unknown,
  services: AgentTurnStreamHandlerServices,
): AgentTurnStreamHandlerResult {
  const normalized = normalizeAgentSessionTurnBody(sessionId, body);
  if (!normalized.ok) return normalized;
  return handleAgentTurnStream(normalized.body, services);
}

function parseAgentTurnRequest(body: unknown):
  | { ok: true; body: MindosAgentTurnRequest }
  | { ok: false; status: number; body: { error: string } } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, body: { error: 'Invalid agent turn request body' } };
  }

  const record = body as Record<string, unknown>;
  const unknownTopLevel = firstUnknownField(record, AGENT_TURN_TOP_LEVEL_FIELDS);
  if (unknownTopLevel) {
    return { ok: false, status: 400, body: { error: unknownTopLevel } };
  }
  if (!Array.isArray(record.messages)) {
    return { ok: false, status: 400, body: { error: 'messages must be an array' } };
  }

  if (record.agentMode !== undefined && !isMindosAgentMode(record.agentMode)) {
    return { ok: false, status: 400, body: { error: 'agentMode must be default, plan, or goal' } };
  }
  if (record.permissionMode !== undefined && !isMindosPermissionMode(record.permissionMode)) {
    return { ok: false, status: 400, body: { error: 'permissionMode must be read, ask, auto, or full' } };
  }

  const selectedRuntime = normalizeSelectedRuntime(record);
  const runtimeBinding = normalizeRuntimeSessionBinding(record.runtimeBinding);
  const runtimeBindingError = validateRuntimeBindingMatchesSelectedRuntime(selectedRuntime, runtimeBinding);
  if (runtimeBindingError) return { ok: false, status: 400, body: { error: runtimeBindingError } };
  const workDir = normalizeSessionWorkDir(record.workDir);
  const contextSelection = normalizeSessionContextSelection(record.contextSelection);
  const runtimeOptionsRecord = record.runtimeOptions && typeof record.runtimeOptions === 'object' && !Array.isArray(record.runtimeOptions)
    ? record.runtimeOptions as Record<string, unknown>
    : undefined;
  const unknownRuntimeOptions = runtimeOptionsRecord ? firstUnknownField(runtimeOptionsRecord, NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions') : null;
  if (unknownRuntimeOptions) {
    return {
      ok: false,
      status: 400,
      body: { error: unknownRuntimeOptions },
    };
  }
  const acpRuntimeOptionsRecord = record.acpRuntimeOptions && typeof record.acpRuntimeOptions === 'object' && !Array.isArray(record.acpRuntimeOptions)
    ? record.acpRuntimeOptions as Record<string, unknown>
    : undefined;
  const unknownAcpRuntimeOptions = acpRuntimeOptionsRecord ? firstUnknownField(acpRuntimeOptionsRecord, ACP_RUNTIME_OPTION_FIELDS, 'acpRuntimeOptions') : null;
  if (unknownAcpRuntimeOptions) {
    return {
      ok: false,
      status: 400,
      body: { error: unknownAcpRuntimeOptions },
    };
  }
  const agentOptionsRecord = record.agentOptions && typeof record.agentOptions === 'object' && !Array.isArray(record.agentOptions)
    ? record.agentOptions as Record<string, unknown>
    : undefined;
  const unknownAgentOptions = agentOptionsRecord ? firstUnknownField(agentOptionsRecord, MINDOS_AGENT_OPTION_FIELDS, 'agentOptions') : null;
  if (unknownAgentOptions) return { ok: false, status: 400, body: { error: unknownAgentOptions } };
  const selectedRuntimeRecord = record.selectedRuntime && typeof record.selectedRuntime === 'object' && !Array.isArray(record.selectedRuntime)
    ? record.selectedRuntime as Record<string, unknown>
    : undefined;
  const unknownSelectedRuntime = selectedRuntimeRecord ? firstUnknownField(selectedRuntimeRecord, SELECTED_RUNTIME_FIELDS, 'selectedRuntime') : null;
  if (unknownSelectedRuntime) return { ok: false, status: 400, body: { error: unknownSelectedRuntime } };
  const runtimeBindingRecord = record.runtimeBinding && typeof record.runtimeBinding === 'object' && !Array.isArray(record.runtimeBinding)
    ? record.runtimeBinding as Record<string, unknown>
    : undefined;
  const unknownRuntimeBinding = runtimeBindingRecord ? firstUnknownField(runtimeBindingRecord, RUNTIME_BINDING_FIELDS, 'runtimeBinding') : null;
  if (unknownRuntimeBinding) return { ok: false, status: 400, body: { error: unknownRuntimeBinding } };
  const runtimeOptions = normalizeNativeRuntimeOptions(record.runtimeOptions);
  const acpRuntimeOptions = normalizeAcpRuntimeOptions(record.acpRuntimeOptions);

  return {
    ok: true,
    body: {
      messages: record.messages.filter((message): message is MindosAgentTurnMessage => !!message && typeof message === 'object') as MindosAgentTurnMessage[],
      ...(isMindosAgentMode(record.agentMode) ? { agentMode: record.agentMode } : {}),
      ...(isMindosPermissionMode(record.permissionMode) ? { permissionMode: record.permissionMode } : {}),
      ...(typeof record.currentFile === 'string' ? { currentFile: record.currentFile } : {}),
      ...(Array.isArray(record.attachedFiles) ? { attachedFiles: record.attachedFiles.filter((item): item is string => typeof item === 'string') } : {}),
      ...(Array.isArray(record.uploadedFiles) ? { uploadedFiles: normalizeUploadedFiles(record.uploadedFiles) } : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(typeof record.assistantId === 'string' && record.assistantId.trim() ? { assistantId: record.assistantId.trim() } : {}),
      ...(selectedRuntime !== undefined ? { selectedRuntime } : {}),
      ...(runtimeBinding !== undefined ? { runtimeBinding } : {}),
      ...(isSelectedAcpAgent(record.selectedAcpAgent) ? { selectedAcpAgent: record.selectedAcpAgent } : {}),
      ...(workDir !== undefined ? { workDir } : {}),
      ...(contextSelection !== undefined ? { contextSelection } : {}),
      ...(runtimeOptions !== undefined ? { runtimeOptions } : {}),
      ...(acpRuntimeOptions !== undefined ? { acpRuntimeOptions } : {}),
      ...(typeof record.chatSessionId === 'string' && record.chatSessionId.trim() ? { chatSessionId: record.chatSessionId.trim() } : {}),
      ...(typeof record.providerOverride === 'string' ? { providerOverride: record.providerOverride } : {}),
      ...(typeof record.modelOverride === 'string' ? { modelOverride: record.modelOverride } : {}),
    },
  };
}

function normalizeAgentSessionTurnBody(sessionId: string, body: unknown):
  | { ok: true; body: unknown }
  | { ok: false; status: number; body: { error: string } } {
  if (!sessionId.trim()) {
    return { ok: false, status: 400, body: { error: 'sessionId is required' } };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, body: { error: 'Invalid agent session turn request body' } };
  }

  const record = body as Record<string, unknown>;
  const unknownTopLevel = firstUnknownField(record, AGENT_TURN_TOP_LEVEL_FIELDS);
  if (unknownTopLevel) return { ok: false, status: 400, body: { error: unknownTopLevel } };
  const unknownRuntimeOptions = objectField(record, 'runtimeOptions')
    ? firstUnknownField(objectField(record, 'runtimeOptions')!, NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions')
    : null;
  if (unknownRuntimeOptions) return { ok: false, status: 400, body: { error: unknownRuntimeOptions } };
  const unknownAcpRuntimeOptions = objectField(record, 'acpRuntimeOptions')
    ? firstUnknownField(objectField(record, 'acpRuntimeOptions')!, ACP_RUNTIME_OPTION_FIELDS, 'acpRuntimeOptions')
    : null;
  if (unknownAcpRuntimeOptions) return { ok: false, status: 400, body: { error: unknownAcpRuntimeOptions } };
  const unknownAgentOptions = objectField(record, 'agentOptions')
    ? firstUnknownField(objectField(record, 'agentOptions')!, MINDOS_AGENT_OPTION_FIELDS, 'agentOptions')
    : null;
  if (unknownAgentOptions) return { ok: false, status: 400, body: { error: unknownAgentOptions } };
  const unknownSelectedRuntime = objectField(record, 'selectedRuntime')
    ? firstUnknownField(objectField(record, 'selectedRuntime')!, SELECTED_RUNTIME_FIELDS, 'selectedRuntime')
    : null;
  if (unknownSelectedRuntime) return { ok: false, status: 400, body: { error: unknownSelectedRuntime } };
  const unknownRuntimeBinding = objectField(record, 'runtimeBinding')
    ? firstUnknownField(objectField(record, 'runtimeBinding')!, RUNTIME_BINDING_FIELDS, 'runtimeBinding')
    : null;
  if (unknownRuntimeBinding) return { ok: false, status: 400, body: { error: unknownRuntimeBinding } };
  const context = objectField(record, 'context');
  const unknownContext = context ? firstUnknownField(context, AGENT_TURN_CONTEXT_FIELDS, 'context') : null;
  if (unknownContext) return { ok: false, status: 400, body: { error: unknownContext } };
  const message = objectField(record, 'message');
  const unknownMessage = message ? firstUnknownField(message, AGENT_TURN_MESSAGE_FIELDS, 'message') : null;
  if (unknownMessage) return { ok: false, status: 400, body: { error: unknownMessage } };
  if (Array.isArray(record.messages)) {
    return { ok: true, body: { ...record, chatSessionId: sessionId } };
  }

  const text = stringField(message, 'text') ?? stringField(message, 'content') ?? stringField(record, 'prompt');
  const images = arrayField(message, 'images') ?? arrayField(record, 'images');
  if (!text && (!images || images.length === 0)) {
    return { ok: false, status: 400, body: { error: 'message.text is required' } };
  }

  const runtimeOptions = objectField(record, 'runtimeOptions');
  const acpRuntimeOptions = normalizeAcpRuntimeOptions(record.acpRuntimeOptions);
  return {
    ok: true,
    body: {
      messages: [{
        role: 'user',
        content: text ?? '',
        timestamp: Date.now(),
        ...(images ? { images } : {}),
        ...(stringField(message, 'skillName') ? { skillName: stringField(message, 'skillName') } : {}),
      }],
      chatSessionId: sessionId,
      ...(isMindosAgentMode(record.agentMode) ? { agentMode: record.agentMode } : {}),
      ...(isMindosPermissionMode(record.permissionMode) ? { permissionMode: record.permissionMode } : {}),
      ...(stringField(record, 'assistantId') ? { assistantId: stringField(record, 'assistantId') } : {}),
      ...(stringField(context, 'currentFile') ?? stringField(record, 'currentFile')
        ? { currentFile: stringField(context, 'currentFile') ?? stringField(record, 'currentFile') }
        : {}),
      ...(arrayField(context, 'attachedFiles') ?? arrayField(record, 'attachedFiles')
        ? { attachedFiles: stringArrayField(context, 'attachedFiles') ?? stringArrayField(record, 'attachedFiles') ?? [] }
        : {}),
      ...(arrayField(context, 'uploadedFiles') ?? arrayField(record, 'uploadedFiles')
        ? { uploadedFiles: arrayField(context, 'uploadedFiles') ?? arrayField(record, 'uploadedFiles') }
        : {}),
      ...(objectField(context, 'workDir') ?? objectField(record, 'workDir')
        ? { workDir: objectField(context, 'workDir') ?? objectField(record, 'workDir') }
        : {}),
      ...(objectField(context, 'contextSelection') ?? objectField(record, 'contextSelection')
        ? { contextSelection: objectField(context, 'contextSelection') ?? objectField(record, 'contextSelection') }
        : {}),
      ...(objectField(record, 'selectedRuntime')
        ? { selectedRuntime: objectField(record, 'selectedRuntime') }
        : {}),
      ...(objectField(record, 'runtimeBinding') ? { runtimeBinding: objectField(record, 'runtimeBinding') } : {}),
      ...(runtimeOptions ? { runtimeOptions } : {}),
      ...(acpRuntimeOptions ? { acpRuntimeOptions } : {}),
      ...(objectField(record, 'agentOptions')
        ? { agentOptions: objectField(record, 'agentOptions') }
        : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(stringField(record, 'providerOverride') ? { providerOverride: stringField(record, 'providerOverride') } : {}),
      ...(stringField(record, 'modelOverride')
        ? { modelOverride: stringField(record, 'modelOverride') }
        : {}),
    },
  };
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

const AGENT_TURN_TOP_LEVEL_FIELDS = new Set([
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
  'acpRuntimeOptions',
  'agentOptions',
  'chatSessionId',
]);
const AGENT_TURN_CONTEXT_FIELDS = new Set(['currentFile', 'attachedFiles', 'uploadedFiles', 'workDir', 'contextSelection']);
const AGENT_TURN_MESSAGE_FIELDS = new Set(['text', 'content', 'images', 'skillName']);
const NATIVE_RUNTIME_OPTION_FIELDS = new Set(['reasoningEffort', 'modelOverride']);
const ACP_RUNTIME_OPTION_FIELDS = new Set(['modeId', 'configValues']);
const MINDOS_AGENT_OPTION_FIELDS = new Set(['enableThinking', 'thinkingBudget']);
const SELECTED_RUNTIME_FIELDS = new Set(['id', 'name', 'kind', 'binaryPath']);
const RUNTIME_BINDING_FIELDS = new Set(['kind', 'runtime', 'runtimeId', 'externalSessionId', 'cwd', 'status', 'updatedAt']);

function normalizeUploadedFiles(files: unknown[]): MindosUploadedFile[] {
  return files
    .filter((file): file is Record<string, unknown> => !!file && typeof file === 'object')
    .filter((file) => typeof file.name === 'string' && typeof file.content === 'string')
    .map((file) => ({
      name: file.name as string,
      content: file.content as string,
      ...(typeof file.mimeType === 'string' && file.mimeType.trim() ? { mimeType: file.mimeType } : {}),
      ...(typeof file.size === 'number' && Number.isFinite(file.size) ? { size: file.size } : {}),
      ...(typeof file.dataBase64 === 'string' && file.dataBase64 ? { dataBase64: file.dataBase64 } : {}),
    }));
}

function cleanString(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSessionWorkDir(value: unknown): MindosSessionWorkDir | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const source = isSessionWorkDirSource(record.source) ? record.source : undefined;
  const path = cleanString(record.path, 1200);
  const label = cleanString(record.label, 160);
  const updatedAt = cleanNumber(record.updatedAt);
  if (!source && !path && !label && updatedAt === undefined) return undefined;
  return {
    ...(source ? { source } : {}),
    ...(path ? { path } : {}),
    ...(label ? { label } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function normalizeSessionContextSelection(value: unknown): MindosSessionContextSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const updatedAt = cleanNumber(record.updatedAt);
  return {
    version: 1,
    spaces: Array.isArray(record.spaces)
      ? record.spaces.map(normalizeContextSpaceRef).filter((item): item is MindosContextSpaceRef => item !== null).slice(0, 8)
      : [],
    assistants: Array.isArray(record.assistants)
      ? record.assistants.map(normalizeContextAssistantRef).filter((item): item is MindosContextAssistantRef => item !== null).slice(0, 6)
      : [],
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function normalizeContextSpaceRef(value: unknown): MindosContextSpaceRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const spacePath = cleanString(record.path, 400)?.replace(/\\/g, '/').trim();
  const label = cleanString(record.label, 160);
  const icon = cleanString(record.icon, 40);
  if (!spacePath) return null;
  return {
    path: spacePath,
    ...(label ? { label } : {}),
    ...(icon ? { icon } : {}),
    ...(isContextSpaceSource(record.source) ? { source: record.source } : {}),
  };
}

function normalizeContextAssistantRef(value: unknown): MindosContextAssistantRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = cleanString(record.id, 120)?.toLowerCase();
  const name = cleanString(record.name, 160);
  if (!id) return null;
  return {
    id,
    ...(name ? { name } : {}),
    ...(isContextAssistantKind(record.kind) ? { kind: record.kind } : {}),
    ...(isContextAssistantSource(record.source) ? { source: record.source } : {}),
  };
}

function normalizeNativeRuntimeOptions(value: unknown): MindosNativeRuntimeOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const reasoningEffort = isNativeReasoningEffort(record.reasoningEffort) ? record.reasoningEffort : undefined;
  const modelOverride = cleanString(record.modelOverride, 240);
  if (!reasoningEffort && !modelOverride) return undefined;
  return {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(modelOverride ? { modelOverride } : {}),
  };
}

function normalizeAcpRuntimeOptions(value: unknown): MindosAcpRuntimeOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const modeId = cleanString(record.modeId, 240);
  const configValues = normalizeStringRecord(record.configValues);
  if (!modeId && !configValues) return undefined;
  return {
    ...(modeId ? { modeId } : {}),
    ...(configValues ? { configValues } : {}),
  };
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      const cleanKey = cleanString(key, 240);
      const cleanValue = cleanString(raw, 1000);
      return cleanKey && cleanValue ? [cleanKey, cleanValue] as const : null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isMindosAgentMode(value: unknown): value is MindosAgentMode {
  return value === 'default' || value === 'plan' || value === 'goal';
}

function isMindosPermissionMode(value: unknown): value is MindosPermissionMode {
  return value === 'read' || value === 'ask' || value === 'auto' || value === 'full';
}

function isSelectedAcpAgent(value: unknown): value is { id: string; name: string } | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string';
}

function normalizeRuntimeSessionBinding(value: unknown): MindosRuntimeSessionBinding | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (!isRuntimeSessionKind(record.kind) || !isExternalRuntimeKind(record.runtime)) return undefined;
  if (typeof record.runtimeId !== 'string' || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return undefined;
  const binding: MindosRuntimeSessionBinding = {
    kind: record.kind,
    runtime: record.runtime,
    runtimeId: record.runtimeId,
    updatedAt: record.updatedAt,
  };
  if (typeof record.externalSessionId === 'string') binding.externalSessionId = record.externalSessionId;
  if (typeof record.cwd === 'string') binding.cwd = record.cwd;
  if (isRuntimeSessionStatus(record.status)) binding.status = record.status;
  return binding;
}

function validateRuntimeBindingMatchesSelectedRuntime(
  runtime: MindosSelectedRuntime | null | undefined,
  binding: MindosRuntimeSessionBinding | null | undefined,
): string | null {
  if (!binding) return null;
  if (!runtime) return 'runtimeBinding requires selectedRuntime';
  if (runtime.kind === 'mindos') return 'runtimeBinding is only valid for external runtimes';
  if (binding.runtime !== runtime.kind || binding.runtimeId !== runtime.id) return 'runtimeBinding must match selectedRuntime';
  if (runtime.kind === 'codex' && binding.kind !== 'codex-thread') return 'runtimeBinding.kind must be codex-thread for Codex';
  if (runtime.kind === 'claude' && binding.kind !== 'claude-session') return 'runtimeBinding.kind must be claude-session for Claude Code';
  if (runtime.kind === 'acp' && binding.kind !== 'acp-session') return 'runtimeBinding.kind must be acp-session for ACP';
  return null;
}

function isRuntimeSessionKind(value: unknown): value is MindosRuntimeSessionBinding['kind'] {
  return value === 'codex-thread' || value === 'claude-session' || value === 'acp-session';
}

function isExternalRuntimeKind(value: unknown): value is MindosRuntimeSessionBinding['runtime'] {
  return value === 'acp' || value === 'codex' || value === 'claude';
}

function isRuntimeSessionStatus(value: unknown): value is NonNullable<MindosRuntimeSessionBinding['status']> {
  return value === 'active' || value === 'missing' || value === 'signed-out' || value === 'archived' || value === 'failed';
}

function normalizeSelectedRuntime(record: Record<string, unknown>): MindosSelectedRuntime | null | undefined {
  if (record.selectedRuntime === null) return null;
  if (isSelectedRuntime(record.selectedRuntime)) {
    const runtime = record.selectedRuntime as Record<string, unknown>;
    return {
      id: runtime.id as string,
      name: runtime.name as string,
      kind: runtime.kind as MindosAgentRuntimeKind,
      ...(typeof runtime.binaryPath === 'string' && runtime.binaryPath.trim()
        ? { binaryPath: runtime.binaryPath }
        : {}),
    };
  }

  if (!isSelectedAcpAgent(record.selectedAcpAgent) || record.selectedAcpAgent === null) {
    return record.selectedAcpAgent === null ? null : undefined;
  }

  return {
    ...record.selectedAcpAgent,
    kind: 'acp',
  };
}

function isSelectedRuntime(value: unknown): value is MindosSelectedRuntime {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && typeof record.name === 'string'
    && isAgentRuntimeKind(record.kind)
  );
}

function isAgentRuntimeKind(value: unknown): value is MindosAgentRuntimeKind {
  return value === 'mindos' || value === 'acp' || value === 'codex' || value === 'claude';
}

function isSessionWorkDirSource(value: unknown): value is NonNullable<MindosSessionWorkDir['source']> {
  return value === 'mind-root' || value === 'project-default' || value === 'runtime-binding' || value === 'manual';
}

function isContextSpaceSource(value: unknown): value is NonNullable<MindosContextSpaceRef['source']> {
  return value === 'filesystem' || value === 'project-default' || value === 'manual';
}

function isContextAssistantKind(value: unknown): value is NonNullable<MindosContextAssistantRef['kind']> {
  return value === 'assistant' || value === 'agent' || value === 'skill' || value === 'team';
}

function isContextAssistantSource(value: unknown): value is NonNullable<MindosContextAssistantRef['source']> {
  return value === 'local-assistant' || value === 'builtin' || value === 'project-default' || value === 'manual';
}

function isNativeReasoningEffort(value: unknown): value is NonNullable<MindosNativeRuntimeOptions['reasoningEffort']> {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}
