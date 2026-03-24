/**
 * Shared rules for when Desktop should open the web setup wizard.
 * Keep in sync with app/lib/settings.ts (mindRoot ?? sopRoot, setupPending).
 */
export interface MindosDesktopConfigShape {
  mindRoot?: string;
  sopRoot?: string;
  setupPending?: boolean;
  desktopMode?: string;
  [key: string]: unknown;
}

/** Same effective path as Next `readSettings().mindRoot` before env/default fallback. */
export function getEffectiveMindRootFromConfig(j: MindosDesktopConfigShape): string {
  const raw = j.mindRoot ?? j.sopRoot;
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

/** True → Desktop should load `/setup?force=1` for local server base URL. */
export function localBrowseNeedsSetupWizard(j: MindosDesktopConfigShape): boolean {
  if (j.setupPending === true) return true;
  return getEffectiveMindRootFromConfig(j) === '';
}

export function shouldSeedWebSetupPendingForLocal(
  mode: 'local' | 'remote',
  existing: MindosDesktopConfigShape,
): boolean {
  if (mode !== 'local') return false;
  return localBrowseNeedsSetupWizard(existing);
}
