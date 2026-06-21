import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

describe('ChatContent lint contract', () => {
  it('does not access refs during render', () => {
    const result = spawnSync(
      'pnpm',
      ['--filter', '@mindos/web', 'exec', 'eslint', '-f', 'json', 'components/chat/ChatContent.tsx'],
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
