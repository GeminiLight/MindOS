import fs from 'fs';
import path from 'path';

/**
 * Resolve a script inside `packages/web/scripts/` that is spawned at runtime
 * (not bundled by Next.js / Turbopack).
 *
 * Search order:
 *   1. `$MINDOS_PROJECT_ROOT/packages/web/scripts/<name>` — CLI production
 *   2. `<cwd>/scripts/<name>`                         — dev mode or standalone cwd
 *   3. `<cwd>/../../scripts/<name>`                   — standalone cwd = packages/web/.next/standalone
 *   4. `<cwd>/.next/standalone/scripts/<name>`        — app-root fallback
 *
 * Returns the first existing path, or `null` if none found.
 */
export function resolveScript(name: string): string | null {
  const candidates: string[] = [];

  // 1. MINDOS_PROJECT_ROOT — authoritative in Desktop & CLI production
  const projRoot = process.env.MINDOS_PROJECT_ROOT;
  if (projRoot) {
    candidates.push(path.join(projRoot, 'packages', 'web', 'scripts', name));
  }

  const cwd = process.cwd();

  // 2. cwd/scripts/ — works when cwd is packages/web/ or .next/standalone
  candidates.push(path.join(cwd, 'scripts', name));

  // 3. cwd/../../scripts/ — standalone mode: cwd is packages/web/.next/standalone/
  candidates.push(path.resolve(cwd, '..', '..', 'scripts', name));

  // 4. cwd/.next/standalone/scripts/ — app-root build output directory
  candidates.push(path.join(cwd, '.next', 'standalone', 'scripts', name));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}
