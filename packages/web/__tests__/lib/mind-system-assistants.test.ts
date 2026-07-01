import { describe, expect, it } from 'vitest';
import {
  MINDOS_CONTEXT_ASSISTANT_IDS,
  getBuiltinAssistantMarkdownFiles,
  getAssistantMarkdownPath,
  getAssistantProfilePath,
  getAssistantPromptPath,
  getDefaultAssistantPrompt,
  getLegacyAssistantProfilePath,
  getLegacyAssistantPromptPath,
  getMindosContextAssistants,
} from '@/lib/mind-system-assistants';

describe('mind-system assistants', () => {
  it('keeps MindOS context assistants as global prompt templates, not Space-owned assistants', () => {
    const assistants = getMindosContextAssistants();

    expect(MINDOS_CONTEXT_ASSISTANT_IDS).toEqual([]);
    expect(assistants).toEqual([]);
  });

  it('uses single-file assistant Markdown paths and keeps explicit legacy helpers', () => {
    expect(getAssistantMarkdownPath('inbox-organizer')).toBe('.mindos/assistants/inbox-organizer.md');
    expect(getAssistantPromptPath('inbox-organizer')).toBe('.mindos/assistants/inbox-organizer.md');
    expect(getAssistantProfilePath('inbox-organizer')).toBe('.mindos/assistants/inbox-organizer.md');
    expect(getLegacyAssistantPromptPath('inbox-organizer')).toBe('.mindos/assistants/inbox-organizer/prompt.md');
    expect(getLegacyAssistantProfilePath('inbox-organizer')).toBe('.mindos/assistants/inbox-organizer/profile.json');
    expect(() => getAssistantPromptPath('../daily-signal')).toThrow(/Unsafe assistant id/);
    expect(() => getAssistantProfilePath('../daily-signal')).toThrow(/Unsafe assistant id/);
    expect(() => getAssistantPromptPath('Daily Signal')).toThrow(/Unsafe assistant id/);
  });

  it('returns built-in prompts for known assistants and a safe fallback for custom ids', () => {
    expect(getDefaultAssistantPrompt('inbox-organizer')).toContain('version: 1');
    expect(getDefaultAssistantPrompt('inbox-organizer')).toContain('mode: subagent');
    expect(getDefaultAssistantPrompt('inbox-organizer')).toContain('# Inbox Organizer');
    expect(getDefaultAssistantPrompt('inbox-organizer')).not.toContain('assistantId:');
    expect(getDefaultAssistantPrompt('echo-imprint')).toContain('permissionMode: read');
    expect(getDefaultAssistantPrompt('echo-imprint')).toContain('# Echo Imprint');
    expect(getDefaultAssistantPrompt('echo-promotion')).toContain('# Echo Promotion');
    expect(() => getDefaultAssistantPrompt('echo-practice')).toThrow(/has been removed/);
    expect(getDefaultAssistantPrompt('custom-helper')).toContain('version: 1');
    expect(getDefaultAssistantPrompt('custom-helper')).toContain('# Custom Helper');
  });

  it('includes Echo assistants in built-in assistant Markdown scaffolds', () => {
    expect(getBuiltinAssistantMarkdownFiles().map((item) => item.assistantId)).toEqual([
      'inbox-organizer',
      'dreaming',
      'echo-imprint',
      'echo-threader',
      'echo-insight',
      'echo-promotion',
    ]);
    expect(getBuiltinAssistantMarkdownFiles().map((item) => item.assistantId)).not.toContain('echo-practice');
  });
});
