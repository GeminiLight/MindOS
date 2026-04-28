import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Module-load smoke tests — verify every product CLI JS module can be parsed by
 * the Node.js ESM loader without SyntaxError.
 *
 * Catches issues like premature comment termination (e.g. `MINDOS_*​/` inside
 * a block comment being treated as the closing `*​/`).
 */

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'packages', 'mindos', 'bin');

/** Collect all .js files under a directory (non-recursive, single level). */
function listJs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => path.join(dir, f));
}

// Gather every module under packages/mindos/bin.
const modules = [
  ...listJs(BIN),
  ...listJs(path.join(BIN, 'commands')),
  ...listJs(path.join(BIN, 'lib')),
];

describe('packages/mindos/bin modules can be parsed by Node.js ESM loader', () => {
  it.each(modules.map((m) => [path.relative(ROOT, m), m]))(
    '%s loads without SyntaxError',
    (_label, modulePath) => {
      // Use a subprocess so a SyntaxError in one module doesn't kill the
      // test runner. The script simply imports the module and exits.
      const script = `import(${JSON.stringify('file://' + modulePath)}).then(() => process.exit(0)).catch(e => { process.stderr.write(e.message); process.exit(1); })`;

      try {
        execFileSync(process.execPath, ['--input-type=module', '-e', script], {
          encoding: 'utf-8',
          timeout: 10_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        const msg = (e.stderr || '').trim();
        expect.fail(
          `Module failed to load: ${path.relative(ROOT, modulePath as string)}\n` +
            `  Error: ${msg}`,
        );
      }
    },
  );

  it('discovered at least 40 modules (sanity check)', () => {
    // We currently have ~50 modules; fail if the glob suddenly finds very few,
    // which would mean the test isn't actually covering anything.
    expect(modules.length).toBeGreaterThanOrEqual(40);
  });
});
