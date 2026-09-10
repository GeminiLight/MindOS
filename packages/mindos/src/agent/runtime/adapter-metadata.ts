/**
 * Adapter metadata contract and its one sanitiser.
 *
 * Non-secret facts an ACP adapter declares about itself (connection type,
 * models, prompt / MCP / session capability flags, output kinds, health check,
 * slash commands). The same shape arrives from three places: built-in
 * descriptors, `settings.acpAgents` / extension manifests
 * (`parseAcpAgentOverrides`) and detect results (`normalizeInstalled`). They all
 * go through `sanitizeAdapterMetadata` so the accepted surface cannot drift
 * between entry points again (spec-runtime-descriptor-single-source).
 */

import type {
  AcpAdapterConnectionType,
  AcpAdapterOutputCapabilities,
  AcpAdapterOutputKind,
  AcpMcpCapabilities,
  AcpPromptCapabilities,
  AcpSessionCapabilities,
} from './acp-types.js';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface AcpAgentAdapterCommandDeclaration {
  name: string;
  description?: string;
}

export interface AcpAgentAdapterModelDeclaration {
  id: string;
  label?: string;
  description?: string;
}

export interface AcpAgentAdapterSessionCapabilities extends AcpSessionCapabilities {
  loadSession?: boolean;
}

export interface AcpAgentAdapterMetadata {
  connectionType?: AcpAdapterConnectionType;
  authRequired?: boolean;
  supportsStreaming?: boolean;
  models?: AcpAgentAdapterModelDeclaration[];
  promptCapabilities?: AcpPromptCapabilities;
  mcpCapabilities?: AcpMcpCapabilities;
  sessionCapabilities?: AcpAgentAdapterSessionCapabilities;
  output?: AcpAdapterOutputCapabilities;
  healthCheck?: {
    command?: string;
    timeoutMs?: number;
    summary?: string;
  };
  commands?: AcpAgentAdapterCommandDeclaration[];
}

/* ── Limits ────────────────────────────────────────────────────────────── */

const MAX_MODELS = 100;
const MAX_COMMANDS = 50;
const MAX_OUTPUT_KINDS = 20;
const MAX_HEALTH_TIMEOUT_MS = 60_000;

const PROMPT_CAPABILITY_KEYS: Array<keyof AcpPromptCapabilities> = ['image', 'audio', 'embeddedContext'];
const MCP_CAPABILITY_KEYS: Array<keyof AcpMcpCapabilities> = ['stdio', 'http', 'sse', 'acp'];
const SESSION_CAPABILITY_KEYS: Array<keyof AcpAgentAdapterSessionCapabilities> = ['loadSession', 'list', 'delete', 'resume', 'fork', 'close'];
const OUTPUT_KINDS: readonly AcpAdapterOutputKind[] = ['text', 'diff', 'checkpoint', 'artifact', 'branch', 'pr'];

/* ── Shared primitives ─────────────────────────────────────────────────── */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function sanitizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = Array.from(new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxLength))))
    .slice(0, maxItems);
  return result.length > 0 ? result : undefined;
}

export function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function sanitizePositiveInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized <= 0) return undefined;
  return Math.min(normalized, max);
}

/* ── Field sanitisers ──────────────────────────────────────────────────── */

function sanitizeConnectionType(value: unknown): AcpAdapterConnectionType | undefined {
  return value === 'stdio' || value === 'cli' || value === 'http' || value === 'sse' ? value : undefined;
}

function sanitizeOutputKind(value: unknown): AcpAdapterOutputKind | undefined {
  return OUTPUT_KINDS.includes(value as AcpAdapterOutputKind) ? value as AcpAdapterOutputKind : undefined;
}

function sanitizeOutputKinds(value: unknown): AcpAdapterOutputKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = Array.from(new Set(value
    .map(sanitizeOutputKind)
    .filter((kind): kind is AcpAdapterOutputKind => !!kind)))
    .slice(0, MAX_OUTPUT_KINDS);
  return result.length > 0 ? result : undefined;
}

function sanitizeCapabilityFlags<T extends object>(value: unknown, keys: Array<keyof T>): T | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, boolean> = {};
  for (const key of keys) {
    const flag = value[key as string];
    if (typeof flag === 'boolean') result[key as string] = flag;
  }
  return Object.keys(result).length > 0 ? result as T : undefined;
}

function sanitizeModels(value: unknown): AcpAgentAdapterModelDeclaration[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .map((model): AcpAgentAdapterModelDeclaration | null => {
      if (typeof model === 'string') {
        const id = sanitizeOptionalString(model, 120);
        return id ? { id, label: id } : null;
      }
      if (!isRecord(model)) return null;
      const id = sanitizeOptionalString(model.id ?? model.value, 120);
      if (!id) return null;
      const label = sanitizeOptionalString(model.label ?? model.name, 120);
      const description = sanitizeOptionalString(model.description, 300);
      return {
        id,
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
      };
    })
    .filter((model): model is AcpAgentAdapterModelDeclaration => model !== null)
    .slice(0, MAX_MODELS);
  return result.length > 0 ? result : undefined;
}

function sanitizeOutputCapabilities(entry: Record<string, unknown>): AcpAdapterOutputCapabilities | undefined {
  const kinds = new Set<AcpAdapterOutputKind>();
  for (const kind of sanitizeOutputKinds(entry.kinds) ?? []) kinds.add(kind);
  for (const kind of sanitizeOutputKinds(entry.outputKinds) ?? []) kinds.add(kind);
  for (const kind of sanitizeOutputKinds(entry.reviewableOutputKinds) ?? []) kinds.add(kind);

  const fileChanges = sanitizeBoolean(entry.fileChanges);
  const artifacts = sanitizeBoolean(entry.artifacts);
  const checkpoints = sanitizeBoolean(entry.checkpoints);
  const branches = sanitizeBoolean(entry.branches);
  const pullRequests = sanitizeBoolean(entry.pullRequests);

  if (fileChanges) kinds.add('diff');
  if (artifacts) kinds.add('artifact');
  if (checkpoints) kinds.add('checkpoint');
  if (branches) kinds.add('branch');
  if (pullRequests) kinds.add('pr');
  if (kinds.size === 0) return undefined;
  kinds.add('text');

  return {
    kinds: Array.from(kinds).sort(),
    ...(fileChanges !== undefined ? { fileChanges } : {}),
    ...(artifacts !== undefined ? { artifacts } : {}),
    ...(checkpoints !== undefined ? { checkpoints } : {}),
    ...(branches !== undefined ? { branches } : {}),
    ...(pullRequests !== undefined ? { pullRequests } : {}),
  };
}

/**
 * Output can be declared three ways and all of them are accepted:
 * nested (`output: { kinds, fileChanges }` or `outputCapabilities: {…}`),
 * shorthand (`output: ['diff']`), or flat manifest fields
 * (`kinds` / `outputKinds` / `reviewableOutputKinds` / `fileChanges` / …).
 * Nested fields win over flat ones for the same key.
 */
function sanitizeOutputInput(entry: Record<string, unknown>): AcpAdapterOutputCapabilities | undefined {
  const nested: Record<string, unknown> = {
    ...(isRecord(entry.output) ? entry.output : {}),
    ...(isRecord(entry.outputCapabilities) ? entry.outputCapabilities : {}),
  };
  const hasNested = isRecord(entry.output) || isRecord(entry.outputCapabilities);
  return sanitizeOutputCapabilities({
    kinds: nested.kinds ?? (hasNested
      ? entry.outputKinds
      : entry.output ?? entry.outputCapabilities ?? entry.outputKinds ?? entry.kinds),
    outputKinds: nested.outputKinds ?? entry.outputKinds,
    reviewableOutputKinds: nested.reviewableOutputKinds ?? entry.reviewableOutputKinds,
    fileChanges: nested.fileChanges ?? entry.fileChanges,
    artifacts: nested.artifacts ?? entry.artifacts,
    checkpoints: nested.checkpoints ?? entry.checkpoints,
    branches: nested.branches ?? entry.branches,
    pullRequests: nested.pullRequests ?? entry.pullRequests,
  });
}

function sanitizeHealthCheck(value: unknown): AcpAgentAdapterMetadata['healthCheck'] | undefined {
  if (!isRecord(value)) return undefined;
  const command = sanitizeOptionalString(value.command ?? value.versionCommand, 240);
  const summary = sanitizeOptionalString(value.summary, 300);
  const timeoutMs = sanitizePositiveInteger(value.timeoutMs ?? value.timeout, MAX_HEALTH_TIMEOUT_MS);
  if (!command && !summary && timeoutMs === undefined) return undefined;
  return {
    ...(command ? { command } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(summary ? { summary } : {}),
  };
}

function sanitizeCommands(value: unknown): AcpAgentAdapterCommandDeclaration[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const commands = value
    .filter(isRecord)
    .map((command): AcpAgentAdapterCommandDeclaration | null => {
      const name = sanitizeOptionalString(command.name, 80);
      if (!name) return null;
      const description = sanitizeOptionalString(command.description, 240);
      return { name, ...(description ? { description } : {}) };
    })
    .filter((command): command is AcpAgentAdapterCommandDeclaration => command !== null)
    .slice(0, MAX_COMMANDS);
  return commands.length > 0 ? commands : undefined;
}

/* ── Entry point ───────────────────────────────────────────────────────── */

/** Reduce untrusted adapter metadata to the declared, bounded, non-secret contract. */
export function sanitizeAdapterMetadata(value: unknown): AcpAgentAdapterMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const metadata: AcpAgentAdapterMetadata = {};

  const connectionType = sanitizeConnectionType(value.connectionType);
  if (connectionType) metadata.connectionType = connectionType;
  const authRequired = sanitizeBoolean(value.authRequired);
  if (authRequired !== undefined) metadata.authRequired = authRequired;
  const supportsStreaming = sanitizeBoolean(value.supportsStreaming);
  if (supportsStreaming !== undefined) metadata.supportsStreaming = supportsStreaming;
  const models = sanitizeModels(value.models);
  if (models) metadata.models = models;

  const promptCapabilities = sanitizeCapabilityFlags<AcpPromptCapabilities>(value.promptCapabilities, PROMPT_CAPABILITY_KEYS);
  if (promptCapabilities) metadata.promptCapabilities = promptCapabilities;
  const mcpCapabilities = sanitizeCapabilityFlags<AcpMcpCapabilities>(value.mcpCapabilities, MCP_CAPABILITY_KEYS);
  if (mcpCapabilities) metadata.mcpCapabilities = mcpCapabilities;
  const sessionCapabilities = sanitizeCapabilityFlags<AcpAgentAdapterSessionCapabilities>(value.sessionCapabilities, SESSION_CAPABILITY_KEYS);
  if (sessionCapabilities) metadata.sessionCapabilities = sessionCapabilities;

  const output = sanitizeOutputInput(value);
  if (output) metadata.output = output;
  const healthCheck = sanitizeHealthCheck(value.healthCheck);
  if (healthCheck) metadata.healthCheck = healthCheck;
  const commands = sanitizeCommands(value.commands);
  if (commands) metadata.commands = commands;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
