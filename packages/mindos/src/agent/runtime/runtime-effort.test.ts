import { describe, expect, it } from 'vitest';
import {
  CLAUDE_REASONING_EFFORTS,
  CODEX_REASONING_EFFORTS,
  MINDOS_THINKING_EFFORTS,
  normalizeRuntimeEffort,
  runtimeEffortVocabulary,
} from './runtime-effort.js';

describe('normalizeRuntimeEffort vocabularies', () => {
  it('pins each runtime vocabulary', () => {
    expect(CODEX_REASONING_EFFORTS).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(CLAUDE_REASONING_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(MINDOS_THINKING_EFFORTS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(runtimeEffortVocabulary('codex')).toBe(CODEX_REASONING_EFFORTS);
    expect(runtimeEffortVocabulary('claude')).toBe(CLAUDE_REASONING_EFFORTS);
    expect(runtimeEffortVocabulary('mindos')).toBe(MINDOS_THINKING_EFFORTS);
    expect(runtimeEffortVocabulary('acp')).toBeNull();
    expect(runtimeEffortVocabulary(undefined)).toBeNull();
  });

  it.each([
    ['codex', 'minimal'], ['codex', 'low'], ['codex', 'medium'], ['codex', 'high'], ['codex', 'xhigh'],
    ['codex', 'max'], ['codex', 'ultra'],
    ['claude', 'low'], ['claude', 'medium'], ['claude', 'high'], ['claude', 'xhigh'],
    ['mindos', 'off'], ['mindos', 'minimal'], ['mindos', 'max'],
  ] as const)('passes a known %s effort "%s" through unchanged', (kind, level) => {
    expect(normalizeRuntimeEffort(kind, level)).toEqual({ effort: level, fellBack: false });
  });

  it.each(['codex', 'claude', 'mindos'] as const)('folds case and whitespace for %s', (kind) => {
    const result = normalizeRuntimeEffort(kind, '  HIGH  ');
    expect(result.effort).toBe('high');
    expect(result.fellBack).toBe(false);
    if (!result.fellBack) expect(result.requested).toBe('  HIGH  ');
  });

  it('rejects minimal for claude (not in its vocabulary) and falls back', () => {
    const result = normalizeRuntimeEffort('claude', 'minimal');
    expect(result).toMatchObject({ effort: undefined, fellBack: true, requested: 'minimal' });
    if (result.fellBack) expect(result.note).toMatch(/not supported by Claude Code/);
  });

  it.each([
    ['codex', 'turbo'], ['codex', 'none'], ['claude', 'turbo'], ['mindos', 'turbo'],
  ] as const)('falls back to the runtime default for unknown %s effort "%s"', (kind, level) => {
    const result = normalizeRuntimeEffort(kind, level);
    expect(result.effort).toBeUndefined();
    expect(result.fellBack).toBe(true);
    if (result.fellBack) {
      expect(result.requested).toBe(level);
      expect(result.note).toContain(level);
      expect(result.note).toMatch(/using its default/);
    }
  });

  it.each([undefined, null, '', '   ', 42, {}, []])('treats %# as no effort requested (not a fallback)', (level) => {
    const result = normalizeRuntimeEffort('codex', level);
    expect(result).toEqual({ effort: undefined, fellBack: false });
  });

  it('passes through folded values for runtimes without a vocabulary (acp)', () => {
    expect(normalizeRuntimeEffort('acp', 'custom-effort')).toEqual({ effort: 'custom-effort', fellBack: false });
    expect(normalizeRuntimeEffort('acp', ' Custom ')).toEqual({ effort: 'custom', fellBack: false, requested: ' Custom ' });
    expect(normalizeRuntimeEffort(undefined, 'anything')).toEqual({ effort: 'anything', fellBack: false });
  });

  it('keeps the mindos vocabulary identical to the Pi thinking levels', async () => {
    const { MINDOS_THINKING_LEVELS } = await import('../mindos-pi/thinking.js');
    expect(MINDOS_THINKING_EFFORTS).toBe(MINDOS_THINKING_LEVELS);
  });
});
