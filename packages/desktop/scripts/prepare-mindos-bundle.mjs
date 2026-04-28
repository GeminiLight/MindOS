/**
 * Shared logic for packaging the built MindOS Web runtime into Desktop `mindos-runtime`.
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'fs';
import path from 'path';
import { assertStandaloneAppFiles } from './runtime-health-contract.mjs';

export function materializeStandaloneAssets(appDir) {
  const standaloneDir = path.join(appDir, '.next', 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');
  if (!existsSync(serverJs)) {
    throw new Error(
      `[prepare-mindos-bundle] Missing ${serverJs}. Enable output: 'standalone' in packages/web/next.config.ts and run pnpm --filter @mindos/web build from repo root.`
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

  materializeStandaloneNodeModules(appDir, standaloneDir);
  materializeNextServerLib(appDir, standaloneDir);
  assertStandaloneAppFiles(appDir, 'prepare-mindos-bundle');
}

function materializeStandaloneNodeModules(appDir, standaloneDir) {
  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) return;

  replaceSymlinksWithCopies(nodeModulesDir, nodeModulesDir, path.join(appDir, 'node_modules'));
}

function replaceSymlinksWithCopies(dir, nodeModulesRoot = dir, fallbackNodeModulesDir = null) {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);
    const stat = lstatSync(child);

    if (stat.isSymbolicLink()) {
      const packageRel = path.relative(nodeModulesRoot, child);
      let target;
      try {
        target = realpathSync(child);
      } catch (err) {
        if (!fallbackNodeModulesDir) throw err;
        target = realpathSync(path.join(fallbackNodeModulesDir, packageRel));
      }
      rmSync(child, { recursive: true, force: true });
      cpSync(target, child, { recursive: true, dereference: true });
      if (existsSync(child) && lstatSync(child).isDirectory()) {
        replaceSymlinksWithCopies(child, nodeModulesRoot, fallbackNodeModulesDir);
      }
      continue;
    }

    if (stat.isDirectory()) {
      replaceSymlinksWithCopies(child, nodeModulesRoot, fallbackNodeModulesDir);
    }
  }
}

function materializeNextServerLib(appDir, standaloneDir) {
  const sourceNext = path.join(appDir, 'node_modules', 'next');
  const destNext = path.join(standaloneDir, 'node_modules', 'next');
  const sourceDist = path.join(sourceNext, 'dist');
  const destDist = path.join(destNext, 'dist');
  if (!existsSync(sourceNext) || !existsSync(destNext)) return;

  // Next 16 standalone tracing can include start-server.js without its relative
  // dist siblings. Copying next/dist preserves the runtime require graph and
  // keeps Desktop/npm standalone health checks honest.
  for (const ent of readdirSync(sourceNext, { withFileTypes: true })) {
    if (!ent.isFile() && !ent.isSymbolicLink()) continue;
    cpSync(path.join(sourceNext, ent.name), path.join(destNext, ent.name), {
      dereference: true,
    });
  }
  materializeNextDependencies(appDir, standaloneDir, sourceNext);
  if (!existsSync(sourceDist) || !existsSync(destDist)) return;
  cpSync(sourceDist, destDist, { recursive: true });
}

function materializeNextDependencies(appDir, standaloneDir, sourceNext) {
  const packageJsonPath = path.join(sourceNext, 'package.json');
  if (!existsSync(packageJsonPath)) return;
  const nextPackage = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const runtimeDeps = {
    ...(nextPackage.dependencies ?? {}),
    ...(nextPackage.peerDependencies ?? {}),
  };
  for (const packageName of Object.keys(runtimeDeps)) {
    materializePackage(appDir, standaloneDir, packageName);
  }
}

function materializePackage(appDir, standaloneDir, packageName) {
  const sourcePackage = resolvePackageDir(appDir, packageName);
  const destPackage = path.join(standaloneDir, 'node_modules', packageName);
  if (!existsSync(sourcePackage) || existsSync(destPackage)) return;
  mkdirSync(path.dirname(destPackage), { recursive: true });
  cpSync(sourcePackage, destPackage, { recursive: true, dereference: true });
}

function resolvePackageDir(appDir, packageName) {
  const direct = path.join(appDir, 'node_modules', packageName);
  if (existsSync(direct)) return direct;

  const repoRoot = path.resolve(appDir, '..', '..');
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return direct;

  const encodedName = packageName.replace('/', '+');
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith(`${encodedName}@`)) continue;
    const candidate = path.join(pnpmDir, entry, 'node_modules', packageName);
    if (existsSync(candidate)) return candidate;
  }
  return direct;
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
  fixTurbopackHashedExternals(destAppDir);
}

/**
 * Turbopack appends a content hash to serverExternalPackages names
 * (e.g. `@mariozechner/pi-agent-core-805d1afb58d9a138`).
 * standalone/node_modules only has the original name. Create symlinks so
 * the hashed require resolves to the real package.
 */
function fixTurbopackHashedExternals(destAppDir) {
  const chunksDir = path.join(destAppDir, '.next', 'standalone', '.next', 'server', 'chunks');
  const nmDir = path.join(destAppDir, '.next', 'standalone', 'node_modules');
  if (!existsSync(chunksDir) || !existsSync(nmDir)) return;

  const hashPattern = /"(@[^"\/]+\/[^"\/]+-[a-f0-9]{16,})"/g;
  for (const name of readdirSync(chunksDir)) {
    if (!name.endsWith('.js')) continue;
    const content = readFileSync(path.join(chunksDir, name), 'utf-8');
    let m;
    while ((m = hashPattern.exec(content)) !== null) {
      const hashed = m[1]; // e.g. @mariozechner/pi-agent-core-805d1afb58d9a138
      const lastDash = hashed.lastIndexOf('-');
      const original = hashed.slice(0, lastDash); // @mariozechner/pi-agent-core
      const scope = original.split('/')[0]; // @mariozechner
      const hashedPkgName = hashed.split('/')[1]; // pi-agent-core-805d1afb58d9a138
      const originalPkgName = original.split('/')[1]; // pi-agent-core

      const originalDir = path.join(nmDir, scope, originalPkgName);
      const hashedDir = path.join(nmDir, scope, hashedPkgName);

      if (existsSync(originalDir) && !existsSync(hashedDir)) {
        try {
          symlinkSync(originalPkgName, hashedDir);
          console.log(`[prepare-mindos-bundle] Symlink: ${hashed} → ${original}`);
        } catch (e) {
          console.warn(`[prepare-mindos-bundle] Failed to symlink ${hashed}:`, e.message);
        }
      }
    }
  }
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
        cpSync(fromChild, toChild, { recursive: true, dereference: true });
        replaceSymlinksWithCopies(toChild, toChild, path.resolve(fromAbs, '..', '..', 'node_modules'));
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
      cpSync(fromChild, toChild, { dereference: true });
    }
  }
}
