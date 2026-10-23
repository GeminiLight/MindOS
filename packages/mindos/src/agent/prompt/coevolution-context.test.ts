import { describe, expect, it } from 'vitest';
import { buildMindosContextPrompt, compactMindosPromptForTokenBudget } from './context-prompt.js';

describe('co-evolution context for an actual agent turn', () => {
  it('includes the current collaboration contract in both the normal turn and a compacted turn', async () => {
    const prompt = await buildMindosContextPrompt({
      prompt: 'Write the proposal',
      coevolutionContext: 'Participation: together. Adopted standard: quote the evidence before claiming an outcome.',
    });
    expect(prompt).toContain('## Collaboration for this task');
    expect(prompt).toContain('Adopted standard: quote the evidence');
    expect(compactMindosPromptForTokenBudget(prompt, { maxPromptTokens: 1, estimateTokens: (value) => value.length })).toContain('Participation: together');
  });

  it.each([undefined, '', '  '])('omits an absent collaboration contract without changing the task', async (value) => {
    const prompt = await buildMindosContextPrompt({ prompt: 'Keep this task', coevolutionContext: value });
    expect(prompt).toContain('Keep this task');
    expect(prompt).not.toContain('## Collaboration for this task');
  });
});
