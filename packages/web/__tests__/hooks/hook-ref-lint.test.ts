import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

describe('hook ref lint contract', () => {
  it('does not access refs during render in shared hooks', () => {
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        '@mindos/web',
        'exec',
        'eslint',
        '-f',
        'json',
        'hooks/useAiOrganize.ts',
        'hooks/useAgentChat.ts',
        'hooks/useAskPanel.ts',
        'hooks/useFileUpload.ts',
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
