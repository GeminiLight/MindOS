import { apiFetch } from '@/lib/api';
import type { SkillMatrixCellStatus } from '@/components/settings/types';

/** Per-cell write actions of the unified (skill × agent) matrix. */
export type SkillCellAction = 'link' | 'unlink' | 'disable-native' | 'enable-native';

/**
 * What clicking a cell toggle should do, given its current status.
 *   linked/copied → unlink (remove the managed link)
 *   conflict      → disable-native (park the agent-owned dir, reversible)
 *   native-disabled → enable-native (restore the parked dir)
 *   none/broken   → link (broken links are replaced cleanly)
 */
export function nextSkillCellAction(status: SkillMatrixCellStatus | undefined): SkillCellAction {
  if (status === 'linked' || status === 'copied') return 'unlink';
  if (status === 'conflict') return 'disable-native';
  if (status === 'native-disabled') return 'enable-native';
  return 'link';
}

/** A cell counts as "on" when the agent will load the skill on its next scan. */
export function isSkillCellOn(status: SkillMatrixCellStatus | undefined): boolean {
  return status === 'linked' || status === 'copied' || status === 'conflict';
}

/** Fire a cell action against the unified write interface. */
export async function postSkillCellAction(action: SkillCellAction, name: string, agentKey: string): Promise<void> {
  await apiFetch('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, name, agentKey }),
  });
  window.dispatchEvent(new Event('mindos:skills-changed'));
}
