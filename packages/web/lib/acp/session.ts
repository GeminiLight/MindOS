export {
  cancelPrompt,
  closeAllSessions,
  closeSession,
  getActiveSessions,
  getSession,
  listSessions,
  prompt,
  promptStream,
  setConfigOption,
  setMode,
} from '@geminilight/mindos/protocols/acp';
export type {
  AcpRegistryEntry,
  AcpSession,
  AcpSessionOptions,
} from '@geminilight/mindos/protocols/acp';

import {
  createSession as createSessionCore,
  createSessionFromEntry as createSessionFromEntryCore,
  loadSession as loadSessionCore,
  findUserOverride,
  type AcpRegistryEntry,
  type AcpSessionOptions,
} from '@geminilight/mindos/protocols/acp';
import { resolveAgentRuntimeEnvOverlay } from '@geminilight/mindos/agent-runtime';
import { readSettings } from '@/lib/settings';

function withAcpOverrides(agentId: string, options?: AcpSessionOptions): AcpSessionOptions {
  const settings = readSettings();
  const overrideEnv = findUserOverride(agentId, options?.overrides ?? settings.acpAgents)?.env ?? {};
  const runtimeEnvOverlay = omitEnvKeys(
    resolveAgentRuntimeEnvOverlay({ settings: settings.agentRuntimeEnv }).overlay,
    overrideEnv,
  );
  return {
    ...options,
    env: { ...runtimeEnvOverlay, ...(options?.env ?? {}) },
    overrides: options?.overrides ?? settings.acpAgents,
  };
}

export function createSession(agentId: string, options?: AcpSessionOptions) {
  return createSessionCore(agentId, withAcpOverrides(agentId, options));
}

export function createSessionFromEntry(entry: AcpRegistryEntry, options?: AcpSessionOptions) {
  return createSessionFromEntryCore(entry, withAcpOverrides(entry.id, options));
}

export function loadSession(agentId: string, existingSessionId: string, options?: AcpSessionOptions) {
  return loadSessionCore(agentId, existingSessionId, withAcpOverrides(agentId, options));
}

function omitEnvKeys(
  env: Record<string, string>,
  reserved: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!(key in reserved)) next[key] = value;
  }
  return next;
}
