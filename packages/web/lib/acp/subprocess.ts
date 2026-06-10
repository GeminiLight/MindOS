export {
  getActiveProcesses,
  getProcess,
  killAgent,
  killAllAgents,
} from '@geminilight/mindos/protocols/acp';
export type {
  AcpClientCallbacks,
  AcpConnection,
  AcpLaunchOptions,
  AcpProcess,
} from '@geminilight/mindos/protocols/acp';

import {
  findUserOverride,
  spawnAcpAgent as spawnAcpAgentCore,
  spawnAndConnect as spawnAndConnectCore,
  type AcpLaunchOptions,
  type AcpRegistryEntry,
} from '@geminilight/mindos/protocols/acp';
import { resolveAgentRuntimeEnvOverlay } from '@geminilight/mindos/agent-runtime';
import { readSettings } from '@/lib/settings';

function withAcpOverrides(agentId: string, options?: AcpLaunchOptions): AcpLaunchOptions {
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

export function spawnAndConnect(entry: AcpRegistryEntry, options?: AcpLaunchOptions) {
  return spawnAndConnectCore(entry, withAcpOverrides(entry.id, options));
}

export function spawnAcpAgent(entry: AcpRegistryEntry, options?: AcpLaunchOptions) {
  return spawnAcpAgentCore(entry, withAcpOverrides(entry.id, options));
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
