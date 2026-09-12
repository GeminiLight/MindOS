import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(mobileRoot, path), 'utf8');

describe('pending agent action sheet contract', () => {
  it('mounts one global authorization surface from the root layout', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("import PendingAgentActionSheet from '@/components/agent/PendingAgentActionSheet'");
    expect(layout.match(/<PendingAgentActionSheet\b/g)).toHaveLength(1);
    expect(layout).toContain('key={workspace}');
  });

  it('refreshes on pending-action and agent-run events, keeps the 2.5s poll only as a fallback, and refreshes after decisions', () => {
    const hook = read('hooks/usePendingAgentActions.ts');
    // Foreground gating and the fallback poll now live in useEventDrivenRefresh
    // (see event-driven-refresh.test.ts); the hook must wire it rather than
    // own a setInterval or AppState listener again.
    expect(hook).toContain('useEventDrivenRefresh({');
    expect(hook).toContain("'agent-run.event'");
    expect(hook).toContain("'run.pending-actions.changed'");
    expect(hook).toContain('accept: acceptPendingAgentActionEvent');
    expect(hook).toContain('fallbackPollMs: pollIntervalMs');
    expect(hook).not.toMatch(/connectedPollMs/);
    expect(hook).not.toMatch(/\bsetInterval\s*\(/);
    expect(hook).not.toContain('AppState.addEventListener');
    expect(hook).toContain('getPendingAgentActions');
    expect(hook).toContain('resolveRuntimePermission');
    expect(hook).toContain('resolveAutomationApproval');
    expect(hook).toContain('resolveUserQuestion');
    expect(hook).toContain('pollIntervalMs = 2500');
  });

  it('consumes the server-normalized action keys instead of deriving them locally', () => {
    const hook = read('hooks/usePendingAgentActions.ts');
    expect(hook).toContain('item.key !== key');
    expect(hook).not.toContain('pendingAgentActionKey');
    const sheet = read('components/agent/PendingAgentActionSheet.tsx');
    expect(sheet).toContain('action.key');
    expect(sheet).not.toContain('pendingAgentActionKey');
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
