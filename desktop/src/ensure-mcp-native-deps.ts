/**
 * Ensure mcp/node_modules exists and has correct platform-native packages.
 *
 * Two scenarios:
 *   1. Fresh npm-installed package: mcp/node_modules doesn't exist at all
 *      (excluded from npm tarball via package.json "files"). Run `npm install`.
 *   2. Bundled runtime from CI: mcp/node_modules exists but was built on a
 *      different platform (e.g. Linux CI → macOS user). Re-run `npm ci`.
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

function resolveNpmBin(nodePath: string): string {
  const npmBin = path.join(path.dirname(nodePath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return existsSync(npmBin) ? npmBin : 'npm';
}

function writePlatformStamp(mcpDir: string): void {
  try {
    writeFileSync(
      path.join(mcpDir, MCP_NPM_CI_STAMP),
      `${process.platform}-${process.arch}`,
      'utf-8',
    );
  } catch { /* non-fatal */ }
}

export function ensureBundledMcpNodeModules(
  projectRoot: string,
  nodePath: string,
  env: Record<string, string>,
): void {
  const mcpDir = path.join(projectRoot, 'mcp');
  const pkgJson = path.join(mcpDir, 'package.json');
  if (!existsSync(pkgJson)) return;

  const nm = path.join(mcpDir, 'node_modules');
  const sdkPkg = path.join(nm, '@modelcontextprotocol', 'sdk', 'package.json');

  // Case 1: node_modules missing or core dependency absent → first-time install.
  // npm-installed packages don't ship mcp/node_modules (excluded in package.json "files").
  if (!existsSync(sdkPkg)) {
    console.info('[MindOS] Installing MCP dependencies (first run)...');
    if (existsSync(nm)) rmSync(nm, { recursive: true, force: true });

    const cmd = resolveNpmBin(nodePath);
    const installEnv = { ...process.env, ...env, NODE_ENV: 'production' };

    // Try --prefer-offline first for speed, fallback to online
    let r = spawnSync(cmd, ['install', '--omit=dev', '--no-workspaces', '--prefer-offline'], {
      cwd: mcpDir, env: installEnv, stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      r = spawnSync(cmd, ['install', '--omit=dev', '--no-workspaces'], {
        cwd: mcpDir, env: installEnv, stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    }
    if (r.status !== 0) {
      throw new Error(
        `MCP dependency install failed (exit ${r.status}). Check network and disk space.\n` +
        `  Try manually: cd ${mcpDir} && npm install --omit=dev`,
      );
    }
    writePlatformStamp(mcpDir);
    return;
  }

  // Case 2: node_modules exists — check platform compatibility (bundled runtime from CI).
  const lock = path.join(mcpDir, 'package-lock.json');
  if (!existsSync(lock)) return;
  if (!mcpNeedsNativeReinstall(mcpDir)) return;

  console.info(
    '[MindOS] MCP dependencies were built for another platform — running npm ci in bundled mcp/ (one-time)...',
  );
  rmSync(nm, { recursive: true, force: true });

  const cmd = resolveNpmBin(nodePath);
  const r = spawnSync(cmd, ['ci', '--omit=dev'], {
    cwd: mcpDir,
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`Bundled MCP npm ci failed (exit ${r.status}). Check network and disk space.`);
  }
  try { rmSync(path.join(mcpDir, MCP_NPM_CI_STAMP), { force: true }); } catch { /* ok */ }
  writePlatformStamp(mcpDir);
}
