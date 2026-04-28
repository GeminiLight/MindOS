import fs from 'fs';
import path from 'path';

/**
 * Resolve the MindOS project root directory.
 *
 * In standalone mode (`node .next/standalone/server.js`), `process.cwd()` points inside
 * the generated runtime, not necessarily at the source package. Prefer the explicit
 * runtime root injected by Desktop/CLI, then walk upward until the workspace root marker
 * is found. This keeps dev mode (`packages/web`) and standalone mode on the same rule.
 */
export function getProjectRoot(): string {
  if (process.env.MINDOS_PROJECT_ROOT) return process.env.MINDOS_PROJECT_ROOT;

  let current = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(current, 'packages', 'mindos', 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(process.cwd(), '..', '..');
}

export function resolveMindosCliPath(): string {
  if (process.env.MINDOS_CLI_PATH) return process.env.MINDOS_CLI_PATH;

  const projectRoot = getProjectRoot();
  const repoCli = path.join(projectRoot, 'packages', 'mindos', 'bin', 'cli.js');
  if (fs.existsSync(repoCli)) return repoCli;

  return path.join(projectRoot, 'bin', 'cli.js');
}

export function resolveMindosCliLibPath(fileName: string): string {
  const projectRoot = getProjectRoot();
  const repoLib = path.join(projectRoot, 'packages', 'mindos', 'bin', 'lib', fileName);
  if (fs.existsSync(repoLib)) return repoLib;

  return path.join(projectRoot, 'bin', 'lib', fileName);
}
