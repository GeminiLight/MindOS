import { describe, it, expect, beforeEach, vi } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { knowledgeBaseTools } from '@/lib/agent/tools';

// The tools use logged() wrapper + @/lib/fs which reads from effectiveSopRoot().
// The setup.ts mock provides a temp mindRoot for each test.

// Also mock the agent log so it doesn't pollute test output
vi.mock('@/lib/agent/log', () => ({
  logAgentOp: vi.fn(),
}));

// Helper: call a tool's execute function with standard test context
const ctx = { toolCallId: 'test', messages: [] as any, abortSignal: undefined as any };

// ---------------------------------------------------------------------------
// list_files tool
// ---------------------------------------------------------------------------

describe('tools: list_files', () => {
  beforeEach(() => {
    // Seed a basic knowledge base structure
    seedFile('README.md', '# Root README');
    seedFile('Profile/Identity.md', '# Identity');
    seedFile('Profile/Goals.md', '# Goals');
    seedFile('Projects/Products/ProductA.md', '# Product A');
    seedFile('data.csv', 'a,b,c');
  });

  it('lists all files with default params', async () => {
    const result = await knowledgeBaseTools.list_files.execute!(
      { path: undefined, depth: undefined }, ctx,
    );
    expect(result).toContain('Profile/');
    expect(result).toContain('Identity.md');
    expect(result).toContain('Goals.md');
    expect(result).toContain('README.md');
    expect(result).toContain('data.csv');
    expect(result).not.toContain('Error:');
  });

  it('lists a specific subdirectory', async () => {
    const result = await knowledgeBaseTools.list_files.execute!(
      { path: 'Profile', depth: undefined }, ctx,
    );
    expect(result).toContain('Identity.md');
    expect(result).toContain('Goals.md');
    // Should NOT contain root-level files
    expect(result).not.toContain('README.md');
    expect(result).not.toContain('data.csv');
  });

  it('respects depth parameter', async () => {
    const result = await knowledgeBaseTools.list_files.execute!(
      { path: undefined, depth: 1 }, ctx,
    );
    // At depth 1, subdirectories should show "... (N items)" instead of expanding
    expect(result).toContain('Profile/');
    expect(result).toContain('...');
    // Root-level files should be visible
    expect(result).toContain('README.md');
  });

  it('returns error message for non-existent directory', async () => {
    const result = await knowledgeBaseTools.list_files.execute!(
      { path: 'NonExistent', depth: undefined }, ctx,
    );
    expect(result).toContain('Directory not found');
    expect(result).toContain('NonExistent');
  });

  it('handles nested subdirectory path', async () => {
    const result = await knowledgeBaseTools.list_files.execute!(
      { path: 'Projects/Products', depth: undefined }, ctx,
    );
    expect(result).toContain('ProductA.md');
    expect(result).not.toContain('README.md');
  });

  it('returns (empty directory) for dir with no allowed files', async () => {
    // The directory needs to exist but with no .md/.csv files
    seedFile('EmptyDir/test.txt', 'not allowed');  // .txt excluded from tree
    const result = await knowledgeBaseTools.list_files.execute!(
      { path: undefined, depth: undefined }, ctx,
    );
    // EmptyDir should not appear at all (omitted as empty by tree)
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
    const result = await knowledgeBaseTools.read_file.execute!(
      { path: 'test.md' }, ctx,
    );
    expect(result).toContain('# Test file');
    expect(result).toContain('Some content here.');
  });

  it('returns error for non-existent file', async () => {
    const result = await knowledgeBaseTools.read_file.execute!(
      { path: 'does-not-exist.md' }, ctx,
    );
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
    const result = await knowledgeBaseTools.search.execute!(
      { query: 'definitelynotfound99' }, ctx,
    );
    expect(result).toBe('No results found.');
  });

  // NOTE: Fuzzy search (Fuse.js) with cached indexes makes exact-match testing
  // fragile in unit tests. Full search coverage is in __tests__/core/search.test.ts
  // and __tests__/api/search.test.ts which use the core search directly.
});

// ---------------------------------------------------------------------------
// write_file tool
// ---------------------------------------------------------------------------

describe('tools: write_file', () => {
  beforeEach(() => {
    seedFile('existing.md', '# Old content');
  });

  it('overwrites file content', async () => {
    const result = await knowledgeBaseTools.write_file.execute!(
      { path: 'existing.md', content: '# New content' }, ctx,
    );
    expect(result).toContain('File written');

    // Verify content changed
    const read = await knowledgeBaseTools.read_file.execute!(
      { path: 'existing.md' }, ctx,
    );
    expect(read).toContain('# New content');
    expect(read).not.toContain('# Old content');
  });
});

// ---------------------------------------------------------------------------
// create_file tool
// ---------------------------------------------------------------------------

describe('tools: create_file', () => {
  it('creates a new file', async () => {
    const result = await knowledgeBaseTools.create_file.execute!(
      { path: 'new-note.md', content: '# Hello World' }, ctx,
    );
    expect(result).toContain('File created');

    const read = await knowledgeBaseTools.read_file.execute!(
      { path: 'new-note.md' }, ctx,
    );
    expect(read).toContain('# Hello World');
  });

  it('creates parent directories automatically', async () => {
    const result = await knowledgeBaseTools.create_file.execute!(
      { path: 'deep/nested/dir/file.md', content: 'nested content' }, ctx,
    );
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
    const result = await knowledgeBaseTools.delete_file.execute!(
      { path: 'to-delete.md' }, ctx,
    );
    expect(result).toContain('File deleted');

    // Verify file no longer readable
    const read = await knowledgeBaseTools.read_file.execute!(
      { path: 'to-delete.md' }, ctx,
    );
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
    const result = await knowledgeBaseTools.append_to_file.execute!(
      { path: 'append-target.md', content: '\n## Added Section' }, ctx,
    );
    expect(result).toContain('Content appended');

    const read = await knowledgeBaseTools.read_file.execute!(
      { path: 'append-target.md' }, ctx,
    );
    expect(read).toContain('# Start');
    expect(read).toContain('## Added Section');
  });
});
