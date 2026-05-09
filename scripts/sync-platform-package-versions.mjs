#!/usr/bin/env node
/**
 * Keep platform package manifests and main package optionalDependencies aligned
 * with packages/mindos/package.json version.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const productPkgPath = resolve(root, 'packages', 'mindos', 'package.json');
const platformRoot = resolve(root, 'packages', 'mindos-platforms');
const productPkg = JSON.parse(readFileSync(productPkgPath, 'utf-8'));
const version = productPkg.version;

if (!version) throw new Error('packages/mindos/package.json has no version');

for (const name of Object.keys(productPkg.optionalDependencies ?? {})) {
  if (name.startsWith('@geminilight/mindos-')) {
    productPkg.optionalDependencies[name] = version;
  }
}
writeFileSync(productPkgPath, `${JSON.stringify(productPkg, null, 2)}\n`, 'utf-8');

if (existsSync(platformRoot)) {
  for (const dir of readdirSync(platformRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgPath = resolve(platformRoot, dir.name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
  }
}

console.log(`[sync-platform-package-versions] platform packages -> ${version}`);
