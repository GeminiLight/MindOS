import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

// Whole-tree lint scans need headroom when turbo runs every workspace suite in parallel.
describe('LocaleStoreInit lint contract', () => {
  it('does not read refs during render', { timeout: 60_000 }, () => {
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        '@mindos/web',
        'exec',
        'eslint',
        '-f',
        'json',
        'lib/stores/LocaleStoreInit.tsx',
        'lib/stores/LocaleStoreInitClient.tsx',
        'lib/stores/LocaleStoreInitZh.tsx',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      },
    );

    expect(result.status, result.stderr).toBe(0);

    const reports = JSON.parse(result.stdout) as Array<{
      messages: Array<{ ruleId: string | null; message: string; line: number }>;
    }>;
    const refWarnings = reports.flatMap(report =>
      report.messages.filter(message => message.ruleId === 'react-hooks/refs'),
    );

    expect(refWarnings).toEqual([]);
  });
});
