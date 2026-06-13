/**
 * Git hooks (pre-push etc.) export GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE…
 * pointing at the hook's own repository. Any git spawned with that env and a
 * different cwd silently operates on the hook's repo instead of mindRoot —
 * destructively for write ops, misleadingly for queries. These vars are never
 * legitimate input to MindOS; strip them from every spawned git's env.
 * User-level git env (GIT_SSH_COMMAND, GIT_TERMINAL_PROMPT…) stays.
 * Keep the list in sync with packages/mindos (bin/lib/sync.js,
 * src/server/handlers/sync.ts).
 */
const GIT_REPO_TARGETING_VARS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
]);

export function sanitizedGitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GIT_REPO_TARGETING_VARS.has(key)),
  ) as NodeJS.ProcessEnv;
}
