import { describe, expect, it } from 'vitest';
import {
  COMPOSER_PERMISSION_CHOICES,
  resolveComposerAgentRequest,
  toComposerPermissionChoice,
} from '@/lib/agent/composer-permission';

/**
 * The composer used to carry two controls: 「模式」(Build/Plan/Goal) and
 * 「权限」(Read/Ask/Auto/Full). Plan is really a permission level — the server
 * already forced read-only for it (agent-turn-service.ts) — so the UI showed
 * "Auto" while the run was read-only. One ladder now, with Goal moved out to
 * the + menu, where it belongs as an objective rather than a toggle.
 */

describe('composer permission ladder', () => {
  it('reads as a safety ladder, least capable first', () => {
    expect(COMPOSER_PERMISSION_CHOICES).toEqual(['read', 'plan', 'ask', 'auto', 'full']);
  });
});

describe('resolving a composer choice into a turn request', () => {
  it('sends plan as a read-only run, which is what the server already enforced', () => {
    expect(resolveComposerAgentRequest({ choice: 'plan' }))
      .toEqual({ permissionMode: 'read', agentMode: 'plan' });
  });

  it('passes the ordinary permission levels straight through', () => {
    for (const choice of ['read', 'ask', 'auto', 'full'] as const) {
      expect(resolveComposerAgentRequest({ choice }))
        .toEqual({ permissionMode: choice, agentMode: 'default' });
    }
  });

  it('lets an active goal drive the run while keeping the chosen permission', () => {
    expect(resolveComposerAgentRequest({ choice: 'auto', hasGoal: true }))
      .toEqual({ permissionMode: 'auto', agentMode: 'goal' });
  });

  it('keeps a goal read-only when the user also picked plan, the stricter of the two', () => {
    expect(resolveComposerAgentRequest({ choice: 'plan', hasGoal: true }))
      .toEqual({ permissionMode: 'read', agentMode: 'goal' });
  });

  it('falls back to asking when the stored choice is unknown or missing', () => {
    expect(resolveComposerAgentRequest({ choice: undefined }))
      .toEqual({ permissionMode: 'ask', agentMode: 'default' });
    expect(resolveComposerAgentRequest({ choice: 'nonsense' as never }))
      .toEqual({ permissionMode: 'ask', agentMode: 'default' });
  });
});

describe('restoring a choice from stored state', () => {
  it('shows plan when a previous session was left in plan mode', () => {
    expect(toComposerPermissionChoice({ permissionMode: 'read', agentMode: 'plan' })).toBe('plan');
  });

  it('shows the permission level for an ordinary run', () => {
    expect(toComposerPermissionChoice({ permissionMode: 'auto', agentMode: 'default' })).toBe('auto');
  });

  it('shows the permission level for a goal run, since goal is not a permission', () => {
    expect(toComposerPermissionChoice({ permissionMode: 'auto', agentMode: 'goal' })).toBe('auto');
  });

  it('does not mistake an ordinary read-only run for plan mode', () => {
    expect(toComposerPermissionChoice({ permissionMode: 'read', agentMode: 'default' })).toBe('read');
  });

  it('defaults to asking when nothing was stored', () => {
    expect(toComposerPermissionChoice({})).toBe('ask');
  });
});
