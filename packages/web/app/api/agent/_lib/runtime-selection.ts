import type {
  AgentRuntimeIdentity,
  RuntimeSessionBinding,
} from '@/lib/types';
import { readSettings } from '@/lib/settings';
import {
  checkNativeRuntimeHealth,
  detectLocalAcpAgents,
  resolveCommandPath,
  resolveCommandPathCandidates,
} from '@/lib/acp/detect-local';
import { compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';
import {
  getCachedAvailableNativeRuntimeDescriptor,
  rememberAvailableNativeRuntimeDescriptor,
} from '@/lib/agent/native-runtime-descriptor-cache';
import {
  handleAgentRuntimesGet,
  type AgentRuntimeDescriptor,
  type AgentRuntimesServices,
} from '@geminilight/mindos/server';
import type { MindosAgentRuntimeSelection } from '@geminilight/mindos/agent/runtime';

const NATIVE_AGENT_TURN_HEALTH_GATE_TIMEOUT_MS = 3000;

export function acpAgentFromRuntime(runtime: unknown): { id: string; name: string } | null {
  if (!runtime || typeof runtime !== 'object') return null;
  const record = runtime as Partial<AgentRuntimeIdentity>;
  if (record.kind !== 'acp' || typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  return { id: record.id, name: record.name };
}

export function acpAgentFromLegacySelection(agent: unknown): { id: string; name: string } | null {
  if (!agent || typeof agent !== 'object') return null;
  const record = agent as { id?: unknown; name?: unknown };
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  return { id: record.id, name: record.name };
}

export function nativeAgentRuntimeFromSelection(runtime: unknown, binding?: unknown): MindosAgentRuntimeSelection | null {
  if (!runtime || typeof runtime !== 'object') return null;
  const record = runtime as Partial<AgentRuntimeIdentity>;
  if (record.kind !== 'codex' && record.kind !== 'claude') return null;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  const bindingResume = runtimeBindingResumeState(record, binding);
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    ...(bindingResume.externalSessionId ? { externalSessionId: bindingResume.externalSessionId } : {}),
  };
}

export function validateRuntimeBindingMatchesSelection(runtime: unknown, binding: unknown): string | null {
  if (binding === undefined || binding === null) return null;
  if (!runtime || typeof runtime !== 'object') {
    return 'runtimeBinding requires selectedRuntime';
  }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return 'runtimeBinding must be an object';
  }

  const runtimeRecord = runtime as Partial<AgentRuntimeIdentity>;
  const bindingRecord = binding as Partial<RuntimeSessionBinding>;
  if (runtimeRecord.kind === 'mindos') {
    return 'runtimeBinding is only valid for external runtimes';
  }
  if (runtimeRecord.kind !== 'codex' && runtimeRecord.kind !== 'claude' && runtimeRecord.kind !== 'acp') {
    return 'runtimeBinding requires a valid selectedRuntime';
  }
  if (typeof runtimeRecord.id !== 'string' || runtimeRecord.id.length === 0) {
    return 'runtimeBinding requires selectedRuntime.id';
  }
  if (bindingRecord.runtime !== runtimeRecord.kind || bindingRecord.runtimeId !== runtimeRecord.id) {
    return 'runtimeBinding must match selectedRuntime';
  }
  if (runtimeRecord.kind === 'codex' && bindingRecord.kind !== 'codex-thread') {
    return 'runtimeBinding.kind must be codex-thread for Codex';
  }
  if (runtimeRecord.kind === 'claude' && bindingRecord.kind !== 'claude-session') {
    return 'runtimeBinding.kind must be claude-session for Claude Code';
  }
  if (runtimeRecord.kind === 'acp' && bindingRecord.kind !== 'acp-session') {
    return 'runtimeBinding.kind must be acp-session for ACP';
  }
  return null;
}

export function isMindosRuntimeSelection(runtime: unknown): boolean {
  if (!runtime || typeof runtime !== 'object') return false;
  const record = runtime as Partial<AgentRuntimeIdentity>;
  return record.kind === 'mindos';
}

export async function resolveAvailableNativeRuntime(
  runtime: MindosAgentRuntimeSelection,
): Promise<{ runtime: MindosAgentRuntimeSelection; unavailableReason: null } | { runtime: null; unavailableReason: string }> {
  const services: AgentRuntimesServices = {
    readSettings: readSettings as AgentRuntimesServices['readSettings'],
    detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
    resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
    resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
    checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
  };
  const res = await Promise.race([
    handleAgentRuntimesGet(new URLSearchParams(`runtime=${runtime.kind}&force=1`), services),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), NATIVE_AGENT_TURN_HEALTH_GATE_TIMEOUT_MS)),
  ]);
  if (!res) {
    const cachedDescriptor = getCachedAvailableNativeRuntimeDescriptor(runtime.kind, runtime.id);
    const cachedRuntime = runtimeSelectionWithVerifiedBinaryPath(runtime, cachedDescriptor ?? undefined);
    if (cachedRuntime) {
      return {
        runtime: cachedRuntime,
        unavailableReason: null,
      };
    }
    return {
      runtime: null,
      unavailableReason: `${runtime.name} is still being verified. Please retry in a moment.`,
    };
  }
  const body = res.body;
  if (res.status !== 200 || !body || !('runtime' in body)) {
    return {
      runtime: null,
      unavailableReason: `Unable to verify ${runtime.name} before starting the turn.`,
    };
  }
  const descriptor = body.runtime;
  if (descriptor.kind !== runtime.kind || descriptor.id !== runtime.id) {
    return {
      runtime: null,
      unavailableReason: `${runtime.name} is not available.`,
    };
  }
  if (descriptor.status === 'available') {
    rememberAvailableNativeRuntimeDescriptor(descriptor);
    const verifiedRuntime = runtimeSelectionWithVerifiedBinaryPath(runtime, descriptor);
    if (!verifiedRuntime) {
      return {
        runtime: null,
        unavailableReason: `${descriptor.name} is unavailable. MindOS could not resolve a local executable path.`,
      };
    }
    return {
      runtime: verifiedRuntime,
      unavailableReason: null,
    };
  }
  const statusText = descriptor.status === 'signed-out'
    ? 'signed out'
    : descriptor.status === 'missing'
      ? 'not installed'
      : 'unavailable';
  const compactReason = descriptor.availability?.reason
    ? compactRuntimeDisplayReason(descriptor.availability.reason, { runtime: descriptor.kind === 'codex' || descriptor.kind === 'claude' ? descriptor.kind : undefined })
    : '';
  return {
    runtime: null,
    unavailableReason: `${descriptor.name} is ${statusText}.${compactReason ? ` ${compactReason}` : ''}`,
  };
}

function runtimeBindingResumeState(
  runtime: Partial<AgentRuntimeIdentity>,
  binding: unknown,
): { matched: boolean; externalSessionId: string | null } {
  if (!binding || typeof binding !== 'object') return { matched: false, externalSessionId: null };
  const record = binding as Partial<RuntimeSessionBinding>;
  if (record.runtime !== runtime.kind || record.runtimeId !== runtime.id) return { matched: false, externalSessionId: null };
  if (runtime.kind === 'codex' && record.kind !== 'codex-thread') return { matched: false, externalSessionId: null };
  if (runtime.kind === 'claude' && record.kind !== 'claude-session') return { matched: false, externalSessionId: null };
  if (record.status && record.status !== 'active') return { matched: true, externalSessionId: null };
  return {
    matched: true,
    externalSessionId: typeof record.externalSessionId === 'string' && record.externalSessionId.trim()
      ? record.externalSessionId
      : null,
  };
}

function runtimeSelectionWithBinaryPath(
  runtime: MindosAgentRuntimeSelection,
  binaryPath?: string,
): MindosAgentRuntimeSelection {
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    ...(binaryPath ? { binaryPath } : {}),
    ...(runtime.externalSessionId ? { externalSessionId: runtime.externalSessionId } : {}),
  };
}

function isNativeRuntimeBinaryPath(binaryPath: string | undefined): binaryPath is string {
  return typeof binaryPath === 'string' && binaryPath.trim().length > 0 && !binaryPath.startsWith('sdk:');
}

function runtimeSelectionWithVerifiedBinaryPath(
  runtime: MindosAgentRuntimeSelection,
  descriptor?: AgentRuntimeDescriptor,
): MindosAgentRuntimeSelection | null {
  const binaryPath = descriptor?.binaryPath;
  if (!isNativeRuntimeBinaryPath(binaryPath)) return null;
  return runtimeSelectionWithBinaryPath(runtime, binaryPath);
}
