import { describe, expect, it } from 'vitest';
import {
  createMindosAgentModeContract,
  createMindosPlanArtifact,
  evaluateMindosGoalCompletion,
  parseMindosAgentModeDirective,
  prependMindosAgentModePrompt,
  resolveMindosAgentModePermissionMode,
  resolveMindosAgentModeRequest,
} from './mode.js';

describe('MindOS agent mode contract', () => {
  it('parses /plan and /goal directives without leaking command text into the prompt', () => {
    expect(parseMindosAgentModeDirective('/plan inspect the repo first')).toEqual({
      command: '/plan',
      mode: 'plan',
      prompt: 'inspect the repo first',
    });
    expect(parseMindosAgentModeDirective('  /goal ship the feature')).toEqual({
      command: '/goal',
      mode: 'goal',
      prompt: 'ship the feature',
    });
    expect(resolveMindosAgentModeRequest({
      requestedMode: 'default',
      prompt: '/goal finish tests',
    })).toMatchObject({
      mode: 'goal',
      prompt: 'finish tests',
      directive: { command: '/goal' },
    });
    expect(parseMindosAgentModeDirective('/plan')?.prompt).toContain('reviewable plan');
    expect(parseMindosAgentModeDirective('/goal')?.prompt).toContain('complete');
  });

  it('makes Plan mode read-only while preserving Goal permission intent', () => {
    expect(resolveMindosAgentModePermissionMode('plan', 'full')).toBe('read');
    expect(resolveMindosAgentModePermissionMode('goal', 'auto')).toBe('auto');

    const contract = createMindosAgentModeContract({
      mode: 'plan',
      prompt: 'Design a migration',
      requestedPermissionMode: 'full',
      effectivePermissionMode: 'read',
    });

    expect(contract).toMatchObject({
      mode: 'plan',
      objective: 'Design a migration',
      behavior: 'read_only_plan',
      requestedPermissionMode: 'full',
      effectivePermissionMode: 'read',
    });
    expect(prependMindosAgentModePrompt('User task', contract)).toContain('do not write files');
  });

  it('extracts a reviewable plan artifact from assistant markdown', () => {
    const artifact = createMindosPlanArtifact({
      objective: 'Upgrade the runtime',
      output: [
        'Goal: Upgrade the runtime safely',
        '',
        '- [ ] Inspect current adapter boundaries',
        '- [x] Identify tests',
        '',
        'Risks',
        '- Runtime sessions may resume stale cwd',
      ].join('\n'),
      generatedAt: 10_000,
    });

    expect(artifact).toMatchObject({
      mode: 'plan',
      objective: 'Upgrade the runtime',
      summary: 'Goal: Upgrade the runtime safely',
      source: 'assistant',
      generatedAt: 10_000,
    });
    expect(artifact.steps).toEqual([
      { title: 'Inspect current adapter boundaries', status: 'pending' },
      { title: 'Identify tests', status: 'completed' },
    ]);
    expect(artifact.risks).toEqual(['Runtime sessions may resume stale cwd']);
  });

  it('evaluates explicit and inferred Goal terminal states', () => {
    expect(evaluateMindosGoalCompletion({
      objective: 'Fix the bug',
      runStatus: 'completed',
      output: 'Goal status: complete\nVerified with focused tests.',
      evaluatedAt: 1,
    })).toMatchObject({
      status: 'completed',
      confidence: 'high',
      evidence: ['Goal status: complete', 'Verified with focused tests.'],
    });

    expect(evaluateMindosGoalCompletion({
      objective: 'Publish release',
      runStatus: 'completed',
      output: 'Goal status: needs_user\nPlease provide the npm OTP.',
      evaluatedAt: 2,
    })).toMatchObject({
      status: 'needs_user',
      confidence: 'high',
      nextAction: 'User input is required before the goal can continue.',
    });

    expect(evaluateMindosGoalCompletion({
      objective: 'Run deployment',
      runStatus: 'failed',
      output: 'Command failed.',
      evaluatedAt: 3,
    })).toMatchObject({
      status: 'blocked',
      confidence: 'low',
      nextAction: 'Resolve the blocker, then rerun Goal mode.',
    });
  });
});
