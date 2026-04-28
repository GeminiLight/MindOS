export {
  getActiveProcesses,
  getProcess,
  killAgent,
  killAllAgents,
} from '@mindos/acp';
export type {
  AcpClientCallbacks,
  AcpConnection,
  AcpLaunchOptions,
  AcpProcess,
} from '@mindos/acp';

import {
  spawnAcpAgent as spawnAcpAgentCore,
  spawnAndConnect as spawnAndConnectCore,
  type AcpLaunchOptions,
  type AcpRegistryEntry,
} from '@mindos/acp';
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
