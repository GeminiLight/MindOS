import { describe, expect, it, vi } from 'vitest';

import {
  MINDOS_THINKING_LEVELS,
  isMindosThinkingLevel,
  resolveMindosThinkingLevel,
} from './thinking.js';

describe('MindOS Pi thinking level', () => {
  it('accepts the complete Pi effort vocabulary including max', () => {
    expect(MINDOS_THINKING_LEVELS).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(MINDOS_THINKING_LEVELS.every(isMindosThinkingLevel)).toBe(true);
    expect(isMindosThinkingLevel('ultra')).toBe(false);
    expect(isMindosThinkingLevel('')).toBe(false);
  });

  it('preserves an explicit model-level request and delegates clamping to Pi', () => {
    const clamp = vi.fn((_model: unknown, level: string) => level === 'max' ? 'high' : level);
    const model = { id: 'claude-test', reasoning: true };

    expect(resolveMindosThinkingLevel({ thinkingLevel: 'max' }, model, clamp)).toBe('high');
    expect(clamp).toHaveBeenCalledWith(model, 'max');
  });

  it('maps legacy enableThinking settings without changing stored config', () => {
    const identityClamp = (_model: unknown, level: string) => level;

    expect(resolveMindosThinkingLevel({ enableThinking: false }, {}, identityClamp)).toBe('off');
    expect(resolveMindosThinkingLevel({ enableThinking: true }, {}, identityClamp)).toBe('medium');
    expect(resolveMindosThinkingLevel({}, {}, identityClamp)).toBe('off');
  });

  it('clamps unsupported reasoning on the server even when the client requested high', () => {
    const nonReasoningClamp = () => 'off';

    expect(resolveMindosThinkingLevel(
      { thinkingLevel: 'high', enableThinking: true },
      { id: 'plain-model', reasoning: false },
      nonReasoningClamp,
    )).toBe('off');
  });
});
