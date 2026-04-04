import { describe, it, expect } from 'vitest';
import { getChatTools, knowledgeBaseTools, WRITE_TOOLS } from '@/lib/agent/tools';
import { CHAT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt';

// ---------------------------------------------------------------------------
// getChatTools — tool set correctness
// ---------------------------------------------------------------------------

describe('getChatTools', () => {
  const chatTools = getChatTools();
  const chatToolNames = chatTools.map(t => t.name);

  it('returns a non-empty array of tools', () => {
    expect(chatTools.length).toBeGreaterThan(0);
  });

  it('returns exactly the 8 approved read-only tools', () => {
    const expected = [
      'list_files', 'read_file', 'read_file_chunk',
      'search', 'get_recent', 'get_backlinks',
      'web_search', 'web_fetch',
    ];
    expect(new Set(chatToolNames)).toEqual(new Set(expected));
  });

  it('is a strict subset of knowledgeBaseTools', () => {
    const allNames = new Set(knowledgeBaseTools.map(t => t.name));
    for (const name of chatToolNames) {
      expect(allNames.has(name)).toBe(true);
    }
  });

  it('contains zero write tools', () => {
    for (const name of chatToolNames) {
      expect(WRITE_TOOLS.has(name)).toBe(false);
    }
  });

  it('is significantly smaller than full tool set', () => {
    expect(chatTools.length).toBeLessThan(knowledgeBaseTools.length);
  });

  it('each tool has a valid execute function', () => {
    for (const tool of chatTools) {
      expect(typeof tool.execute).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// CHAT_SYSTEM_PROMPT — content correctness
// ---------------------------------------------------------------------------

describe('CHAT_SYSTEM_PROMPT', () => {
  it('exists and is a non-empty string', () => {
    expect(typeof CHAT_SYSTEM_PROMPT).toBe('string');
    expect(CHAT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('mentions Chat (Read-Only) mode', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Chat');
    expect(CHAT_SYSTEM_PROMPT).toContain('Read-Only');
  });

  it('contains anti-hallucination directive', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Anti-Hallucination');
  });

  it('contains cite-sources directive', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Cite Sources');
  });

  it('instructs to suggest switching to Agent mode for writes', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Agent mode');
  });

  it('is significantly shorter than AGENT_SYSTEM_PROMPT', () => {
    expect(CHAT_SYSTEM_PROMPT.length).toBeLessThan(AGENT_SYSTEM_PROMPT.length);
  });

  it('does not contain write-related directives', () => {
    expect(CHAT_SYSTEM_PROMPT).not.toContain('Read-Before-Write');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('write_file');
    expect(CHAT_SYSTEM_PROMPT).not.toContain('create_file');
  });
});

// ---------------------------------------------------------------------------
// AskMode type — compile-time type check
// ---------------------------------------------------------------------------

describe('AskMode type', () => {
  it('accepts valid mode values', async () => {
    const { AskMode } = await import('@/lib/types') as any;
    const validModes: Array<import('@/lib/types').AskMode> = ['chat', 'agent'];
    expect(validModes).toHaveLength(2);
  });

  it('AskModeApi includes organize', async () => {
    const validModes: Array<import('@/lib/types').AskModeApi> = ['chat', 'agent', 'organize'];
    expect(validModes).toHaveLength(3);
  });
});
