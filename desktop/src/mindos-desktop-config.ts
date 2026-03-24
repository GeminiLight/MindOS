/**
 * When Desktop should open `/setup?force=1` after local server is up.
 * Align with Next app shell routes: redirect to /setup only when `setupPending === true`
 * (see e.g. app/app/page.tsx). Empty mindRoot alone does not force setup — Next uses
 * effectiveSopRoot() → ~/MindOS/mind by default.
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
  return j.setupPending === true;
}

/** When saving desktopMode=local, whether to set `setupPending: true` on first merge. */
export function shouldSeedWebSetupPendingForLocal(
  mode: 'local' | 'remote',
  existing: MindosDesktopConfigShape,
): boolean {
  if (mode !== 'local') return false;
  // Do not infer from empty mindRoot — that forced /setup even after user cleared setupPending.
  return existing.setupPending === true;
}
