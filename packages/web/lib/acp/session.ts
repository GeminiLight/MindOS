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
  type AcpRegistryEntry,
  type AcpSessionOptions,
} from '@geminilight/mindos/protocols/acp';
import { readSettings } from '@/lib/settings';

function withAcpOverrides(options?: AcpSessionOptions): AcpSessionOptions {
  return {
    ...options,
    overrides: options?.overrides ?? readSettings().acpAgents,
  };
}

export function createSession(agentId: string, options?: AcpSessionOptions) {
  return createSessionCore(agentId, withAcpOverrides(options));
}

export function createSessionFromEntry(entry: AcpRegistryEntry, options?: AcpSessionOptions) {
  return createSessionFromEntryCore(entry, withAcpOverrides(options));
}

export function loadSession(agentId: string, existingSessionId: string, options?: AcpSessionOptions) {
  return loadSessionCore(agentId, existingSessionId, withAcpOverrides(options));
}
