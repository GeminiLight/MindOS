#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  copyRuntimeDependencyClosure,
  runtimeDependencySeeds,
} from './lib/runtime-dependency-closure.mjs';

const [, , appDirArg, destNodeModulesArg] = process.argv;

if (!appDirArg || !destNodeModulesArg) {
  console.error('Usage: node scripts/copy-runtime-dependencies.mjs <appDir> <destNodeModules>');
  process.exit(1);
}

const appDir = resolve(appDirArg);
const destNodeModules = resolve(destNodeModulesArg);

try {
  copyRuntimeDependencyClosure(destNodeModules, runtimeDependencySeeds, {
    appDir,
    label: 'copy-runtime-dependencies',
  });
  console.log(`[copy-runtime-dependencies] OK - copied ${runtimeDependencySeeds.length} runtime dependency seed(s)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
