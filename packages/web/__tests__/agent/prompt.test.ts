import { describe, it, expect } from 'vitest';
import { AGENT_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT } from '@/lib/agent/prompt';

describe('agent prompt self-introduction rules', () => {
  it('uses the MindOS identity without slogan wording in agent mode', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('You are MindOS — the user\'s local knowledge assistant.');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('this appears to be their first message in a new conversation');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('operator of the user\'s second brain');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('You are MindOS Agent');
    expect(AGENT_SYSTEM_PROMPT).toContain('If the user\'s message already contains a concrete task');
    expect(AGENT_SYSTEM_PROMPT).toContain('skip the self-introduction and do the task directly');
  });

  it('applies the same concrete-task rule and identity in chat mode', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('You are MindOS — the user\'s local knowledge assistant.');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('operator of the user\'s second brain');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('You are MindOS Agent');
    expect(CHAT_SYSTEM_PROMPT).toContain('If the same message also includes a concrete task');
    expect(CHAT_SYSTEM_PROMPT).toContain('skip the introduction and do the task');
  });
});
