/**
 * Shared logic for packaging MindOS `app/` into Desktop `mindos-runtime`.
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import path from 'path';

/**
 * @param {string} appDir - Absolute path to MindOS `app/` (contains .next/, public/, etc.)
 */
export function materializeStandaloneAssets(appDir) {
  const standaloneDir = path.join(appDir, '.next', 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');
  if (!existsSync(serverJs)) {
    throw new Error(
      `[prepare-mindos-bundle] Missing ${serverJs}. Enable output: 'standalone' in app/next.config.ts and run npm run build from repo root.`
    );
  }

  const staticSrc = path.join(appDir, '.next', 'static');
  const staticDest = path.join(standaloneDir, '.next', 'static');
  if (existsSync(staticSrc)) {
    mkdirSync(path.dirname(staticDest), { recursive: true });
    rmSync(staticDest, { recursive: true, force: true });
    cpSync(staticSrc, staticDest, { recursive: true });
  }

  const publicSrc = path.join(appDir, 'public');
  const publicDest = path.join(standaloneDir, 'public');
  if (existsSync(publicSrc)) {
    rmSync(publicDest, { recursive: true, force: true });
    cpSync(publicSrc, publicDest, { recursive: true });
  }
}

/**
 * @param {string} sourceAppDir
 * @param {string} destAppDir
 */
export function copyAppForBundledRuntime(sourceAppDir, destAppDir) {
  if (!existsSync(sourceAppDir)) {
    throw new Error(`[prepare-mindos-bundle] Missing app directory: ${sourceAppDir}`);
  }
  rmSync(destAppDir, { recursive: true, force: true });
  mkdirSync(destAppDir, { recursive: true });
  copyFiltered(sourceAppDir, destAppDir, '');
}

/**
 * @param {string} fromAbs
 * @param {string} toAbs
 * @param {string} rel — path relative to app root (native separators)
 */
function copyFiltered(fromAbs, toAbs, rel) {
  const skipUnderNext = ['cache', 'dev'];
  for (const seg of skipUnderNext) {
    const prefix = path.join('.next', seg);
    if (rel === prefix || rel.startsWith(prefix + path.sep)) {
      return;
    }
  }

  const entries = readdirSync(fromAbs, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;
    if (rel === '.next' && (name === 'cache' || name === 'dev')) continue;

    const nextRel = rel ? path.join(rel, name) : name;

    // Skip app-level node_modules but KEEP .next/standalone/node_modules (traced runtime deps).
    // Copy the standalone node_modules in one shot (cpSync recursive) to preserve symlinks/structure.
    if (name === 'node_modules') {
      const standalonePrefix = path.join('.next', 'standalone');
      if (rel === standalonePrefix) {
        const fromChild = path.join(fromAbs, name);
        const toChild = path.join(toAbs, name);
        cpSync(fromChild, toChild, { recursive: true });
      }
      continue;
    }

    const fromChild = path.join(fromAbs, name);
    const toChild = path.join(toAbs, name);

    if (ent.isDirectory()) {
      mkdirSync(toChild, { recursive: true });
      copyFiltered(fromChild, toChild, nextRel);
      continue;
    }
    if (ent.isFile() || ent.isSymbolicLink()) {
      mkdirSync(path.dirname(toChild), { recursive: true });
      cpSync(fromChild, toChild);
    }
  }
}
