#!/usr/bin/env node
/**
 * Write .mindos-build-version stamp after `next build`.
 *
 * This ensures Desktop's isNextBuildCurrent() recognizes builds
 * done via `npm run build` (packages/web/package.json) without going through
 * the CLI's `mindos build` command.
 *
 * The stamp file is read by:
 *   - packages/desktop/src/mindos-runtime-layout.ts (isNextBuildCurrent)
 *   - packages/mindos/bin/lib/build.js (needsBuild / writeBuildStamp)
 *
 * Safe to run multiple times (idempotent).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STAMP_NAME = '.mindos-build-version';
const appDir = resolve(__dirname, '..', 'packages', 'web');
const nextDir = resolve(appDir, '.next');
const stampPath = resolve(nextDir, STAMP_NAME);
const pkgPath = resolve(__dirname, '..', 'package.json');

try {
  if (!existsSync(nextDir)) {
    // next build didn't produce output — nothing to stamp
    process.exit(0);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
  if (!version) {
    console.warn('[write-build-stamp] No version in package.json, skipping');
    process.exit(0);
  }
  writeFileSync(stampPath, version, 'utf-8');
  console.log(`[write-build-stamp] ${version} → ${stampPath}`);
} catch (err) {
  // Non-fatal — build succeeded, stamp is a bonus
  console.warn('[write-build-stamp] Failed:', err.message);
}
