import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(mobileRoot, path), 'utf8');

describe('pending agent action sheet contract', () => {
  it('mounts one global authorization surface from the root layout', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("import PendingAgentActionSheet from '@/components/agent/PendingAgentActionSheet'");
    expect(layout).toContain('<PendingAgentActionSheet />');
  });

  it('polls only while connected and active, then refreshes after decisions', () => {
    const hook = read('hooks/usePendingAgentActions.ts');
    expect(hook).toContain('AppState.addEventListener');
    expect(hook).toContain('getPendingAgentActions');
    expect(hook).toContain('resolveRuntimePermission');
    expect(hook).toContain('resolveAutomationApproval');
    expect(hook).toContain('resolveUserQuestion');
    expect(hook).toContain('pollIntervalMs = 2500');
  });

  it('supports server-provided permission choices and complete question answers', () => {
    const sheet = read('components/agent/PendingAgentActionSheet.tsx');
    expect(sheet).toContain('action.options.map');
    expect(sheet).toContain('question.multiSelect');
    expect(sheet).toContain('buildAskUserQuestionAnswers');
    expect(sheet).toContain('Decision is enforced by the connected runtime host.');
    expect(sheet).toContain('Cancel question');
    expect(sheet).toContain('Automation approval');
    expect(sheet).toContain('Approve once');
    expect(sheet).toContain('Deny automation');
  });
});
