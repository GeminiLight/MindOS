import { describe, it, expect } from 'vitest';
import { MINDOS_SYSTEM_PROMPT } from '@/lib/agent/prompt';

describe('agent prompt self-introduction rules', () => {
  it('uses one MindOS identity prompt without slogan wording', () => {
    expect(MINDOS_SYSTEM_PROMPT).toContain('You are MindOS, the user\'s local knowledge assistant.');
    expect(MINDOS_SYSTEM_PROMPT).not.toContain('this appears to be their first message in a new conversation');
    expect(MINDOS_SYSTEM_PROMPT).not.toContain('operator of the user\'s second brain');
    expect(MINDOS_SYSTEM_PROMPT).not.toContain('You are MindOS Agent');
    expect(MINDOS_SYSTEM_PROMPT).toContain('If the user\'s message already contains a concrete task');
    expect(MINDOS_SYSTEM_PROMPT).toContain('skip the self-introduction and do the task directly');
  });
});
