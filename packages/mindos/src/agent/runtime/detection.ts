import {
  compactRuntimeFailureMessage,
  compactRuntimeDiagnosticHints,
  summarizeRuntimeFailure,
} from './runtime-errors.js';
import type {
  AgentRuntimeAdapterMetadata,
  AgentRuntimeBridge,
  AgentRuntimeDescriptor,
  AgentRuntimeStatus,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
  NativeRuntimeHealthResult,
  NativeRuntimeId,
} from './registry.js';

type RuntimeResolvedCommand = NonNullable<AgentRuntimeDescriptor['resolvedCommand']>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function classifyRuntimeFailure(message: string, runtime?: NativeRuntimeId): NativeRuntimeHealthResult {
  const normalized = message.trim() || 'Runtime failed to start.';
  const summary = summarizeRuntimeFailure(normalized, { runtime });
  if (/\b(login|log in|signin|sign in|auth|authentication|unauthori[sz]ed|credential|api key|token)\b/i.test(normalized)) {
    return {
      status: 'signed-out',
      reason: summary.reason,
      ...(summary.diagnosticHints ? { diagnosticHints: summary.diagnosticHints } : {}),
    };
  }
  if (/missing environment variable/i.test(normalized)) {
    return {
      status: 'signed-out',
      reason: summary.reason,
      ...(summary.diagnosticHints ? { diagnosticHints: summary.diagnosticHints } : {}),
    };
  }
  return {
    status: 'error',
    reason: summary.reason,
    ...(summary.diagnosticHints ? { diagnosticHints: summary.diagnosticHints } : {}),
  };
}

function isResolvedCommandSource(value: unknown): value is RuntimeResolvedCommand['source'] {
  return value === 'user-override' || value === 'descriptor' || value === 'registry';
}

function isInstalledRuntimeStatus(value: unknown): value is Exclude<AgentRuntimeStatus, 'missing'> {
  return value === 'available' || value === 'signed-out' || value === 'error';
}

function isMissingRuntimeStatus(value: unknown): value is Extract<AgentRuntimeStatus, 'missing' | 'error'> {
  return value === 'missing' || value === 'error';
}

export function normalizeResolvedCommand(value: unknown): RuntimeResolvedCommand | null {
  if (!isRecord(value)) return null;
  if (typeof value.cmd !== 'string' || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string')) return null;
  if (!isResolvedCommandSource(value.source)) return null;
  return {
    cmd: value.cmd,
    args: value.args,
    source: value.source,
  };
}

export function normalizeDiagnosticHints(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const hints = value
    .filter((hint): hint is string => typeof hint === 'string' && hint.trim().length > 0)
    .map((hint) => hint.trim());
  return hints.length > 0 ? Array.from(new Set(hints)) : undefined;
}

function isRuntimeBridgeKind(value: unknown): value is AgentRuntimeBridge['kind'] {
  return value === 'codex-app-server' || value === 'claude-sdk' || value === 'claude-cli';
}

export function normalizeRuntimeBridge(value: unknown): AgentRuntimeBridge | undefined {
  if (!isRecord(value)) return undefined;
  if (!isRuntimeBridgeKind(value.kind) || typeof value.label !== 'string' || !value.label.trim()) return undefined;
  return {
    kind: value.kind,
    label: value.label.trim(),
    ...(typeof value.fallback === 'boolean' ? { fallback: value.fallback } : {}),
    ...(typeof value.reason === 'string' && value.reason.trim()
      ? { reason: compactRuntimeFailureMessage(value.reason, { runtime: value.kind === 'claude-cli' || value.kind === 'claude-sdk' ? 'claude' : 'codex' }) }
      : {}),
  };
}

function sanitizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizePositiveInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized <= 0) return undefined;
  return Math.min(normalized, max);
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeConnectionType(value: unknown): AgentRuntimeAdapterMetadata['connectionType'] | undefined {
  return value === 'stdio' || value === 'cli' || value === 'http' || value === 'sse' ? value : undefined;
}

function normalizeCapabilityFlags<T>(
  value: unknown,
  keys: Array<keyof T & string>,
): T | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, boolean> = {};
  for (const key of keys) {
    if (typeof value[key] === 'boolean') result[key] = value[key] as boolean;
  }
  return Object.keys(result).length > 0 ? result as T : undefined;
}

function normalizeAdapterModels(value: unknown): NonNullable<AgentRuntimeAdapterMetadata['models']> | undefined {
  if (!Array.isArray(value)) return undefined;
  const models = value
    .map((model) => {
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
    .filter((model): model is NonNullable<AgentRuntimeAdapterMetadata['models']>[number] => model !== null)
    .slice(0, 100);
  return models.length > 0 ? models : undefined;
}

function normalizeAdapterMetadata(value: unknown): AgentRuntimeAdapterMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const metadata: AgentRuntimeAdapterMetadata = {};
  const connectionType = normalizeConnectionType(value.connectionType);
  if (connectionType) metadata.connectionType = connectionType;
  const authRequired = normalizeBoolean(value.authRequired);
  if (authRequired !== undefined) metadata.authRequired = authRequired;
  const supportsStreaming = normalizeBoolean(value.supportsStreaming);
  if (supportsStreaming !== undefined) metadata.supportsStreaming = supportsStreaming;
  const models = normalizeAdapterModels(value.models);
  if (models) metadata.models = models;
  const promptCapabilities = normalizeCapabilityFlags<NonNullable<AgentRuntimeAdapterMetadata['promptCapabilities']>>(
    value.promptCapabilities,
    ['image', 'audio', 'embeddedContext'],
  );
  if (promptCapabilities) metadata.promptCapabilities = promptCapabilities;
  const mcpCapabilities = normalizeCapabilityFlags<NonNullable<AgentRuntimeAdapterMetadata['mcpCapabilities']>>(
    value.mcpCapabilities,
    ['stdio', 'http', 'sse'],
  );
  if (mcpCapabilities) metadata.mcpCapabilities = mcpCapabilities;
  const sessionCapabilities = normalizeCapabilityFlags<NonNullable<AgentRuntimeAdapterMetadata['sessionCapabilities']>>(
    value.sessionCapabilities,
    ['loadSession', 'list', 'resume', 'fork', 'close'],
  );
  if (sessionCapabilities) metadata.sessionCapabilities = sessionCapabilities;
  if (isRecord(value.healthCheck)) {
    const command = sanitizeOptionalString(value.healthCheck.command ?? value.healthCheck.versionCommand, 240);
    const summary = sanitizeOptionalString(value.healthCheck.summary, 300);
    const timeoutMs = normalizePositiveInteger(value.healthCheck.timeoutMs ?? value.healthCheck.timeout, 60_000);
    if (command || summary || timeoutMs !== undefined) {
      metadata.healthCheck = {
        ...(command ? { command } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(summary ? { summary } : {}),
      };
    }
  }
  if (Array.isArray(value.commands)) {
    const commands = value.commands
      .filter(isRecord)
      .map((command) => {
        const name = sanitizeOptionalString(command.name, 80);
        if (!name) return null;
        const description = sanitizeOptionalString(command.description, 240);
        const normalizedCommand: NonNullable<AgentRuntimeAdapterMetadata['commands']>[number] = {
          name,
          ...(description ? { description } : {}),
        };
        return normalizedCommand;
      })
      .filter((command): command is NonNullable<AgentRuntimeAdapterMetadata['commands']>[number] => command !== null)
      .slice(0, 50);
    if (commands.length > 0) metadata.commands = commands;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function normalizeInstalled(value: unknown): DetectedRuntimeAgent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.binaryPath !== 'string') return null;
  const resolved = normalizeResolvedCommand(value.resolvedCommand);
  const diagnosticHints = normalizeDiagnosticHints(value.diagnosticHints);
  const runtimeBridge = normalizeRuntimeBridge(value.runtimeBridge);
  const adapterMetadata = normalizeAdapterMetadata(value.adapterMetadata);
  return {
    id: value.id,
    name: value.name,
    binaryPath: value.binaryPath,
    ...(resolved ? { resolvedCommand: resolved } : {}),
    ...(adapterMetadata ? { adapterMetadata } : {}),
    ...(isInstalledRuntimeStatus(value.status) ? { status: value.status } : {}),
    ...(typeof value.reason === 'string' && value.reason.trim() ? { reason: value.reason } : {}),
    ...(diagnosticHints ? { diagnosticHints } : {}),
    ...(runtimeBridge ? { runtimeBridge } : {}),
  };
}

export function normalizeMissing(value: unknown): MissingRuntimeAgent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.installCmd !== 'string') return null;
  const diagnosticHints = normalizeDiagnosticHints(value.diagnosticHints);
  return {
    id: value.id,
    name: value.name,
    installCmd: value.installCmd,
    ...(typeof value.packageName === 'string' ? { packageName: value.packageName } : {}),
    ...(isMissingRuntimeStatus(value.status) ? { status: value.status } : {}),
    ...(typeof value.reason === 'string' && value.reason.trim() ? { reason: value.reason } : {}),
    ...(diagnosticHints ? { diagnosticHints } : {}),
  };
}

export function isCodexAgent(agent: Pick<DetectedRuntimeAgent | MissingRuntimeAgent, 'id' | 'name'>): boolean {
  const name = agent.name.toLowerCase();
  return agent.id === 'codex' || agent.id === 'codex-acp' || name === 'codex' || name.includes('codex');
}

export function isClaudeAgent(agent: Pick<DetectedRuntimeAgent | MissingRuntimeAgent, 'id' | 'name'>): boolean {
  const name = agent.name.toLowerCase();
  return agent.id === 'claude' || agent.id === 'claude-code' || name.includes('claude');
}

export function isNativeRuntimeId(value: string | null): value is NativeRuntimeId {
  return value === 'codex' || value === 'claude';
}

export function compactRuntimeHintsForDescriptor(
  hints: string[] | undefined,
  runtime: NativeRuntimeId,
  reason?: string,
): string[] {
  return compactRuntimeDiagnosticHints(hints, { runtime }).filter((hint) => hint !== reason);
}
