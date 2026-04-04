import { describe, it, expect, beforeEach, vi } from 'vitest';
import { seedFile } from '../setup';
import { knowledgeBaseTools, truncate } from '@/lib/agent/tools';

// knowledgeBaseTools is an array of AgentTool objects.
// Each tool: { name, execute: (toolCallId, params, signal?) => AgentToolResult }
// AgentToolResult: { content: [{ type: 'text', text }], details }

/** Find a tool by name from the array */
function getTool(name: string) {
  const tool = knowledgeBaseTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found. Available: ${knowledgeBaseTools.map(t => t.name).join(', ')}`);
  return tool;
}

/** Call a tool and extract the text result */
async function callTool(name: string, params: Record<string, unknown>): Promise<string> {
  const tool = getTool(name);
  const result = await tool.execute!('test-call-id', params);
  // AgentToolResult has content: [{ type: 'text', text }]
  const textPart = result.content?.find((c: any) => c.type === 'text');
  return textPart?.text ?? JSON.stringify(result);
}

// ---------------------------------------------------------------------------
// truncate (exported utility)
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns short content unchanged', () => {
    expect(truncate('hello')).toBe('hello');
  });

  it('returns content at exact limit unchanged', () => {
    const content = 'a'.repeat(20_000);
    expect(truncate(content)).toBe(content);
  });

  it('truncates content exceeding limit', () => {
    const content = 'a'.repeat(25_000);
    const result = truncate(content);
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain('[...truncated');
  });
});

// ---------------------------------------------------------------------------
// list_files tool
// ---------------------------------------------------------------------------

describe('tools: list_files', () => {
  beforeEach(() => {
    seedFile('README.md', '# Root README');
    seedFile('Profile/Identity.md', '# Identity');
    seedFile('Profile/Goals.md', '# Goals');
    seedFile('Projects/Products/ProductA.md', '# Product A');
    seedFile('data.csv', 'a,b,c');
  });

  it('lists all files with default params (excluding system files)', async () => {
    const result = await callTool('list_files', {});
    expect(result).toContain('Profile/');
    expect(result).toContain('Identity.md');
    expect(result).toContain('Goals.md');
    expect(result).not.toContain('README.md'); // System file hidden from Agent
    expect(result).toContain('data.csv');
    expect(result).not.toContain('Error:');
  });

  it('lists a specific subdirectory', async () => {
    const result = await callTool('list_files', { path: 'Profile' });
    expect(result).toContain('Identity.md');
    expect(result).toContain('Goals.md');
    expect(result).not.toContain('README.md');
    expect(result).not.toContain('data.csv');
  });

  it('respects depth parameter (hides system files)', async () => {
    const result = await callTool('list_files', { depth: 1 });
    expect(result).toContain('Profile/');
    expect(result).toContain('...');
    expect(result).not.toContain('README.md'); // System file hidden
  });

  it('returns error message for non-existent directory', async () => {
    const result = await callTool('list_files', { path: 'NonExistent' });
    expect(result).toContain('Directory not found');
    expect(result).toContain('NonExistent');
  });

  it('handles nested subdirectory path', async () => {
    const result = await callTool('list_files', { path: 'Projects/Products' });
    expect(result).toContain('ProductA.md');
    expect(result).not.toContain('README.md');
  });

  it('returns (empty directory) for dir with no allowed files', async () => {
    seedFile('EmptyDir/test.txt', 'not allowed');
    const result = await callTool('list_files', {});
    expect(result).not.toContain('EmptyDir');
  });
});

// ---------------------------------------------------------------------------
// read_file tool
// ---------------------------------------------------------------------------

describe('tools: read_file', () => {
  beforeEach(() => {
    seedFile('test.md', '# Test file\n\nSome content here.');
  });

  it('reads an existing file', async () => {
    const result = await callTool('read_file', { path: 'test.md' });
    expect(result).toContain('# Test file');
    expect(result).toContain('Some content here.');
  });

  it('returns error for non-existent file', async () => {
    const result = await callTool('read_file', { path: 'does-not-exist.md' });
    expect(result).toContain('Error:');
  });
});

// ---------------------------------------------------------------------------
// search tool
// ---------------------------------------------------------------------------

describe('tools: search', () => {
  beforeEach(() => {
    seedFile('notes/alpha.md', '# Alpha\n\nUnique keyword xyzzyplugh here.');
    seedFile('notes/beta.md', '# Beta\n\nSomething else entirely.');
  });

  it('returns no results for unmatched query', async () => {
    const result = await callTool('search', { query: 'definitelynotfound99' });
    expect(result).toBe('No results found.');
  });
});

// ---------------------------------------------------------------------------
// write_file tool
// ---------------------------------------------------------------------------

describe('tools: write_file', () => {
  beforeEach(() => {
    seedFile('existing.md', '# Old content');
  });

  it('overwrites file content', async () => {
    const result = await callTool('write_file', { path: 'existing.md', content: '# New content' });
    expect(result).toContain('File written');

    const read = await callTool('read_file', { path: 'existing.md' });
    expect(read).toContain('# New content');
    expect(read).not.toContain('# Old content');
  });
});

// ---------------------------------------------------------------------------
// create_file tool
// ---------------------------------------------------------------------------

describe('tools: create_file', () => {
  it('creates a new file', async () => {
    const result = await callTool('create_file', { path: 'new-note.md', content: '# Hello World' });
    expect(result).toContain('File created');

    const read = await callTool('read_file', { path: 'new-note.md' });
    expect(read).toContain('# Hello World');
  });

  it('creates parent directories automatically', async () => {
    const result = await callTool('create_file', { path: 'deep/nested/dir/file.md', content: 'nested content' });
    expect(result).toContain('File created');
  });
});

// ---------------------------------------------------------------------------
// delete_file tool
// ---------------------------------------------------------------------------

describe('tools: delete_file', () => {
  beforeEach(() => {
    seedFile('to-delete.md', '# Delete me');
  });

  it('deletes an existing file', async () => {
    const result = await callTool('delete_file', { path: 'to-delete.md' });
    expect(result).toContain('File deleted');

    const read = await callTool('read_file', { path: 'to-delete.md' });
    expect(read).toContain('Error:');
  });
});

// ---------------------------------------------------------------------------
// append_to_file tool
// ---------------------------------------------------------------------------

describe('tools: append_to_file', () => {
  beforeEach(() => {
    seedFile('append-target.md', '# Start');
  });

  it('appends content to file', async () => {
    const result = await callTool('append_to_file', { path: 'append-target.md', content: '\n## Added Section' });
    expect(result).toContain('Content appended');

    const read = await callTool('read_file', { path: 'append-target.md' });
    expect(read).toContain('# Start');
    expect(read).toContain('## Added Section');
  });
});

// ---------------------------------------------------------------------------
// rename_file tool
// ---------------------------------------------------------------------------

describe('tools: rename_file', () => {
  beforeEach(() => {
    seedFile('old-name.md', '# Rename me');
  });

  it('renames a file', async () => {
    const result = await callTool('rename_file', { path: 'old-name.md', new_name: 'new-name.md' });
    expect(result).toContain('renamed');
    expect(result).toContain('new-name.md');

    // Old path should be gone
    const oldRead = await callTool('read_file', { path: 'old-name.md' });
    expect(oldRead).toContain('Error:');

    // New path should work
    const newRead = await callTool('read_file', { path: 'new-name.md' });
    expect(newRead).toContain('# Rename me');
  });
});

// ---------------------------------------------------------------------------
// get_recent tool
// ---------------------------------------------------------------------------

describe('tools: get_recent', () => {
  beforeEach(() => {
    seedFile('a.md', '# A');
    seedFile('b.md', '# B');
  });

  it('returns recently modified files', async () => {
    const result = await callTool('get_recent', {});
    expect(result).toContain('a.md');
    expect(result).toContain('b.md');
  });

  it('respects limit parameter', async () => {
    const result = await callTool('get_recent', { limit: 1 });
    // Should only contain one file entry (one line starting with "- ")
    const lines = result.split('\n').filter(l => l.startsWith('- '));
    expect(lines).toHaveLength(1);
  });
});

describe('web_fetch tool', () => {
  it('returns formatted text from a URL', async () => {
    // Mock the global fetch
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html><head><title>Test Page</title></head><body><h1>Hello</h1><p>This is a <b>test</b>.</p></body></html>',
    } as any);

    try {
      const result = await callTool('web_fetch', { url: 'https://example.com' });
      expect(result).toContain('# Test Page');
      expect(result).toContain('Source: https://example.com');
      expect(result).toContain('# Hello');
      expect(result).toContain('This is a test');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handles raw text files properly', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'Just plain text.\nWith newlines.',
    } as any);

    try {
      const result = await callTool('web_fetch', { url: 'https://example.com/raw.txt' });
      expect(result).toBe('Just plain text.\nWith newlines.');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('web_search tool', () => {
  it('returns formatted search results', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><div class="result__body"><h2 class="result__title"><a href="https://example.com/1">Title 1</a></h2><a class="result__snippet">Snippet 1</a></div><div class="result__body"><h2 class="result__title"><a href="https://example.com/2">Title 2</a></h2><div class="result__snippet">Snippet 2</div></div></body></html>',
    } as any);

    try {
      const result = await callTool('web_search', { query: 'test query' });
      expect(result).toContain('Title 1');
      expect(result).toContain('https://example.com/1');
      expect(result).toContain('Snippet 1');
      expect(result).toContain('Title 2');
      expect(result).toContain('Snippet 2');
      expect(result).toContain('Web Search Results for: "test query"');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handles empty results', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><div>No results body structure</div></body></html>',
    } as any);

    try {
      const result = await callTool('web_search', { query: 'test query' });
      expect(result).toContain('No web search results found for');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
