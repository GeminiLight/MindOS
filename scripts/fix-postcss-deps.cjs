/**
 * Fix nested postcss dependencies inside next/node_modules.
 *
 * Next.js 16 bundles postcss@8.4.31 which depends on nanoid@^3,
 * picocolors, and source-map-js. When the app's top-level nanoid
 * is v5 (major mismatch), npm's hoisting fails to place nanoid@3
 * where postcss can find it.
 *
 * Runs as postinstall — skips silently if postcss is already OK
 * or if next/node_modules/postcss doesn't exist.
 *
 * Optimization: symlink/copy picocolors and source-map-js directly
 * from app's node_modules (compatible versions), then only use npm
 * install for nanoid (which needs v3, incompatible with app's v5).
 */

const { existsSync, mkdirSync, cpSync, symlinkSync } = require('fs');
const { join, resolve } = require('path');
const { execSync } = require('child_process');

const postcssDir = join('node_modules', 'next', 'node_modules', 'postcss');
const postcssNm = join(postcssDir, 'node_modules');
const marker = join(postcssNm, 'source-map-js');

if (!existsSync(postcssDir)) {
  process.exit(0); // postcss not installed — skip
}

if (existsSync(marker)) {
  process.exit(0); // Already fixed — skip
}

// picocolors and source-map-js: app's versions are semver-compatible with
// postcss's requirements (^1.0.0 and ^1.0.2). Safe to symlink/copy.
// nanoid: postcss needs ^3.3.6 but app has v5 (ESM-only, CJS-incompatible).
// Must use npm install for nanoid only.

const compatibleDeps = ['picocolors', 'source-map-js'];
const appNm = 'node_modules';

try {
  mkdirSync(postcssNm, { recursive: true });

  // Fast path: link compatible deps from app's node_modules
  for (const dep of compatibleDeps) {
    const srcPath = resolve(appNm, dep);
    const dstPath = resolve(postcssNm, dep);
    if (existsSync(srcPath) && !existsSync(dstPath)) {
      try {
        // junction works on Windows without admin privileges
        symlinkSync(srcPath, dstPath, 'junction');
      } catch {
        cpSync(srcPath, dstPath, { recursive: true, force: true });
      }
    }
  }

  // nanoid needs ^3 (app has v5) — must install separately
  if (!existsSync(join(postcssNm, 'nanoid'))) {
    execSync('npm install --no-save --install-strategy=nested', {
      cwd: postcssDir,
      stdio: 'ignore',
    });
  }
} catch {
  // If anything fails, fall back to full nested npm install
  try {
    execSync('npm install --no-save --install-strategy=nested', {
      cwd: postcssDir,
      stdio: 'ignore',
    });
  } catch {
    // Best-effort — build will report the real error if deps are still missing
  }
}
