import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  it('renders ACP agent mode before permission and ACP model controls after permission', () => {
    const source = readFileSync(resolve(repoRoot, 'packages/web/components/chat/ChatContent.tsx'), 'utf-8');
    const agentModeIndex = source.indexOf('<AcpRuntimeOptionsCapsule');
    const permissionIndex = source.indexOf('<ModeCapsule');
    const modelEffortIndex = source.indexOf('<AcpRuntimeOptionsCapsule', agentModeIndex + 1);

    expect(agentModeIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeGreaterThan(-1);
    expect(modelEffortIndex).toBeGreaterThan(-1);
    expect(agentModeIndex).toBeLessThan(permissionIndex);
    expect(permissionIndex).toBeLessThan(modelEffortIndex);
    expect(source.slice(agentModeIndex, permissionIndex)).toContain("controlKeys={['mode']}");
    expect(source.slice(modelEffortIndex, modelEffortIndex + 400)).toContain("controlKeys={['model', 'thoughtLevel']}");
  });
});
