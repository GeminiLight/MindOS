import { describe, expect, it, vi } from 'vitest';
import {
  buildAssistantAgentTurnRequestBody,
  buildAssistantRunPrompt,
  loadAssistantMarkdownPrompt,
} from '@/lib/assistant-runner';
import {
  assistantPermissionLevelToPolicyMode,
  getAssistantPermissionLevel,
  getAssistantPermissionMode,
  isRegisteredAssistantRun,
  resolveAssistantPermissionMode,
} from '@/lib/assistant-runtime-registry';

describe('assistant runner utilities', () => {
  it('builds a stable agent turn body for assistant-backed runs', () => {
    const body = buildAssistantAgentTurnRequestBody({
      assistantId: 'inbox-organizer',
      messages: [{ role: 'user', content: 'Organize this' }],
      agentMode: 'default',
      permissionMode: 'ask',
      uploadedFiles: [{ name: 'capture.md', content: 'source' }],
      maxSteps: 15,
      providerOverride: 'p_stepfun',
      modelOverride: 'step-2',
    });

    expect(body).toEqual({
      assistantId: 'inbox-organizer',
      messages: [{ role: 'user', content: 'Organize this' }],
      agentMode: 'default',
      permissionMode: 'ask',
      uploadedFiles: [{ name: 'capture.md', content: 'source' }],
      maxSteps: 15,
      providerOverride: 'p_stepfun',
      modelOverride: 'step-2',
    });
  });

  it('loads assistant markdown from the shared assistant path and falls back safely', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('/api/file?path=.mindos%2Fassistants%2Finbox-organizer.md&op=read_file');
      return {
        ok: true,
        json: async () => ({ content: '# Custom Inbox Organizer' }),
      };
    }) as unknown as typeof fetch;

    await expect(loadAssistantMarkdownPrompt({
      assistantId: 'inbox-organizer',
      fallbackPrompt: '# Fallback',
      fetcher,
    })).resolves.toBe('# Custom Inbox Organizer');

    const failingFetcher = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(loadAssistantMarkdownPrompt({
      assistantId: 'inbox-organizer',
      fallbackPrompt: '# Fallback',
      fetcher: failingFetcher,
    })).resolves.toBe('# Fallback');
  });

  it('uses the assistant runtime registry only for assistant run permissions', () => {
    expect(resolveAssistantPermissionMode('inbox-organizer', 'read')).toBe('ask');
    expect(resolveAssistantPermissionMode('unknown-assistant', 'read')).toBe('read');
    expect(resolveAssistantPermissionMode('dreaming', 'read')).toBe('ask');
    expect(resolveAssistantPermissionMode('echo-imprint', 'ask')).toBe('read');
    expect(isRegisteredAssistantRun('inbox-organizer')).toBe(true);
    expect(isRegisteredAssistantRun('dreaming')).toBe(true);
    expect(isRegisteredAssistantRun('echo-insight')).toBe(true);
    expect(isRegisteredAssistantRun('unknown-assistant')).toBe(false);
    expect(assistantPermissionLevelToPolicyMode('read-only')).toBe('read');
    expect(assistantPermissionLevelToPolicyMode('trusted-write')).toBe('ask');
    expect(getAssistantPermissionLevel('dreaming')).toBe('trusted-write');
    expect(getAssistantPermissionMode('dreaming')).toBe('ask');
    expect(getAssistantPermissionLevel('echo-promotion')).toBe('read-only');
    expect(getAssistantPermissionMode('echo-promotion')).toBe('read');
    expect(getAssistantPermissionLevel('echo-practice')).toBeUndefined();
    expect(getAssistantPermissionMode('echo-practice')).toBeUndefined();
    expect(isRegisteredAssistantRun('echo-practice')).toBe(false);
    expect(getAssistantPermissionLevel('unknown-assistant')).toBeUndefined();
  });

  it('composes assistant instructions with per-run context without inventing a new mode', () => {
    const prompt = buildAssistantRunPrompt({
      assistantPrompt: '# Assistant\n\n## Role\n\nReview inputs.',
      runTitle: 'Current Inbox Review Run',
      intro: 'Use the active Assistant instructions.',
      itemsLabel: 'Files in this review run',
      items: ['Inbox/a.md', 'Inbox/b.md'],
      rules: ['Treat attachments as source of truth.'],
    });

    expect(prompt).toContain('# Assistant');
    expect(prompt).toContain('# Current Inbox Review Run');
    expect(prompt).toContain('- Inbox/a.md');
    expect(prompt).toContain('- Treat attachments as source of truth.');
    expect(prompt).not.toContain('mode: organize');
  });
});
