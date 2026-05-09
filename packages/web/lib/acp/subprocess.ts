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
  spawnAcpAgent as spawnAcpAgentCore,
  spawnAndConnect as spawnAndConnectCore,
  type AcpLaunchOptions,
  type AcpRegistryEntry,
} from '@geminilight/mindos/protocols/acp';
import { readSettings } from '@/lib/settings';

function withAcpOverrides(options?: AcpLaunchOptions): AcpLaunchOptions {
  return {
    ...options,
    overrides: options?.overrides ?? readSettings().acpAgents,
  };
}

export function spawnAndConnect(entry: AcpRegistryEntry, options?: AcpLaunchOptions) {
  return spawnAndConnectCore(entry, withAcpOverrides(options));
}

export function spawnAcpAgent(entry: AcpRegistryEntry, options?: AcpLaunchOptions) {
  return spawnAcpAgentCore(entry, withAcpOverrides(options));
}
