#!/usr/bin/env node
/**
 * Copy a built MindOS repo tree into resources/mindos-runtime for electron-builder extraResources.
 * Prerequisite: repo root has app/.next (run `npm run build` from monorepo root) and mcp/ with node_modules if needed.
 *
 *   MINDOS_BUNDLE_SOURCE=/path/to/mindos-repo node scripts/prepare-mindos-runtime.mjs
 *
 * @see wiki/specs/spec-desktop-bundled-mindos.md
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, '..');
const dest = path.join(desktopRoot, 'resources', 'mindos-runtime');
const defaultSource = path.resolve(desktopRoot, '..');
const source = process.env.MINDOS_BUNDLE_SOURCE
  ? path.resolve(process.env.MINDOS_BUNDLE_SOURCE)
  : defaultSource;

function fail(msg) {
  console.error(`[prepare-mindos-runtime] ${msg}`);
  process.exit(1);
}

const appNext = path.join(source, 'app', '.next');
const mcpDir = path.join(source, 'mcp');
const rootPkg = path.join(source, 'package.json');

if (!existsSync(rootPkg)) fail(`Not a MindOS repo root (no package.json): ${source}`);
if (!existsSync(appNext)) fail(`Missing app/.next — from repo root run: npm run build (or mindos build)`);
if (!existsSync(mcpDir)) fail(`Missing mcp/ under ${source}`);

const keepNames = new Set(['.gitkeep', 'README.md']);
mkdirSync(dest, { recursive: true });
for (const name of readdirSync(dest)) {
  if (keepNames.has(name)) continue;
  rmSync(path.join(dest, name), { recursive: true, force: true });
}

function copyTree(rel) {
  const from = path.join(source, rel);
  if (!existsSync(from)) fail(`Missing ${rel}`);
  cpSync(from, path.join(dest, rel), { recursive: true });
}

copyTree('package.json');
copyTree('LICENSE');
copyTree('app');
copyTree('mcp');
if (existsSync(path.join(source, 'scripts'))) {
  copyTree('scripts');
}

console.log(`[prepare-mindos-runtime] OK → ${dest} (from ${source})`);
