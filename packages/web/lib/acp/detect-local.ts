export {
  expandHome,
  isPathLikeCommand,
  resolveCommandPath,
  resolveCommandPathSync,
  resolveDirectCommandPath,
  resolveExistingPresenceDir,
} from '@mindos/acp';
export type {
  InstalledAgent,
  LocalAcpDetectionOptions,
  NotInstalledAgent,
} from '@mindos/acp';

import {
  detectLocalAcpAgents as detectLocalAcpAgentsCore,
  type LocalAcpDetectionOptions,
} from '@mindos/acp';
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
