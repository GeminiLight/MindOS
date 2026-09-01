#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const platformsRoot = resolve(root, 'packages', 'mindos-platforms');
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;

for (const entry of readdirSync(platformsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const packageDir = resolve(platformsRoot, entry.name);
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf-8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm pack preflight failed for ${entry.name}: ${result.stderr.trim()}`);
  }
  const [report] = JSON.parse(result.stdout);
  if (!report || typeof report.size !== 'number') {
    throw new Error(`npm pack preflight did not report a tarball size for ${entry.name}`);
  }
  if (report.size > MAX_TARBALL_BYTES) {
    throw new Error(
      `${entry.name} tarball is ${(report.size / 1024 / 1024).toFixed(1)} MiB; `
      + `the release limit is ${MAX_TARBALL_BYTES / 1024 / 1024} MiB`,
    );
  }
  console.log(`[platform-pack] ${entry.name}: ${(report.size / 1024 / 1024).toFixed(1)} MiB`);
}
