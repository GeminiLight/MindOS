import type { AgentRuntimeIdentity } from '@/lib/types';

export const LAST_AGENT_RUNTIME_STORAGE_KEY = 'mindos:last-agent-runtime';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRuntimePreference(value: unknown): AgentRuntimeIdentity | null {
  if (!isRecord(value)) return null;
  const { id, name, kind, binaryPath } = value;
  if (typeof id !== 'string' || !id.trim()) return null;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (kind !== 'acp' && kind !== 'codex' && kind !== 'claude' && kind !== 'mindos') return null;
  if (kind === 'mindos') return null;

  return {
    id,
    name,
    kind,
    ...(typeof binaryPath === 'string' && binaryPath.trim() ? { binaryPath } : {}),
  };
}

export function loadLastSelectedAgentRuntime(): AgentRuntimeIdentity | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(LAST_AGENT_RUNTIME_STORAGE_KEY);
    if (!raw) return null;
    return normalizeRuntimePreference(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistLastSelectedAgentRuntime(runtime: AgentRuntimeIdentity | null | undefined): void {
  if (typeof localStorage === 'undefined') return;

  try {
    if (!runtime || runtime.kind === 'mindos') {
      localStorage.removeItem(LAST_AGENT_RUNTIME_STORAGE_KEY);
      return;
    }

    localStorage.setItem(LAST_AGENT_RUNTIME_STORAGE_KEY, JSON.stringify({
      id: runtime.id,
      name: runtime.name,
      kind: runtime.kind,
      ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
    }));
  } catch {
    // Ignore storage failures; runtime selection still works in memory.
  }
}
