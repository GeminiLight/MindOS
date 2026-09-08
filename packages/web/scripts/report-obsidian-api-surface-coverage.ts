#!/usr/bin/env node
/**
 * Report how much of the declared Obsidian API surface the MindOS server tier
 * shim implements, and which capability matrix rows are MindOS-specific.
 *
 * Usage:
 *   pnpm run obsidian:api-coverage -- --out wiki/reviews/obsidian-api-surface-coverage-<date>.md
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBSIDIAN_CAPABILITY_MATRIX } from '@/lib/obsidian-compat/capability-matrix';
import {
  diffObsidianApiSurface,
  renderObsidianApiSurfaceDiffMarkdown,
} from '@/lib/obsidian-compat/api-surface';
import { AppShim } from '@/lib/obsidian-compat/shims/app';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function parseArgs(argv: string[]): { out?: string; json?: string } {
  const options: { out?: string; json?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return next;
    };
    if (arg === '--') continue;
    if (arg === '--out') options.out = path.resolve(repoRoot, value());
    else if (arg === '--json') options.json = path.resolve(repoRoot, value());
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: report-obsidian-api-surface-coverage [--out <markdown>] [--json <file>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-api-coverage-'));
  try {
    const app = new AppShim(mindRoot);
    const diff = diffObsidianApiSurface({
      module: createObsidianModule(),
      app,
      matrixApis: OBSIDIAN_CAPABILITY_MATRIX.map((row) => row.api),
    });
    const markdown = renderObsidianApiSurfaceDiffMarkdown(diff);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, markdown, 'utf-8');
      console.log(`[obsidian-api-coverage] Wrote ${path.relative(repoRoot, options.out)}`);
    }
    if (options.json) {
      fs.mkdirSync(path.dirname(options.json), { recursive: true });
      fs.writeFileSync(options.json, `${JSON.stringify(diff, null, 2)}\n`, 'utf-8');
      console.log(`[obsidian-api-coverage] Wrote ${path.relative(repoRoot, options.json)}`);
    }
    if (!options.out && !options.json) process.stdout.write(markdown);
    const app_ = diff.members.find((item) => item.owner === 'App');
    console.log(
      `[obsidian-api-coverage] exports ${diff.exports.implemented.length}/${diff.exports.declared} implemented, `
      + `${diff.exports.missing.length} missing, ${diff.exports.shimOnly.length} shim-only; `
      + `App members ${app_?.implemented.length ?? 0}/${app_?.declared ?? 0}; `
      + `${diff.matrix.undeclaredRows.length} matrix rows outside obsidian.d.ts`,
    );
  } finally {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  }
}

main();
