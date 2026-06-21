import { describe, expect, it } from 'vitest';

import {
  buildInboxOrganizerRunPrompt,
  INBOX_ORGANIZER_ASSISTANT_ID,
  INBOX_ORGANIZER_ASSISTANT_NAME,
  INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
  loadInboxOrganizerPrompt,
  normalizeInboxOrganizerFilePath,
} from '@/lib/inbox-assistant';

describe('Inbox Organizer assistant', () => {
  it('builds a stable built-in assistant contract for Inbox review runs', () => {
    const prompt = buildInboxOrganizerRunPrompt(['source.md', 'Inbox/decision.md']);

    expect(INBOX_ORGANIZER_ASSISTANT_ID).toBe('inbox-organizer');
    expect(INBOX_ORGANIZER_ASSISTANT_NAME).toBe('Inbox Organizer');
    expect(INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH).toBe('.mindos/assistants/inbox-organizer.md');
    expect(prompt).toContain('# Current Inbox Review Run');
    expect(prompt).not.toContain('assistantId: inbox-organizer');
    expect(prompt).not.toContain('# Inbox Organizer');
    expect(prompt).not.toContain('version: 1');
    expect(prompt).toContain('Do not delete, rename, or overwrite Inbox source files directly');
    expect(prompt).toContain('Inbox/source.md');
    expect(prompt).toContain('Inbox/decision.md');
  });

  it('normalizes selected Inbox names without double-prefixing paths', () => {
    expect(normalizeInboxOrganizerFilePath('source.md')).toBe('Inbox/source.md');
    expect(normalizeInboxOrganizerFilePath('Inbox/source.md')).toBe('Inbox/source.md');
    expect(normalizeInboxOrganizerFilePath('/Inbox/source.md')).toBe('Inbox/source.md');
    expect(normalizeInboxOrganizerFilePath('')).toBe('Inbox/(unnamed)');
  });

  it('falls back to the default prompt when the editable local prompt is unavailable', async () => {
    const prompt = await loadInboxOrganizerPrompt(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'missing' }),
    } as Response));

    expect(prompt).toContain('version: 1');
    expect(prompt).toContain('mode: subagent');
    expect(prompt).not.toContain('assistantId: inbox-organizer');
    expect(prompt).toContain('# Inbox Organizer');
  });
});
