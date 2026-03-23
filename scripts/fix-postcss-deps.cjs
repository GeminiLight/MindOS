/**
 * Fix nested postcss dependencies inside next/node_modules.
 *
 * Next.js 16 bundles postcss@8.4.31 which depends on nanoid@^3,
 * picocolors, and source-map-js. When the app's top-level nanoid
 * is v5 (major mismatch), npm's hoisting fails to place nanoid@3
 * where postcss can find it. This script installs the missing
 * sub-dependencies directly into postcss's node_modules.
 *
 * Runs as postinstall — skips silently if postcss is already OK
 * or if next/node_modules/postcss doesn't exist.
 */

const { existsSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');

const postcssDir = join('node_modules', 'next', 'node_modules', 'postcss');
// Check for an actual dependency, not just the node_modules directory
// (npm sometimes leaves an empty node_modules with only .bin and .package-lock.json)
const marker = join(postcssDir, 'node_modules', 'source-map-js');

if (existsSync(postcssDir) && !existsSync(marker)) {
  try {
    execSync('npm install --no-save --install-strategy=nested', {
      cwd: postcssDir,
      stdio: 'ignore',
    });
  } catch {
    // Best-effort — build will report the real error if deps are still missing
  }
}
