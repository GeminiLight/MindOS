#!/usr/bin/env node
/**
 * prepare-standalone.mjs — Materialize Next.js standalone build into _standalone/
 *
 * Called during `npm pack` (via prepack script) to bundle prebuilt production
 * server into the npm package. Users who install via npm get a ready-to-run
 * server without needing `npm install` + `next build` on their machine.
 *
 * Prerequisites: `cd app && npx next build --webpack` must have been run first.
 */
import { cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'app');
const standaloneAppDir = resolve(appDir, '.next', 'standalone');
const standaloneServerJs = resolve(standaloneAppDir, 'server.js');
const destDir = resolve(root, '_standalone');

// ── Guard: ensure standalone build exists ────────────────────────────────────
if (!existsSync(standaloneServerJs)) {
  console.error(
    `[prepare-standalone] Missing ${standaloneServerJs}\n` +
    `Run: cd app && npx next build --webpack`
  );
  process.exit(1);
}

// ── Step 1: Materialize static + public into standalone dir ──────────────────
// Reuse the same logic Desktop uses.
import { materializeStandaloneAssets } from '../desktop/scripts/prepare-mindos-bundle.mjs';
materializeStandaloneAssets(appDir);

// ── Step 2: Copy standalone to top-level _standalone/ ────────────────────────
console.log('[prepare-standalone] Copying standalone build to _standalone/ ...');
rmSync(destDir, { recursive: true, force: true });
cpSync(standaloneAppDir, destDir, { recursive: true });

// ── Step 3: Write version stamp ──────────────────────────────────────────────
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')).version;
writeFileSync(resolve(destDir, '.mindos-build-version'), version, 'utf-8');

// ── Step 4: Verify server.js ─────────────────────────────────────────────────
const destServerJs = resolve(destDir, 'server.js');
if (!existsSync(destServerJs)) {
  console.error('[prepare-standalone] FAILED: _standalone/server.js not found after copy');
  process.exit(1);
}

// ── Step 5: Verify every route declared in app-paths-manifest actually exists ─
// Root cause of the /wiki 500 bug: manifest listed the route but the page.js
// file was missing from the standalone build.  A static checklist can go stale
// when new pages are added, so we read the manifest directly — zero maintenance.
const manifestPath = resolve(destDir, '.next', 'server', 'app-paths-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('[prepare-standalone] FAILED: app-paths-manifest.json not found in standalone build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const serverDir = resolve(destDir, '.next', 'server');
const missingFiles = [];

for (const [route, relPath] of Object.entries(manifest)) {
  const absPath = resolve(serverDir, relPath);
  if (!existsSync(absPath)) {
    missingFiles.push({ route, file: relPath });
  }
}

if (missingFiles.length > 0) {
  console.error(
    `[prepare-standalone] FAILED: ${missingFiles.length} route(s) declared in app-paths-manifest.json but file missing:\n` +
    missingFiles.map(({ route, file }) => `  ${route}  →  ${file}`).join('\n') + '\n' +
    'This will cause 500 errors at runtime. Check the Next.js build output for errors.'
  );
  process.exit(1);
}

const pageRoutes = Object.keys(manifest).filter(r => r.endsWith('/page'));
console.log(`[prepare-standalone] OK — server.js + ${Object.keys(manifest).length} manifest entries verified (${pageRoutes.length} pages, v${version})`);
