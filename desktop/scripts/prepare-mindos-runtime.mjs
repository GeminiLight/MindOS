#!/usr/bin/env node
/**
 * Copy a built MindOS repo tree into resources/mindos-runtime for electron-builder extraResources.
 * Prerequisite: repo root has app/.next with standalone output (run `npm run build` from monorepo root).
 *
 *   MINDOS_BUNDLE_SOURCE=/path/to/mindos-repo node scripts/prepare-mindos-runtime.mjs
 *
 * Optional env:
 *   SKIP_MCP_NPM_CI=1 — do not run `npm ci --omit=dev` under copied mcp/ (offline / air-gapped)
 *
 * @see wiki/specs/spec-desktop-bundled-mindos.md
 * @see wiki/specs/spec-desktop-standalone-runtime.md
 */
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { copyAppForBundledRuntime, materializeStandaloneAssets } from './prepare-mindos-bundle.mjs';

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

const appDir = path.join(source, 'app');
const appNext = path.join(appDir, '.next');
const mcpDir = path.join(source, 'mcp');
const rootPkg = path.join(source, 'package.json');

if (!existsSync(rootPkg)) fail(`Not a MindOS repo root (no package.json): ${source}`);
if (!existsSync(appNext)) fail(`Missing app/.next — from repo root run: npm run build (or mindos build)`);
if (!existsSync(mcpDir)) fail(`Missing mcp/ under ${source}`);

try {
  materializeStandaloneAssets(appDir);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

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
copyAppForBundledRuntime(appDir, path.join(dest, 'app'));
copyTree('mcp');

const destMcp = path.join(dest, 'mcp');
const mcpLock = path.join(destMcp, 'package-lock.json');
if (process.env.SKIP_MCP_NPM_CI === '1') {
  console.warn('[prepare-mindos-runtime] SKIP_MCP_NPM_CI=1 — leaving mcp/node_modules as copied from source');
} else if (!existsSync(mcpLock)) {
  console.warn('[prepare-mindos-runtime] mcp/package-lock.json missing — skip npm ci (keep copied node_modules)');
} else {
  rmSync(path.join(destMcp, 'node_modules'), { recursive: true, force: true });
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npmCmd, ['ci', '--omit=dev'], {
    cwd: destMcp,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (r.status !== 0) {
    fail('mcp npm ci --omit=dev failed (set SKIP_MCP_NPM_CI=1 to skip)');
  }
  writeFileSync(
    path.join(destMcp, '.mindos-npm-ci-platform'),
    `${process.platform}-${process.arch}`,
    'utf-8',
  );
}

if (existsSync(path.join(source, 'scripts'))) {
  copyTree('scripts');
}

const templatesFrom = path.join(source, 'templates');
if (existsSync(templatesFrom) && statSync(templatesFrom).isDirectory()) {
  cpSync(templatesFrom, path.join(dest, 'templates'), { recursive: true });
} else {
  console.warn('[prepare-mindos-runtime] No templates/ in source — setup init will not find starter templates');
}

const binFrom = path.join(source, 'bin');
if (existsSync(binFrom) && statSync(binFrom).isDirectory()) {
  cpSync(binFrom, path.join(dest, 'bin'), { recursive: true });
} else {
  console.warn(
    '[prepare-mindos-runtime] No bin/ in source — packaged app may log "Bundled MindOS CLI not found"',
  );
}

console.log(`[prepare-mindos-runtime] OK → ${dest} (from ${source})`);
