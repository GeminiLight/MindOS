import { describe, it, expect } from 'vitest';
import { getChatTools, getOrganizeTools, knowledgeBaseTools, WRITE_TOOLS } from '@/lib/agent/tools';
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

  it('returns the approved read-only tools including skill loading', () => {
    // web_search and web_fetch are now provided by pi-web-access extension
    const expected = [
      'list_files', 'read_file', 'read_file_chunk',
      'search', 'load_skill', 'get_recent', 'get_backlinks',
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

  it('excludes delegation and destructive file tools', () => {
    expect(chatToolNames).not.toContain('list_acp_agents');
    expect(chatToolNames).not.toContain('call_acp_agent');
    expect(chatToolNames).not.toContain('delegate_to_agent');
    expect(chatToolNames).not.toContain('orchestrate');
    expect(chatToolNames).not.toContain('delete_file');
    expect(chatToolNames).not.toContain('rename_file');
    expect(chatToolNames).not.toContain('move_file');
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

describe('getOrganizeTools', () => {
  it('keeps skill loading available for selected skill workflows', () => {
    expect(getOrganizeTools().map(t => t.name)).toContain('load_skill');
  });

  it('allows only bounded KB organization writes', () => {
    const organizeToolNames = getOrganizeTools().map(t => t.name);

    expect(organizeToolNames).toEqual(expect.arrayContaining([
      'list_files',
      'read_file',
      'search',
      'load_skill',
      'create_file',
      'batch_create_files',
      'write_file',
      'append_to_file',
      'insert_after_heading',
      'update_section',
    ]));
    expect(organizeToolNames).not.toContain('delete_file');
    expect(organizeToolNames).not.toContain('rename_file');
    expect(organizeToolNames).not.toContain('move_file');
    expect(organizeToolNames).not.toContain('edit_lines');
    expect(organizeToolNames).not.toContain('list_acp_agents');
    expect(organizeToolNames).not.toContain('call_acp_agent');
    expect(organizeToolNames).not.toContain('delegate_to_agent');
    expect(organizeToolNames).not.toContain('orchestrate');
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
