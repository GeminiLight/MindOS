import fs from 'fs';
import path from 'path';

/**
 * Resolve a script inside `app/scripts/` that is spawned at runtime
 * (not bundled by Next.js / Turbopack).
 *
 * Search order:
 *   1. `$MINDOS_PROJECT_ROOT/app/scripts/<name>` — Desktop / CLI production
 *   2. `<cwd>/scripts/<name>`                    — dev mode (cwd = app/)
 *   3. `<cwd>/../app/scripts/<name>`             — standalone fallback (cwd = .next/standalone/)
 *   4. `<cwd>/.next/standalone/scripts/<name>`   — standalone build output (scripts copied by outputFileTracingIncludes)
 *
 * Returns the first existing path, or `null` if none found.
 */
export function resolveScript(name: string): string | null {
  const candidates: string[] = [];

  // 1. MINDOS_PROJECT_ROOT — authoritative in Desktop & CLI production
  const projRoot = process.env.MINDOS_PROJECT_ROOT;
  if (projRoot) {
    candidates.push(path.join(projRoot, 'app', 'scripts', name));
  }

  const cwd = process.cwd();

  // 2. cwd/scripts/ — works when cwd is app/ (dev mode, `npm run dev`)
  candidates.push(path.join(cwd, 'scripts', name));

  // 3. cwd/../app/scripts/ — standalone mode: cwd is .next/standalone/
  candidates.push(path.resolve(cwd, '..', 'app', 'scripts', name));

  // 4. cwd/.next/standalone/scripts/ — build output directory
  candidates.push(path.join(cwd, '.next', 'standalone', 'scripts', name));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}
