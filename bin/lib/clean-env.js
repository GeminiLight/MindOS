/**
 * Create a clean environment for spawning a new MindOS process.
 *
 * During `mindos update`, the old process inherits env vars like
 * MINDOS_PROJECT_ROOT, MINDOS_CLI_PATH etc. that point to the OLD
 * installation path. If these leak into the child process, the "new"
 * server starts from the old code — the infamous "fake update" bug.
 *
 * This helper strips ALL MINDOS_* / MIND_* prefixed variables plus
 * a curated denylist of other vars that can cause stale-path issues.
 */

/** Env var prefixes that must be stripped for a clean restart */
const STRIP_PREFIXES = ['MINDOS_', 'MIND_'];

/** Additional specific vars to strip (not prefix-matched) */
const STRIP_EXACT = [
  'AUTH_TOKEN',
  'WEB_PASSWORD',
  'NODE_OPTIONS', // may contain --inspect or old module paths
];

/**
 * Return a copy of `process.env` with all MindOS-related vars removed.
 * The new child process will re-derive paths from its own ROOT constant.
 */
export function cleanEnvForRestart(baseEnv = process.env) {
  const cleaned = { ...baseEnv };
  for (const key of Object.keys(cleaned)) {
    if (STRIP_PREFIXES.some(p => key.startsWith(p))) {
      delete cleaned[key];
    }
  }
  for (const key of STRIP_EXACT) {
    delete cleaned[key];
  }
  return cleaned;
}
