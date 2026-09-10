import type { MindosPermissionMode } from '../permission/index.js';
import { isMindosThinkingLevel, type MindosThinkingLevel } from '../mindos-pi/thinking.js';
import type { MindosAgentMode } from '../mode.js';
import type {
  AgentRunCapsuleRecoveryPlan,
  AgentRunCapsuleRuntimeBinding,
} from '../capsules/types.js';

/**
 * Single source for the agent-turn request wire contract: field allowlists,
 * normalisers, validators and the two body parsers (strict turn request,
 * simplified session-turn request). Consolidated from the duplicated pair
 * `server/handlers/agent-turn.ts` (Product Server handler) and
 * `packages/web/app/api/agent/_lib/turn-request.ts` (Next host route) so the
 * two hosts can never drift on what a turn request may carry
 * (spec-runtime-lane-contract, audit P2-9).
 *
 * Both hosts assemble these primitives into their own response shapes: the
 * handler returns `{ ok, status, body: { error } }`, the web route returns
 * `apiError(...)` responses. The wire semantics (allowlists, messages,
 * normalised shapes) live only here.
 */

// ── Wire types (formerly declared in server/handlers/agent-turn.ts) ────────

export type MindosAgentTurnMessage = Record<string, unknown>;

export type MindosAgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';
export type { MindosAgentMode };
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
  reasoningEffort?: string;
  modelOverride?: string;
};

export type MindosAcpRuntimeOptions = {
  modeId?: string;
  configValues?: Record<string, string>;
};

export type MindosAgentOptions = {
  enableThinking?: boolean;
  thinkingLevel?: MindosThinkingLevel;
  thinkingBudget?: number;
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
  agentOptions?: MindosAgentOptions;
  chatSessionId?: string;
  providerOverride?: string;
  modelOverride?: string;
};

// ── Field allowlists (one copy; the web route called the top-level set
// AGENT_SESSION_TURN_TOP_LEVEL_FIELDS, the handler AGENT_TURN_TOP_LEVEL_FIELDS) ──

export const MINDOS_AGENT_TURN_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
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
export const MINDOS_AGENT_TURN_CONTEXT_FIELDS: ReadonlySet<string> = new Set(['currentFile', 'attachedFiles', 'uploadedFiles', 'workDir', 'contextSelection']);
export const MINDOS_AGENT_TURN_MESSAGE_FIELDS: ReadonlySet<string> = new Set(['text', 'content', 'images', 'skillName']);
export const MINDOS_NATIVE_RUNTIME_OPTION_FIELDS: ReadonlySet<string> = new Set(['reasoningEffort', 'modelOverride']);
export const MINDOS_ACP_RUNTIME_OPTION_FIELDS: ReadonlySet<string> = new Set(['modeId', 'configValues']);
export const MINDOS_AGENT_OPTION_FIELDS: ReadonlySet<string> = new Set(['enableThinking', 'thinkingLevel', 'thinkingBudget']);
export const MINDOS_SELECTED_RUNTIME_FIELDS: ReadonlySet<string> = new Set(['id', 'name', 'kind', 'binaryPath']);
export const MINDOS_RUNTIME_BINDING_FIELDS: ReadonlySet<string> = new Set(['kind', 'runtime', 'runtimeId', 'externalSessionId', 'cwd', 'status', 'updatedAt']);

// ── Generic field helpers ───────────────────────────────────────────────────

export function isMindosTurnRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mindosTurnObjectField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function mindosTurnStringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function mindosTurnArrayField(record: Record<string, unknown> | undefined, key: string): unknown[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}

function mindosTurnStringArrayField(record: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const values = mindosTurnArrayField(record, key)?.filter((item): item is string => typeof item === 'string');
  return values && values.length > 0 ? values : undefined;
}

export function firstUnknownMindosTurnField(record: Record<string, unknown>, allowed: ReadonlySet<string>, prefix?: string): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return `Unknown field: ${prefix ? `${prefix}.` : ''}${key}`;
  }
  return null;
}

/**
 * The unknown-field sweep shared by the web request contract validator and the
 * session-turn body normaliser: top level plus the five nested option objects.
 */
export function findUnknownMindosAgentTurnRequestFields(record: Record<string, unknown>): string | null {
  const checks: Array<[Record<string, unknown> | undefined, ReadonlySet<string>, string | undefined]> = [
    [record, MINDOS_AGENT_TURN_TOP_LEVEL_FIELDS, undefined],
    [mindosTurnObjectField(record, 'runtimeOptions'), MINDOS_NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions'],
    [mindosTurnObjectField(record, 'acpRuntimeOptions'), MINDOS_ACP_RUNTIME_OPTION_FIELDS, 'acpRuntimeOptions'],
    [mindosTurnObjectField(record, 'agentOptions'), MINDOS_AGENT_OPTION_FIELDS, 'agentOptions'],
    [mindosTurnObjectField(record, 'selectedRuntime'), MINDOS_SELECTED_RUNTIME_FIELDS, 'selectedRuntime'],
    [mindosTurnObjectField(record, 'runtimeBinding'), MINDOS_RUNTIME_BINDING_FIELDS, 'runtimeBinding'],
  ];
  for (const [target, allowed, prefix] of checks) {
    if (!target) continue;
    const unknown = firstUnknownMindosTurnField(target, allowed, prefix);
    if (unknown) return unknown;
  }
  return null;
}

/** The simplified session-turn body additionally nests `context` and `message`. */
export function findUnknownMindosSessionTurnContextFields(record: Record<string, unknown>): string | null {
  const context = mindosTurnObjectField(record, 'context');
  if (context) {
    const unknown = firstUnknownMindosTurnField(context, MINDOS_AGENT_TURN_CONTEXT_FIELDS, 'context');
    if (unknown) return unknown;
  }
  const message = mindosTurnObjectField(record, 'message');
  if (message) {
    const unknown = firstUnknownMindosTurnField(message, MINDOS_AGENT_TURN_MESSAGE_FIELDS, 'message');
    if (unknown) return unknown;
  }
  return null;
}

// ── Predicates and normalisers ──────────────────────────────────────────────

export function isMindosAgentModeValue(value: unknown): value is MindosAgentMode {
  return value === 'default' || value === 'plan' || value === 'goal';
}

export function isMindosPermissionModeValue(value: unknown): value is MindosPermissionMode {
  return value === 'read' || value === 'ask' || value === 'auto' || value === 'full';
}

export function normalizeMindosAgentMode(value: unknown): MindosAgentMode | undefined {
  return isMindosAgentModeValue(value) ? value : undefined;
}

export function normalizeMindosPermissionMode(value: unknown): MindosAgentPermissionMode | undefined {
  return isMindosPermissionModeValue(value) ? value : undefined;
}

export function validateMindosAgentModeField(value: unknown): string | null {
  if (value === undefined || normalizeMindosAgentMode(value)) return null;
  return 'agentMode must be default, plan, or goal';
}

export function validateMindosPermissionModeField(value: unknown): string | null {
  if (value === undefined || normalizeMindosPermissionMode(value)) return null;
  return 'permissionMode must be read, ask, auto, or full';
}

export function normalizeMindosAssistantId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanMindosTurnString(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function cleanMindosTurnNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isMindosNativeReasoningEffort(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

/** Always returns an object; callers spread it conditionally on non-emptiness. */
export function normalizeMindosNativeRuntimeOptions(value: unknown): MindosNativeRuntimeOptions {
  if (!isMindosTurnRecord(value)) return {};
  const reasoningEffort = isMindosNativeReasoningEffort(value.reasoningEffort) ? value.reasoningEffort : undefined;
  const modelOverride = cleanMindosTurnString(value.modelOverride, 240);
  return {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(modelOverride ? { modelOverride } : {}),
  };
}

/** Always returns an object; callers spread it conditionally on non-emptiness. */
export function normalizeMindosAcpRuntimeOptions(value: unknown): MindosAcpRuntimeOptions {
  if (!isMindosTurnRecord(value)) return {};
  const modeId = cleanMindosTurnString(value.modeId, 240);
  const configValues = normalizeMindosStringRecord(value.configValues);
  return {
    ...(modeId ? { modeId } : {}),
    ...(configValues ? { configValues } : {}),
  };
}

/** Always returns an object; callers spread it conditionally on non-emptiness. */
export function normalizeMindosAgentOptions(value: unknown): MindosAgentOptions {
  if (!isMindosTurnRecord(value)) return {};
  const options: MindosAgentOptions = {};
  if (typeof value.enableThinking === 'boolean') options.enableThinking = value.enableThinking;
  if (isMindosThinkingLevel(value.thinkingLevel)) options.thinkingLevel = value.thinkingLevel;
  if (typeof value.thinkingBudget === 'number' && Number.isFinite(value.thinkingBudget)) {
    options.thinkingBudget = Math.min(50_000, Math.max(1_000, Math.floor(value.thinkingBudget)));
  }
  return options;
}

/** Full agentOptions validation sequence, shared by both hosts. Returns the error message or null. */
export function validateMindosAgentOptionsObject(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isMindosTurnRecord(value)) return 'agentOptions must be an object';
  const unknown = firstUnknownMindosTurnField(value, MINDOS_AGENT_OPTION_FIELDS, 'agentOptions');
  if (unknown) return unknown;
  if (value.enableThinking !== undefined && typeof value.enableThinking !== 'boolean') {
    return 'agentOptions.enableThinking must be a boolean';
  }
  if (value.thinkingLevel !== undefined && !isMindosThinkingLevel(value.thinkingLevel)) {
    return 'agentOptions.thinkingLevel must be off, minimal, low, medium, high, xhigh, or max';
  }
  if (
    value.thinkingBudget !== undefined
    && (typeof value.thinkingBudget !== 'number' || !Number.isFinite(value.thinkingBudget))
  ) {
    return 'agentOptions.thinkingBudget must be a finite number';
  }
  return null;
}

export function normalizeMindosStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      const cleanKey = cleanMindosTurnString(key, 240);
      const cleanValue = cleanMindosTurnString(raw, 1000);
      return cleanKey && cleanValue ? [cleanKey, cleanValue] as const : null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function normalizeMindosUploadedFiles(files: unknown[]): MindosUploadedFile[] {
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

export function normalizeMindosSessionWorkDir(value: unknown): MindosSessionWorkDir | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const source = isMindosSessionWorkDirSource(record.source) ? record.source : undefined;
  const path = cleanMindosTurnString(record.path, 1200);
  const label = cleanMindosTurnString(record.label, 160);
  const updatedAt = cleanMindosTurnNumber(record.updatedAt);
  if (!source && !path && !label && updatedAt === undefined) return undefined;
  return {
    ...(source ? { source } : {}),
    ...(path ? { path } : {}),
    ...(label ? { label } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function normalizeMindosSessionContextSelection(value: unknown): MindosSessionContextSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const updatedAt = cleanMindosTurnNumber(record.updatedAt);
  return {
    version: 1,
    spaces: Array.isArray(record.spaces)
      ? record.spaces.map(normalizeMindosContextSpaceRef).filter((item): item is MindosContextSpaceRef => item !== null).slice(0, 8)
      : [],
    assistants: Array.isArray(record.assistants)
      ? record.assistants.map(normalizeMindosContextAssistantRef).filter((item): item is MindosContextAssistantRef => item !== null).slice(0, 6)
      : [],
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function normalizeMindosContextSpaceRef(value: unknown): MindosContextSpaceRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const spacePath = cleanMindosTurnString(record.path, 400)?.replace(/\\/g, '/').trim();
  const label = cleanMindosTurnString(record.label, 160);
  const icon = cleanMindosTurnString(record.icon, 40);
  if (!spacePath) return null;
  return {
    path: spacePath,
    ...(label ? { label } : {}),
    ...(icon ? { icon } : {}),
    ...(isMindosContextSpaceSource(record.source) ? { source: record.source } : {}),
  };
}

function normalizeMindosContextAssistantRef(value: unknown): MindosContextAssistantRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = cleanMindosTurnString(record.id, 120)?.toLowerCase();
  const name = cleanMindosTurnString(record.name, 160);
  if (!id) return null;
  return {
    id,
    ...(name ? { name } : {}),
    ...(isMindosContextAssistantKind(record.kind) ? { kind: record.kind } : {}),
    ...(isMindosContextAssistantSource(record.source) ? { source: record.source } : {}),
  };
}

export function isMindosSelectedAcpAgent(value: unknown): value is { id: string; name: string } | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string';
}

export function normalizeMindosRuntimeSessionBinding(value: unknown): MindosRuntimeSessionBinding | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (!isMindosRuntimeSessionKind(record.kind) || !isMindosExternalRuntimeKind(record.runtime)) return undefined;
  if (typeof record.runtimeId !== 'string' || typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return undefined;
  const binding: MindosRuntimeSessionBinding = {
    kind: record.kind,
    runtime: record.runtime,
    runtimeId: record.runtimeId,
    updatedAt: record.updatedAt,
  };
  if (typeof record.externalSessionId === 'string') binding.externalSessionId = record.externalSessionId;
  if (typeof record.cwd === 'string') binding.cwd = record.cwd;
  if (isMindosRuntimeSessionStatus(record.status)) binding.status = record.status;
  return binding;
}

/**
 * Product-handler variant: a binding is only valid against a matching external
 * runtime selection. (The web route additionally accepts `mindos-pi-session`
 * bindings for the embedded runtime; that variant lives in the web
 * runtime-selection module and stays there deliberately — the two hosts gate
 * different resume surfaces.)
 */
export function validateMindosRuntimeBindingMatchesRuntime(
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

function isMindosRuntimeSessionKind(value: unknown): value is MindosRuntimeSessionBinding['kind'] {
  return value === 'codex-thread' || value === 'claude-session' || value === 'acp-session';
}

function isMindosExternalRuntimeKind(value: unknown): value is MindosRuntimeSessionBinding['runtime'] {
  return value === 'acp' || value === 'codex' || value === 'claude';
}

function isMindosRuntimeSessionStatus(value: unknown): value is NonNullable<MindosRuntimeSessionBinding['status']> {
  return value === 'active' || value === 'missing' || value === 'signed-out' || value === 'archived' || value === 'failed';
}

function isMindosAgentRuntimeKind(value: unknown): value is MindosAgentRuntimeKind {
  return value === 'mindos' || value === 'acp' || value === 'codex' || value === 'claude';
}

function isMindosSessionWorkDirSource(value: unknown): value is NonNullable<MindosSessionWorkDir['source']> {
  return value === 'mind-root' || value === 'project-default' || value === 'runtime-binding' || value === 'manual';
}

function isMindosContextSpaceSource(value: unknown): value is NonNullable<MindosContextSpaceRef['source']> {
  return value === 'filesystem' || value === 'project-default' || value === 'manual';
}

function isMindosContextAssistantKind(value: unknown): value is NonNullable<MindosContextAssistantRef['kind']> {
  return value === 'assistant' || value === 'agent' || value === 'skill' || value === 'team';
}

function isMindosContextAssistantSource(value: unknown): value is NonNullable<MindosContextAssistantRef['source']> {
  return value === 'local-assistant' || value === 'builtin' || value === 'project-default' || value === 'manual';
}

export function isMindosSelectedRuntime(value: unknown): value is MindosSelectedRuntime {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && typeof record.name === 'string'
    && isMindosAgentRuntimeKind(record.kind)
  );
}

/** Legacy `selectedAcpAgent` selections are lifted into `selectedRuntime`. */
export function normalizeMindosSelectedRuntime(record: Record<string, unknown>): MindosSelectedRuntime | null | undefined {
  if (record.selectedRuntime === null) return null;
  if (isMindosSelectedRuntime(record.selectedRuntime)) {
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

  if (!isMindosSelectedAcpAgent(record.selectedAcpAgent) || record.selectedAcpAgent === null) {
    return record.selectedAcpAgent === null ? null : undefined;
  }

  return {
    ...record.selectedAcpAgent,
    kind: 'acp',
  };
}

function mindosTurnSelectedRuntimeField(record: Record<string, unknown>): MindosAgentTurnRequest['selectedRuntime'] | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, 'selectedRuntime')) return undefined;
  if (record.selectedRuntime === null) return null;
  return mindosTurnObjectField(record, 'selectedRuntime') as MindosAgentTurnRequest['selectedRuntime'] | undefined;
}

function mindosTurnSelectedAcpAgentField(record: Record<string, unknown>): MindosAgentTurnRequest['selectedAcpAgent'] | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, 'selectedAcpAgent')) return undefined;
  if (record.selectedAcpAgent === null) return null;
  return mindosTurnObjectField(record, 'selectedAcpAgent') as MindosAgentTurnRequest['selectedAcpAgent'] | undefined;
}

// ── Last-user-message accessors (generic over the host message shape) ───────

export function getLastMindosUserContent(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (isMindosTurnRecord(message) && message.role === 'user' && typeof message.content === 'string') {
      return message.content;
    }
  }
  return '';
}

export function getLastMindosUserSkillName(messages: readonly unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isMindosTurnRecord(message) || message.role !== 'user') continue;
    return typeof message.skillName === 'string' && message.skillName.trim()
      ? message.skillName.trim()
      : undefined;
  }
  return undefined;
}

export function getLastMindosUserImages(messages: readonly unknown[]): unknown[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isMindosTurnRecord(message) || message.role !== 'user') continue;
    return Array.isArray(message.images) ? message.images : [];
  }
  return [];
}

// ── Body parsers ────────────────────────────────────────────────────────────

export type MindosAgentSessionTurnBodyResult =
  | { ok: true; body: MindosAgentTurnRequest }
  | { ok: false; message: string };

/**
 * The simplified `POST /api/agent/sessions/:sessionId/turns` body: either a
 * full `messages[]` turn request (passed through with the path sessionId
 * winning over any body `chatSessionId`) or a single `message`/`prompt`
 * shorthand projected into one user message.
 */
export function normalizeMindosAgentSessionTurnBody(
  rawBody: unknown,
  sessionId: string,
): MindosAgentSessionTurnBodyResult {
  if (!sessionId.trim()) {
    return { ok: false, message: 'sessionId is required' };
  }
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, message: 'Invalid agent session turn request body' };
  }

  const record = rawBody as Record<string, unknown>;
  const unknownRequestField = findUnknownMindosAgentTurnRequestFields(record);
  if (unknownRequestField) return { ok: false, message: unknownRequestField };
  const unknownContextField = findUnknownMindosSessionTurnContextFields(record);
  if (unknownContextField) return { ok: false, message: unknownContextField };
  if (Array.isArray(record.messages)) {
    return {
      ok: true,
      body: { ...(record as unknown as MindosAgentTurnRequest), chatSessionId: sessionId },
    };
  }

  const messageRecord = mindosTurnObjectField(record, 'message');
  const context = mindosTurnObjectField(record, 'context');
  const text = mindosTurnStringField(messageRecord, 'text') ?? mindosTurnStringField(messageRecord, 'content') ?? mindosTurnStringField(record, 'prompt');
  const images = mindosTurnArrayField(messageRecord, 'images') ?? mindosTurnArrayField(record, 'images');
  if (!text && (!images || images.length === 0)) {
    return { ok: false, message: 'message.text is required' };
  }

  const runtimeOptions = mindosTurnObjectField(record, 'runtimeOptions');
  const acpRuntimeOptions = normalizeMindosAcpRuntimeOptions(record.acpRuntimeOptions);
  const selectedRuntime = mindosTurnSelectedRuntimeField(record);
  const selectedAcpAgent = mindosTurnSelectedAcpAgentField(record);
  const skillName = mindosTurnStringField(messageRecord, 'skillName');
  return {
    ok: true,
    body: {
      messages: [{
        role: 'user',
        content: text ?? '',
        timestamp: Date.now(),
        ...(images ? { images } : {}),
        ...(skillName ? { skillName } : {}),
      }],
      chatSessionId: sessionId,
      ...(normalizeMindosAgentMode(record.agentMode) ? { agentMode: normalizeMindosAgentMode(record.agentMode) } : {}),
      ...(normalizeMindosPermissionMode(record.permissionMode) ? { permissionMode: normalizeMindosPermissionMode(record.permissionMode) } : {}),
      ...(mindosTurnStringField(record, 'assistantId') ? { assistantId: mindosTurnStringField(record, 'assistantId') } : {}),
      ...(mindosTurnStringField(context, 'currentFile') ?? mindosTurnStringField(record, 'currentFile')
        ? { currentFile: mindosTurnStringField(context, 'currentFile') ?? mindosTurnStringField(record, 'currentFile') }
        : {}),
      ...(mindosTurnArrayField(context, 'attachedFiles') ?? mindosTurnArrayField(record, 'attachedFiles')
        ? { attachedFiles: mindosTurnStringArrayField(context, 'attachedFiles') ?? mindosTurnStringArrayField(record, 'attachedFiles') ?? [] }
        : {}),
      ...(mindosTurnArrayField(context, 'uploadedFiles') ?? mindosTurnArrayField(record, 'uploadedFiles')
        ? { uploadedFiles: (mindosTurnArrayField(context, 'uploadedFiles') ?? mindosTurnArrayField(record, 'uploadedFiles')) as MindosUploadedFile[] }
        : {}),
      ...(mindosTurnObjectField(context, 'workDir') ?? mindosTurnObjectField(record, 'workDir')
        ? { workDir: (mindosTurnObjectField(context, 'workDir') ?? mindosTurnObjectField(record, 'workDir')) as MindosSessionWorkDir }
        : {}),
      ...(mindosTurnObjectField(context, 'contextSelection') ?? mindosTurnObjectField(record, 'contextSelection')
        ? { contextSelection: (mindosTurnObjectField(context, 'contextSelection') ?? mindosTurnObjectField(record, 'contextSelection')) as MindosSessionContextSelection }
        : {}),
      ...(selectedRuntime !== undefined ? { selectedRuntime } : {}),
      ...(selectedAcpAgent !== undefined ? { selectedAcpAgent } : {}),
      ...(mindosTurnObjectField(record, 'runtimeBinding')
        ? { runtimeBinding: mindosTurnObjectField(record, 'runtimeBinding') as MindosRuntimeSessionBinding }
        : {}),
      ...(runtimeOptions ? { runtimeOptions: runtimeOptions as MindosNativeRuntimeOptions } : {}),
      ...(Object.keys(acpRuntimeOptions).length > 0 ? { acpRuntimeOptions } : {}),
      ...(mindosTurnObjectField(record, 'agentOptions')
        ? { agentOptions: mindosTurnObjectField(record, 'agentOptions') as MindosAgentOptions }
        : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(mindosTurnStringField(record, 'providerOverride') ? { providerOverride: mindosTurnStringField(record, 'providerOverride') } : {}),
      ...(mindosTurnStringField(record, 'modelOverride') ? { modelOverride: mindosTurnStringField(record, 'modelOverride') } : {}),
    },
  };
}

/**
 * Strict parse of a full turn request body: allowlist sweep, mode/permission
 * validation, runtime-binding cross-check and field normalisation. Message
 * text matches the Product Server handler contract verbatim
 * (server.runtime-web.test.ts pins it).
 */
export function parseMindosAgentTurnRequest(body: unknown):
  | { ok: true; body: MindosAgentTurnRequest }
  | { ok: false; message: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'Invalid agent turn request body' };
  }

  const record = body as Record<string, unknown>;
  const unknownTopLevel = firstUnknownMindosTurnField(record, MINDOS_AGENT_TURN_TOP_LEVEL_FIELDS);
  if (unknownTopLevel) return { ok: false, message: unknownTopLevel };
  if (!Array.isArray(record.messages)) {
    return { ok: false, message: 'messages must be an array' };
  }

  const agentModeError = validateMindosAgentModeField(record.agentMode);
  if (agentModeError) return { ok: false, message: agentModeError };
  const permissionModeError = validateMindosPermissionModeField(record.permissionMode);
  if (permissionModeError) return { ok: false, message: permissionModeError };

  const selectedRuntime = normalizeMindosSelectedRuntime(record);
  const runtimeBinding = normalizeMindosRuntimeSessionBinding(record.runtimeBinding);
  const runtimeBindingError = validateMindosRuntimeBindingMatchesRuntime(selectedRuntime, runtimeBinding);
  if (runtimeBindingError) return { ok: false, message: runtimeBindingError };
  const workDir = normalizeMindosSessionWorkDir(record.workDir);
  const contextSelection = normalizeMindosSessionContextSelection(record.contextSelection);
  const runtimeOptionsRecord = mindosTurnObjectField(record, 'runtimeOptions');
  const unknownRuntimeOptions = runtimeOptionsRecord ? firstUnknownMindosTurnField(runtimeOptionsRecord, MINDOS_NATIVE_RUNTIME_OPTION_FIELDS, 'runtimeOptions') : null;
  if (unknownRuntimeOptions) return { ok: false, message: unknownRuntimeOptions };
  const acpRuntimeOptionsRecord = mindosTurnObjectField(record, 'acpRuntimeOptions');
  const unknownAcpRuntimeOptions = acpRuntimeOptionsRecord ? firstUnknownMindosTurnField(acpRuntimeOptionsRecord, MINDOS_ACP_RUNTIME_OPTION_FIELDS, 'acpRuntimeOptions') : null;
  if (unknownAcpRuntimeOptions) return { ok: false, message: unknownAcpRuntimeOptions };
  const agentOptionsError = validateMindosAgentOptionsObject(record.agentOptions);
  if (agentOptionsError) return { ok: false, message: agentOptionsError };
  const selectedRuntimeRecord = mindosTurnObjectField(record, 'selectedRuntime');
  const unknownSelectedRuntime = selectedRuntimeRecord ? firstUnknownMindosTurnField(selectedRuntimeRecord, MINDOS_SELECTED_RUNTIME_FIELDS, 'selectedRuntime') : null;
  if (unknownSelectedRuntime) return { ok: false, message: unknownSelectedRuntime };
  const runtimeBindingRecord = mindosTurnObjectField(record, 'runtimeBinding');
  const unknownRuntimeBinding = runtimeBindingRecord ? firstUnknownMindosTurnField(runtimeBindingRecord, MINDOS_RUNTIME_BINDING_FIELDS, 'runtimeBinding') : null;
  if (unknownRuntimeBinding) return { ok: false, message: unknownRuntimeBinding };
  const runtimeOptions = normalizeMindosNativeRuntimeOptions(record.runtimeOptions);
  const acpRuntimeOptions = normalizeMindosAcpRuntimeOptions(record.acpRuntimeOptions);
  const agentOptions = normalizeMindosAgentOptions(record.agentOptions);

  return {
    ok: true,
    body: {
      messages: record.messages.filter((message): message is MindosAgentTurnMessage => !!message && typeof message === 'object') as MindosAgentTurnMessage[],
      ...(isMindosAgentModeValue(record.agentMode) ? { agentMode: record.agentMode } : {}),
      ...(isMindosPermissionModeValue(record.permissionMode) ? { permissionMode: record.permissionMode } : {}),
      ...(typeof record.currentFile === 'string' ? { currentFile: record.currentFile } : {}),
      ...(Array.isArray(record.attachedFiles) ? { attachedFiles: record.attachedFiles.filter((item): item is string => typeof item === 'string') } : {}),
      ...(Array.isArray(record.uploadedFiles) ? { uploadedFiles: normalizeMindosUploadedFiles(record.uploadedFiles) } : {}),
      ...(typeof record.maxSteps === 'number' && Number.isFinite(record.maxSteps) ? { maxSteps: record.maxSteps } : {}),
      ...(typeof record.assistantId === 'string' && record.assistantId.trim() ? { assistantId: record.assistantId.trim() } : {}),
      ...(selectedRuntime !== undefined ? { selectedRuntime } : {}),
      ...(runtimeBinding !== undefined ? { runtimeBinding } : {}),
      ...(isMindosSelectedAcpAgent(record.selectedAcpAgent) ? { selectedAcpAgent: record.selectedAcpAgent } : {}),
      ...(workDir !== undefined ? { workDir } : {}),
      ...(contextSelection !== undefined ? { contextSelection } : {}),
      ...(Object.keys(runtimeOptions).length > 0 ? { runtimeOptions } : {}),
      ...(Object.keys(acpRuntimeOptions).length > 0 ? { acpRuntimeOptions } : {}),
      ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
      ...(typeof record.chatSessionId === 'string' && record.chatSessionId.trim() ? { chatSessionId: record.chatSessionId.trim() } : {}),
      ...(typeof record.providerOverride === 'string' ? { providerOverride: record.providerOverride } : {}),
      ...(typeof record.modelOverride === 'string' ? { modelOverride: record.modelOverride } : {}),
    },
  };
}

// ── Capsule recovery plan → turn body (formerly web-only) ──────────────────

function mindosTurnObjectOption(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : undefined;
}

/**
 * Projects a claimed capsule recovery plan back into a canonical turn body so
 * a retry/fork/resume replays through the same route contract as an
 * interactive turn.
 */
export function mindosAgentRunCapsuleRecoveryPlanToTurnBody(
  plan: AgentRunCapsuleRecoveryPlan,
  chatSessionId: string,
): MindosAgentTurnRequest {
  const request = plan.request;
  const options = request.options ?? {};
  const storedRuntimeOptions = mindosTurnObjectOption(options.runtimeOptions);
  const storedAcpRuntimeOptions = mindosTurnObjectOption(options.acpRuntimeOptions);
  const storedAgentOptions = mindosTurnObjectOption(options.agentOptions);
  const runtimeBinding = request.runtimeBinding
    ? {
      kind: request.runtimeBinding.type,
      runtime: request.runtimeBinding.runtime,
      runtimeId: request.runtimeBinding.runtimeId,
      ...(request.runtimeBinding.externalSessionId ? { externalSessionId: request.runtimeBinding.externalSessionId } : {}),
      ...(request.runtimeBinding.cwd ? { cwd: request.runtimeBinding.cwd } : {}),
      ...(request.runtimeBinding.status ? { status: request.runtimeBinding.status } : {}),
      updatedAt: request.runtimeBinding.updatedAt ?? Date.now(),
    }
    : null;
  const nativeRuntimeOptions = request.runtime.kind === 'codex' || request.runtime.kind === 'claude'
    ? {
      ...storedRuntimeOptions,
      ...(request.model ? { modelOverride: request.model } : {}),
      ...(request.thinkingEffort ? { reasoningEffort: request.thinkingEffort } : {}),
    }
    : undefined;
  return {
    messages: structuredClone(request.messages) as unknown as MindosAgentTurnMessage[],
    selectedRuntime: { ...request.runtime },
    ...(request.runtime.kind === 'acp'
      ? { selectedAcpAgent: { id: request.runtime.id, name: request.runtime.name } }
      : {}),
    runtimeBinding: runtimeBinding as MindosRuntimeSessionBinding | null,
    ...(request.agentMode ? { agentMode: request.agentMode as MindosAgentMode } : {}),
    ...(request.permissionMode ? { permissionMode: request.permissionMode as MindosAgentPermissionMode } : {}),
    ...(request.context.currentFile ? { currentFile: request.context.currentFile } : {}),
    attachedFiles: [...request.context.attachedFiles],
    uploadedFiles: structuredClone(request.context.uploadedFiles) as MindosUploadedFile[],
    ...(typeof options.maxSteps === 'number' ? { maxSteps: options.maxSteps } : {}),
    ...(typeof options.assistantId === 'string' ? { assistantId: options.assistantId } : {}),
    ...(typeof options.providerOverride === 'string' ? { providerOverride: options.providerOverride } : {}),
    ...(request.runtime.kind === 'mindos' && request.model ? { modelOverride: request.model } : {}),
    ...(nativeRuntimeOptions ? { runtimeOptions: nativeRuntimeOptions as MindosNativeRuntimeOptions } : {}),
    ...(storedAcpRuntimeOptions ? { acpRuntimeOptions: storedAcpRuntimeOptions as MindosAcpRuntimeOptions } : {}),
    ...(storedAgentOptions ? { agentOptions: storedAgentOptions as MindosAgentOptions } : {}),
    ...(mindosTurnObjectOption(options.workDir) ? { workDir: mindosTurnObjectOption(options.workDir) as unknown as MindosSessionWorkDir } : {}),
    ...(mindosTurnObjectOption(options.contextSelection) ? { contextSelection: mindosTurnObjectOption(options.contextSelection) as unknown as MindosSessionContextSelection } : {}),
    chatSessionId,
  };
}

/** Re-exported so capsule-binding consumers keep one import surface. */
export type { AgentRunCapsuleRuntimeBinding };
