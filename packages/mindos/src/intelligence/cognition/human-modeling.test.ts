import { describe, expect, it } from 'vitest';
import {
  assessMindosHumanSignal,
  buildMindosHumanModelUpdates,
  normalizeMindosHumanSignal,
  routeMindosHumanSignal,
  scoreMindosHumanSignalStability,
  type MindosHumanModelSignal,
} from './human-modeling.js';

const sourceEvidence = {
  source: 'user-message' as const,
  quote: 'I want this to be a durable rule.',
};

describe('MindOS cognition human modeling', () => {
  it('routes human signals into Dao/Fa/Shu/Qi/Echo targets by signal kind', () => {
    expect(routeMindosHumanSignal({ kind: 'value', content: 'Long-term taste matters.' }).target).toBe('dao');
    expect(routeMindosHumanSignal({ kind: 'boundary', content: 'Do not auto-publish private notes.' }).target).toBe('fa');
    expect(routeMindosHumanSignal({ kind: 'workflow', content: 'Run focused tests before broad checks.' }).target).toBe('shu');
    expect(routeMindosHumanSignal({ kind: 'tool', content: 'Use the local browser bridge for UI proof.' }).target).toBe('qi');
    expect(routeMindosHumanSignal({ kind: 'episode', content: 'A session moment worth keeping.' }).target).toBe('echo');
  });

  it('keeps high-impact Dao and Fa updates in review unless the user confirmed them', () => {
    const candidate = assessMindosHumanSignal({
      kind: 'principle',
      content: 'Prefer source-grounded answers.',
      evidence: [sourceEvidence],
      confidence: 0.8,
    });
    expect(candidate.route.target).toBe('dao');
    expect(candidate.route.reviewRequired).toBe(true);
    expect(candidate.action).toBe('review');
    expect(candidate.reasons).toContain('high-impact-review');

    const confirmed = assessMindosHumanSignal({
      kind: 'preference',
      content: 'Keep architecture answers tied to current code.',
      userConfirmed: true,
      evidence: [sourceEvidence],
    });
    expect(confirmed.route.target).toBe('fa');
    expect(confirmed.route.reviewRequired).toBe(false);
    expect(confirmed.stability.stability).toBe('stable');
    expect(confirmed.action).toBe('promote');

    const accepted = assessMindosHumanSignal({
      kind: 'boundary_rule',
      content: 'Keep sensitive claims local-only.',
      status: 'accepted',
    });
    expect(accepted.route.target).toBe('fa');
    expect(accepted.route.reviewRequired).toBe(false);
    expect(accepted.action).toBe('promote');
  });

  it('uses evidence and status to separate stable, episodic, rejected, and deprecated updates', () => {
    expect(scoreMindosHumanSignalStability({
      kind: 'method',
      content: 'Use paired diffs for benchmark changes.',
      confidence: 0.7,
      evidence: [
        { source: 'manual-note', quote: 'first' },
        { source: 'agent-run', quote: 'second' },
      ],
    }).stability).toBe('stable');

    expect(scoreMindosHumanSignalStability({
      kind: 'imprint',
      content: 'The session felt unresolved.',
      confidence: 0.7,
      evidence: [sourceEvidence],
    }).stability).toBe('episodic');

    expect(assessMindosHumanSignal({
      kind: 'rule',
      content: 'Old rule',
      status: 'deprecated',
    }).action).toBe('deprecate');

    expect(assessMindosHumanSignal({
      kind: 'rule',
      content: 'Rejected rule',
      status: 'rejected',
    }).action).toBe('ignore');
  });

  it('normalizes noisy input without mutating caller-owned signal objects', () => {
    const signal: MindosHumanModelSignal = {
      kind: 'SOP',
      content: '  Use a narrow verification ladder.  ',
      tags: ['Tests', 'tests', '  verification  ', ''],
      evidence: [{ source: 'manual-note', quote: '  proof first  ' }],
      confidence: Number.POSITIVE_INFINITY,
    };

    const normalized = normalizeMindosHumanSignal(signal);

    expect(normalized).toMatchObject({
      kind: 'workflow',
      content: 'Use a narrow verification ladder.',
      tags: ['Tests', 'verification'],
      confidence: 0.5,
    });
    expect(normalized.evidence[0]?.quote).toBe('proof first');
    expect(signal.content).toBe('  Use a narrow verification ladder.  ');
    expect(signal.tags).toEqual(['Tests', 'tests', '  verification  ', '']);
  });

  it('keeps unknown or empty signals safe instead of inventing a model claim', () => {
    const unknown = assessMindosHumanSignal({
      kind: 'mood-board',
      content: 'Maybe relevant someday.',
      confidence: 0.9,
    });
    expect(unknown.route.target).toBe('echo');
    expect(unknown.stability.stability).toBe('candidate');
    expect(unknown.action).toBe('review');
    expect(unknown.reasons).toContain('unknown-kind');

    const empty = assessMindosHumanSignal({
      kind: 'rule',
      content: '   ',
      confidence: 1,
    });
    expect(empty.action).toBe('ignore');
    expect(empty.reasons).toContain('empty-content');
  });

  it('builds a deduped batch update plan with target and action stats', () => {
    const output = buildMindosHumanModelUpdates({
      signals: [
        { kind: 'tool', content: 'Use ripgrep for code search.', userConfirmed: true },
        { kind: 'tool', content: 'Use ripgrep for code search.', userConfirmed: true },
        { kind: 'workflow', content: 'Run focused tests.', evidence: [sourceEvidence] },
        { kind: 'episode', content: 'The conversation had an unresolved thread.', evidence: [sourceEvidence] },
        { kind: 'rule', content: '  ' },
      ],
    });

    expect(output.stats.totalSignals).toBe(5);
    expect(output.stats.modeledSignals).toBe(4);
    expect(output.stats.ignoredSignals).toBe(1);
    expect(output.stats.byTarget).toMatchObject({ qi: 1, shu: 1, echo: 1, fa: 1 });
    expect(output.stats.byAction).toMatchObject({
      promote: 1,
      review: 1,
      'keep-episodic': 1,
      ignore: 1,
    });
  });
});
