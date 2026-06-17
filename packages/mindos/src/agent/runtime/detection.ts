import {
  compactRuntimeFailureMessage,
  compactRuntimeDiagnosticHints,
  summarizeRuntimeFailure,
} from './runtime-errors.js';
import type {
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

export function normalizeInstalled(value: unknown): DetectedRuntimeAgent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.binaryPath !== 'string') return null;
  const resolved = normalizeResolvedCommand(value.resolvedCommand);
  const diagnosticHints = normalizeDiagnosticHints(value.diagnosticHints);
  const runtimeBridge = normalizeRuntimeBridge(value.runtimeBridge);
  return {
    id: value.id,
    name: value.name,
    binaryPath: value.binaryPath,
    ...(resolved ? { resolvedCommand: resolved } : {}),
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
