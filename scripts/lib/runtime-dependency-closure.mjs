import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export const runtimeDependencySeeds = [
  '@mariozechner/pi-coding-agent',
  '@sinclair/typebox',
  'partial-json',
  'ajv',
  'ajv-formats',
  '@anthropic-ai/sdk',
  'openai',
];

export function copyRuntimeDependencyClosure(destNodeModules, seeds, options) {
  if (!existsSync(destNodeModules)) return;

  const appDir = options?.appDir;
  const label = options?.label ?? 'runtime-dependency-closure';
  if (!appDir) {
    throw new Error(`[${label}] appDir is required`);
  }

  const visited = new Set();
  const queue = seeds.map((name) => ({ name, required: true, strict: true, from: appDir }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next.name)) continue;

    const packageDir = resolvePackageDir(next.name, next.from, appDir);
    if (!packageDir) {
      if (next.strict) {
        throw new Error(`[${label}] runtime dependency not resolvable: ${next.name}`);
      }
      continue;
    }

    const packageJsonPath = resolve(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      if (next.strict) {
        throw new Error(`[${label}] runtime dependency package.json missing: ${next.name}`);
      }
      continue;
    }

    visited.add(next.name);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const targetDir = resolve(destNodeModules, next.name);
    if (!existsSync(targetDir)) {
      mkdirSync(dirname(targetDir), { recursive: true });
      rmSync(targetDir, { recursive: true, force: true });
      cpSync(packageDir, targetDir, {
        recursive: true,
        dereference: true,
        filter: shouldCopyRuntimePackageEntry,
      });
    }

    const peerMeta = packageJson.peerDependenciesMeta ?? {};
    const deps = [
      ...Object.keys(packageJson.dependencies ?? {}).map((name) => ({ name, required: true })),
      ...Object.keys(packageJson.peerDependencies ?? {}).map((name) => ({
        name,
        required: peerMeta[name]?.optional !== true,
      })),
      ...Object.keys(packageJson.optionalDependencies ?? {}).map((name) => ({ name, required: false })),
    ];

    for (const dep of deps) {
      if (!visited.has(dep.name)) queue.push({ ...dep, strict: dep.required, from: packageDir });
    }
  }
}

function resolvePackageDir(packageName, fromDir, appDir) {
  if (resolve(fromDir) !== resolve(appDir)) {
    const packageScopedPath = resolvePackageDirFrom(packageName, fromDir);
    if (packageScopedPath) return packageScopedPath;
  }

  const directPath = resolve(appDir, 'node_modules', packageName);
  if (existsSync(resolve(directPath, 'package.json'))) return realpathSync(directPath);

  return resolvePackageDirFrom(packageName, fromDir);
}

function resolvePackageDirFrom(packageName, fromDir) {
  try {
    const requireFromPackage = createRequire(resolve(fromDir, 'package.json'));
    const entry = requireFromPackage.resolve(packageName);
    return findPackageRoot(entry, packageName);
  } catch {
    return null;
  }
}

function findPackageRoot(startPath, packageName) {
  let dir = dirname(startPath);

  while (dir !== dirname(dir)) {
    const packageJsonPath = resolve(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.name === packageName) return dir;
      } catch {
        return null;
      }
    }
    dir = dirname(dir);
  }

  return null;
}

function shouldCopyRuntimePackageEntry(src) {
  const name = src.split('/').pop();
  return name !== 'node_modules' && name !== '.cache' && name !== '.turbo';
}
