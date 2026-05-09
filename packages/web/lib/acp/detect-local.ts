export {
  expandHome,
  isPathLikeCommand,
  resolveCommandPath,
  resolveCommandPathSync,
  resolveDirectCommandPath,
  resolveExistingPresenceDir,
} from '@geminilight/mindos/protocols/acp';
export type {
  InstalledAgent,
  LocalAcpDetectionOptions,
  NotInstalledAgent,
} from '@geminilight/mindos/protocols/acp';

import {
  detectLocalAcpAgents as detectLocalAcpAgentsCore,
  type LocalAcpDetectionOptions,
} from '@geminilight/mindos/protocols/acp';
import { readSettings, type ServerSettings } from '@/lib/settings';

type LegacyDetectionSettings = Pick<ServerSettings, 'acpAgents'>;

export async function detectLocalAcpAgents(
  settingsOrOptions: ServerSettings | LegacyDetectionSettings | LocalAcpDetectionOptions = readSettings(),
): ReturnType<typeof detectLocalAcpAgentsCore> {
  let options: LocalAcpDetectionOptions;
  if ('overrides' in settingsOrOptions) {
    options = settingsOrOptions;
  } else {
    options = { overrides: (settingsOrOptions as LegacyDetectionSettings).acpAgents };
  }
  return detectLocalAcpAgentsCore(options);
}
