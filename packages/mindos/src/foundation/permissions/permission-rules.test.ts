import { describe, expect, it } from 'vitest';
import {
  evaluatePermission,
  parsePermissionRules,
  type PermissionRule,
} from './index';

describe('evaluatePermission', () => {
  it('allows agent operations by default for backwards compatibility', () => {
    const result = evaluatePermission({
      actor: { type: 'agent', agentName: 'claude-code' },
      op: 'save_file',
      path: 'Notes/today.md',
    });

    expect(result.effect).toBe('allow');
  });

  it('denies agent writes to root-level system files by default', () => {
    const result = evaluatePermission({
      actor: { type: 'agent', agentName: 'claude-code' },
      op: 'save_file',
      path: 'INSTRUCTION.md',
    });

    expect(result.effect).toBe('deny');
    expect(result.reason).toContain('protected');
  });

  it('does not apply the default system-file deny rule to user requests', () => {
    const result = evaluatePermission({
      actor: { type: 'user' },
      op: 'save_file',
      path: 'INSTRUCTION.md',
    });

    expect(result.effect).toBe('allow');
  });

  it('matches actor, operation, and glob path rules', () => {
    const rules: PermissionRule[] = [
      { actor: 'claude-code', op: 'save_file', path: 'Templates/**', effect: 'deny' },
    ];

    const result = evaluatePermission({
      actor: { type: 'agent', agentName: 'claude-code' },
      op: 'save_file',
      path: 'Templates/base/note.md',
      rules,
    });

    expect(result.effect).toBe('deny');
  });

  it('prefers more specific actor, op, and path matches', () => {
    const rules: PermissionRule[] = [
      { actor: '*', op: '*', path: '**', effect: 'allow' },
      { actor: 'claude-code', op: '*', path: 'Projects/**', effect: 'ask' },
      { actor: 'claude-code', op: 'delete_file', path: 'Projects/archive/**', effect: 'deny' },
    ];

    const result = evaluatePermission({
      actor: { type: 'agent', agentName: 'claude-code' },
      op: 'delete_file',
      path: 'Projects/archive/old.md',
      rules,
    });

    expect(result.effect).toBe('deny');
  });

  it('uses deny over ask and allow when specificity ties', () => {
    const rules: PermissionRule[] = [
      { actor: 'cursor', op: 'save_file', path: 'Notes/**', effect: 'allow' },
      { actor: 'cursor', op: 'save_file', path: 'Notes/**', effect: 'ask' },
      { actor: 'cursor', op: 'save_file', path: 'Notes/**', effect: 'deny' },
    ];

    const result = evaluatePermission({
      actor: { type: 'agent', agentName: 'cursor' },
      op: 'save_file',
      path: 'Notes/today.md',
      rules,
    });

    expect(result.effect).toBe('deny');
  });
});

describe('parsePermissionRules', () => {
  it('returns an empty list for malformed JSON instead of throwing', () => {
    expect(parsePermissionRules('{bad json')).toEqual([]);
  });

  it('keeps only valid permission rules', () => {
    expect(parsePermissionRules(JSON.stringify([
      { actor: 'claude-code', op: 'delete_file', path: '**', effect: 'ask' },
      { actor: 'bad', op: 'delete_file', path: '**', effect: 'maybe' },
      null,
    ]))).toEqual([
      { actor: 'claude-code', op: 'delete_file', path: '**', effect: 'ask' },
    ]);
  });
});
