import path from 'path';

/**
 * Resolve the MindOS project root directory.
 *
 * In standalone mode (`node .next/standalone/server.js`), `process.cwd()` points to
 * `.next/standalone/` — NOT the app or project root. `MINDOS_PROJECT_ROOT` is injected
 * by Desktop ProcessManager; for CLI launches it defaults to `cwd/..` which is correct
 * when cwd is `app/`.
 */
export function getProjectRoot(): string {
  return process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
}
