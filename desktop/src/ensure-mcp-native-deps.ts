/**
 * Bundled `mindos-runtime/mcp/node_modules` is often produced on Linux CI; native packages (esbuild, etc.)
 * must match the host OS. Re-run `npm ci` on the user's machine when the pack stamp or heuristics say so.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { existsSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'fs';

export const MCP_NPM_CI_STAMP = '.mindos-npm-ci-platform';

function mcpNeedsNativeReinstall(mcpDir: string): boolean {
  const host = `${process.platform}-${process.arch}`;
  const stampPath = path.join(mcpDir, MCP_NPM_CI_STAMP);
  if (existsSync(stampPath)) {
    try {
      return readFileSync(stampPath, 'utf-8').trim() !== host;
    } catch {
      /* fall through */
    }
  }
  const esbuildDir = path.join(mcpDir, 'node_modules', '@esbuild');
  if (!existsSync(esbuildDir)) return false;
  let names: string[] = [];
  try {
    names = readdirSync(esbuildDir);
  } catch {
    return false;
  }
  const want = `${process.platform}-${process.arch}`;
  const hasWrong =
    (process.platform === 'darwin' && names.some((n) => n.startsWith('linux-'))) ||
    (process.platform === 'win32' && names.some((n) => n.startsWith('linux-'))) ||
    (process.platform === 'linux' && names.some((n) => n.startsWith('win32-') || n.startsWith('darwin-')));
  if (hasWrong) return true;
  return names.length > 0 && !names.includes(want);
}

export function ensureBundledMcpNodeModules(
  projectRoot: string,
  nodePath: string,
  env: Record<string, string>,
): void {
  const mcpDir = path.join(projectRoot, 'mcp');
  const lock = path.join(mcpDir, 'package-lock.json');
  const nm = path.join(mcpDir, 'node_modules');
  if (!existsSync(lock) || !existsSync(nm)) return;
  if (!mcpNeedsNativeReinstall(mcpDir)) return;

  console.info(
    '[MindOS] MCP dependencies were built for another platform — running npm ci in bundled mcp/ (one-time)...',
  );
  rmSync(nm, { recursive: true, force: true });

  const npmBin = path.join(path.dirname(nodePath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const cmd = existsSync(npmBin) ? npmBin : 'npm';
  const r = spawnSync(cmd, ['ci', '--omit=dev'], {
    cwd: mcpDir,
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`Bundled MCP npm ci failed (exit ${r.status}). Check network and disk space.`);
  }
  try {
    rmSync(path.join(mcpDir, MCP_NPM_CI_STAMP), { force: true });
  } catch {
    /* ok */
  }
  try {
    writeFileSync(path.join(mcpDir, MCP_NPM_CI_STAMP), `${process.platform}-${process.arch}`, 'utf-8');
  } catch {
    /* non-fatal */
  }
}
