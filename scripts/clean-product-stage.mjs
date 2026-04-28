#!/usr/bin/env node
/**
 * Remove publish-only files generated inside packages/mindos.
 *
 * These paths are npm staging output, not source roots. Keep this allowlist
 * narrow so cleanup can run after npm pack without touching product source.
 */
import { existsSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const productRoot = resolve(root, 'packages', 'mindos');

export const STAGED_PRODUCT_PATHS = [
  'packages/mindos/_standalone',
  'packages/mindos/apps',
  'packages/mindos/packages',
  'packages/mindos/scripts',
  'packages/mindos/assets',
  'packages/mindos/skills',
  'packages/mindos/templates',
];

export const PACKAGE_DOC_PATHS = [
  'packages/mindos/README.md',
  'packages/mindos/README_zh.md',
  'packages/mindos/LICENSE',
];

export function cleanProductStage(options = {}) {
  const {
    includePackageDocs = false,
    includeStandalone = true,
    verbose = false,
  } = options;

  const paths = [
    ...STAGED_PRODUCT_PATHS.filter((rel) => includeStandalone || rel !== 'packages/mindos/_standalone'),
    ...(includePackageDocs ? PACKAGE_DOC_PATHS : []),
  ];

  for (const rel of paths) {
    const target = resolve(root, rel);
    assertInsideProductRoot(target);
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    if (verbose) console.log(`[clean-product-stage] removed ${rel}`);
  }
}

export function assertInsideProductRoot(target) {
  const rel = relative(productRoot, target);
  if (rel.startsWith('..') || rel === '' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Refusing to clean outside product package staging area: ${target}`);
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  cleanProductStage({
    includePackageDocs: process.argv.includes('--include-package-docs'),
    includeStandalone: !process.argv.includes('--keep-standalone'),
    verbose: process.argv.includes('--verbose'),
  });
}
