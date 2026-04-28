#!/usr/bin/env node
/**
 * Stage repo-root runtime assets into packages/mindos before npm pack.
 *
 * The published package is packages/mindos, so package-relative paths must be
 * materialized there instead of relying on repo-root files.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { cleanProductStage } from './clean-product-stage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const productRoot = resolve(root, 'packages', 'mindos');

cleanProductStage({ includePackageDocs: true, includeStandalone: false });

copyBuiltPackage('packages/protocols/acp');
copyBuiltPackage('packages/protocols/mcp-server');
copyTree('scripts', 'scripts');
copyIfExists('assets', 'assets');
copyIfExists('skills', 'skills');
copyIfExists('templates', 'templates');
copyFile('README.md', 'README.md');
copyFile('README_zh.md', 'README_zh.md');
copyFile('LICENSE', 'LICENSE');
rewriteStagedSetupImports();

console.log('[stage-product-package] OK — runtime assets staged in packages/mindos');

function copyIfExists(from, to) {
  if (existsSync(resolve(root, from))) copyTree(from, to);
}

function copyFile(from, to) {
  const src = resolve(root, from);
  if (!existsSync(src)) return;
  const dest = resolve(productRoot, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { dereference: true });
}

function copyBuiltPackage(packagePath) {
  copyTree(`${packagePath}/dist`, `${packagePath}/dist`);
  copyFile(`${packagePath}/package.json`, `${packagePath}/package.json`);
  copyFile(`${packagePath}/README.md`, `${packagePath}/README.md`);
}

function copyTree(from, to) {
  const src = resolve(root, from);
  if (!existsSync(src)) return;
  const dest = resolve(productRoot, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: shouldCopy,
  });
}

function shouldCopy(src) {
  const rel = relative(root, src);
  const name = basename(src);
  if (name === 'node_modules' || name === '.next' || name === '.turbo') return false;
  if (name === 'dist-electron' || name === 'coverage') return false;
  if (name.endsWith('.tsbuildinfo')) return false;
  if (rel.startsWith('packages/mindos/apps/')) return false;
  if (rel.startsWith('packages/mindos/packages/')) return false;
  if (rel.startsWith('packages/mindos/scripts/')) return false;
  return true;
}

function rewriteStagedSetupImports() {
  const setup = resolve(productRoot, 'scripts', 'setup.js');
  if (!existsSync(setup)) return;
  const source = readFileSync(setup, 'utf-8')
    .replaceAll('../packages/mindos/bin/', '../bin/');
  writeFileSync(setup, source, 'utf-8');
}
