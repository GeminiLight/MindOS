import {
  checkAcpHandshakeHealth as checkAcpHandshakeHealthCore,
  listCachedAcpHandshakeHealth,
  type AcpHandshakeHealthResult,
} from '@geminilight/mindos/protocols/acp';
import type { AgentRuntimeDescriptor } from '@/lib/types';
import { closeSession, createSession } from './session';

export type AcpHandshakeHealthForRuntimesOptions = {
  probe?: boolean;
  force?: boolean;
  cwd?: string;
};

export async function getAcpHandshakeHealthForRuntimes(
  runtimes: Array<Pick<AgentRuntimeDescriptor, 'id' | 'kind' | 'status'>>,
  options: AcpHandshakeHealthForRuntimesOptions = {},
): Promise<AcpHandshakeHealthResult[]> {
  const acpRuntimeIds = runtimes
    .filter((runtime) => runtime.kind === 'acp' && runtime.status === 'available')
    .map((runtime) => runtime.id);
  if (acpRuntimeIds.length === 0) return [];

  if (!options.probe) {
    return listCachedAcpHandshakeHealth(acpRuntimeIds);
  }

  const settled = await Promise.allSettled(acpRuntimeIds.map((agentId) => (
    checkAcpHandshakeHealthCore(agentId, {
      createSession,
      closeSession,
      cwd: options.cwd,
      force: options.force,
    })
  )));
  return settled
    .map((result) => result.status === 'fulfilled' ? result.value : null)
    .filter((result): result is AcpHandshakeHealthResult => Boolean(result));
}
