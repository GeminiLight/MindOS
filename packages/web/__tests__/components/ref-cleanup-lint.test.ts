import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

const componentPaths = [
  'components/Editor.tsx',
  'components/ShellLayout.tsx',
  'components/WysiwygEditor.tsx',
  'components/echo/EchoSegmentPageClient.tsx',
  'components/panels/SyncPopover.tsx',
];

describe('component ref cleanup lint contract', () => {
  it('does not access refs during render in remaining component surfaces', () => {
    const result = spawnSync(
      'pnpm',
      ['--filter', '@mindos/web', 'exec', 'eslint', '-f', 'json', ...componentPaths],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
      },
    );

    expect(result.status, result.stderr).toBe(0);

    const reports = JSON.parse(result.stdout) as Array<{
      filePath: string;
      messages: Array<{ ruleId: string | null; message: string; line: number }>;
    }>;
    const refWarnings = reports.flatMap(report =>
      report.messages
        .filter(message => message.ruleId === 'react-hooks/refs')
        .map(message => ({ filePath: report.filePath, line: message.line, message: message.message })),
    );

    expect(refWarnings).toEqual([]);
  });
});
