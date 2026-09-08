import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/file/route';
import { listContentChanges } from '@/lib/fs';
import { seedFile, testMindRoot } from '../setup';

async function snapshot(path = 'Notes/table.md') {
  const result = await GET(new NextRequest(`http://localhost/api/file?path=${encodeURIComponent(path)}`));
  expect(result.status).toBe(200);
  return result.json() as Promise<{ content: string; revision: string; vaultId: string }>;
}

function save(content: string, revision: string, vaultId: string, path = 'Notes/table.md') {
  return POST(new NextRequest('http://localhost/api/file', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mindos-agent': 'obsidian:table-editor-obsidian' },
    body: JSON.stringify({ op: 'save_file', path, content, expectedRevision: revision, expectedVaultId: vaultId }),
  }));
}

describe('versioned plugin saves through the product file route', () => {
  it('returns a fresh revision and retains structured audit attribution on success', async () => {
    seedFile('Notes/table.md', '| A | B |\n| -- | -- |\n| 1 | 2 |\n');
    const original = await snapshot();
    const content = '| A | B |\n| -- | -- |\n| 1 | 3 |\n';
    const result = await save(content, original.revision, original.vaultId);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(body.revision).not.toBe(original.revision);
    expect((await snapshot()).content).toBe(content);
    expect(listContentChanges({ path: 'Notes/table.md' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'agent', agentName: 'obsidian:table-editor-obsidian', before: original.content, after: content }),
    ]));
  });

  it('does not append a successful change event or overwrite an external edit on conflict', async () => {
    seedFile('Notes/table.md', 'original');
    const original = await snapshot();
    const path = join(testMindRoot, 'Notes/table.md');
    const stat = statSync(path);
    writeFileSync(path, 'external edit');
    utimesSync(path, stat.atime, stat.mtime);
    const changes = listContentChanges({ path: 'Notes/table.md' });
    const result = await save('plugin edit', original.revision, original.vaultId);
    expect(result.status).toBe(409);
    expect((await result.json()).error).toBe('conflict');
    expect(readFileSync(path, 'utf8')).toBe('external edit');
    expect(listContentChanges({ path: 'Notes/table.md' })).toEqual(changes);
  });

  it('does not let a valid snapshot bypass protected-file policy', async () => {
    seedFile('INSTRUCTION.md', 'original instructions');
    const original = await snapshot('INSTRUCTION.md');
    const result = await save('plugin instructions', original.revision, original.vaultId, 'INSTRUCTION.md');
    expect(result.status).toBe(403);
    expect(readFileSync(join(testMindRoot, 'INSTRUCTION.md'), 'utf8')).toBe('original instructions');
  });

  it('does not write when the approved knowledge root no longer matches', async () => {
    seedFile('Notes/table.md', 'original');
    const original = await snapshot();
    const result = await save('plugin edit', original.revision, '0'.repeat(64));
    expect(result.status).toBe(409);
    expect((await result.json()).error).toBe('vault_changed');
    expect(readFileSync(join(testMindRoot, 'Notes/table.md'), 'utf8')).toBe('original');
  });
});
