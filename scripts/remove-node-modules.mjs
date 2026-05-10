#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const nodeModules = resolve(repoRoot, 'node_modules');

if (existsSync(nodeModules)) {
  rmSync(nodeModules, { recursive: true, force: true });
  console.log('[remove-node-modules] Removed node_modules/');
} else {
  console.log('[remove-node-modules] node_modules/ already absent');
}
