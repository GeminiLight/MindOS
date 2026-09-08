import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleFileGet, handleFilePost } from './file.js';

const revision = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mindos-file-revision-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function read() {
  return handleFileGet(new URLSearchParams({ path: '笔记 📝.md' }), {
    mindRoot: root,
    readTextFile: (path) => readFileSync(join(root, path), 'utf8'),
    readLines: () => [], listSpaces: () => [], listDirectories: () => [],
  });
}

function save(content: string, expectedRevision?: unknown) {
  return handleFilePost({ op: 'save_file', path: '笔记 📝.md', content, expectedRevision }, { mindRoot: root });
}

describe('content-versioned file writes', () => {
  it.each(['', '中文 📝\r\nnext\n'])('returns the revision of exactly the text read: %j', (content) => {
    writeFileSync(join(root, '笔记 📝.md'), content);
    expect(read().body).toMatchObject({ content, revision: revision(content) });
  });

  it('saves a matching revision and returns the next revision and audit change', async () => {
    writeFileSync(join(root, '笔记 📝.md'), 'before');
    const result = await save('after', revision('before'));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, revision: revision('after') });
    expect(result.changeEvent).toMatchObject({ before: 'before', after: 'after' });
    expect(readFileSync(join(root, '笔记 📝.md'), 'utf8')).toBe('after');
  });

  it('rejects external changes even if their modification time is unchanged', async () => {
    const path = join(root, '笔记 📝.md');
    writeFileSync(path, 'before');
    const stat = statSync(path);
    writeFileSync(path, 'external');
    utimesSync(path, stat.atime, stat.mtime);
    const result = await save('plugin draft', revision('before'));
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: 'conflict', serverRevision: revision('external') });
    expect(result.changeEvent).toBeFalsy();
    expect(readFileSync(path, 'utf8')).toBe('external');
  });

  it('does not recreate an externally deleted document, including an empty one', async () => {
    writeFileSync(join(root, '笔记 📝.md'), '');
    unlinkSync(join(root, '笔记 📝.md'));
    const result = await save('draft', revision(''));
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: 'conflict', serverRevision: null });
    expect(result.changeEvent).toBeFalsy();
  });

  it('allows only one of two different drafts based on the same revision', async () => {
    writeFileSync(join(root, '笔记 📝.md'), 'before');
    const results = await Promise.all([save('first', revision('before')), save('second', revision('before'))]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.filter((result) => result.changeEvent)).toHaveLength(1);
  });

  it.each([null, '', 'not-a-revision', 0, {}, 'a'.repeat(65)])('rejects an invalid revision without writing: %j', async (invalid) => {
    writeFileSync(join(root, '笔记 📝.md'), 'before');
    const result = await save('after', invalid);
    expect(result.status).toBe(400);
    expect(readFileSync(join(root, '笔记 📝.md'), 'utf8')).toBe('before');
  });

  it('keeps unversioned create/save callers compatible', async () => {
    expect((await save('new')).status).toBe(200);
    expect((await save('updated')).status).toBe(200);
  });

  it('binds a snapshot to its knowledge root, even when another root has identical content', async () => {
    writeFileSync(join(root, '笔记 📝.md'), 'before');
    const snapshot = read().body as { revision: string; vaultId: string };
    expect(snapshot.vaultId).toMatch(/^[a-f0-9]{64}$/);
    const otherRoot = mkdtempSync(join(root, 'other-'));
    writeFileSync(join(otherRoot, '笔记 📝.md'), 'before');
    const result = await handleFilePost({
      op: 'save_file', path: '笔记 📝.md', content: 'draft',
      expectedRevision: snapshot.revision, expectedVaultId: snapshot.vaultId,
    }, { mindRoot: otherRoot });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: 'vault_changed' });
    expect(readFileSync(join(otherRoot, '笔记 📝.md'), 'utf8')).toBe('before');
  });

  it('rejects an invalid vault binding instead of treating it as unbound', async () => {
    const result = await handleFilePost({
      op: 'save_file', path: '笔记 📝.md', content: 'draft', expectedVaultId: null,
    }, { mindRoot: root });
    expect(result.status).toBe(400);
  });

  it('does not overwrite a directory substituted for an approved file', async () => {
    writeFileSync(join(root, '笔记 📝.md'), 'before');
    const directory = mkdtempSync(join(root, 'directory-'));
    unlinkSync(join(root, '笔记 📝.md'));
    renameSync(directory, join(root, '笔记 📝.md'));
    const result = await save('draft', revision('before'));
    expect(result.status).not.toBe(200);
    expect(statSync(join(root, '笔记 📝.md')).isDirectory()).toBe(true);
  });

  it('does not collapse different malformed UTF-8 byte sequences into the same revision', async () => {
    writeFileSync(join(root, '笔记 📝.md'), Buffer.from([0xff]));
    const snapshot = read().body as { revision: string };
    writeFileSync(join(root, '笔记 📝.md'), Buffer.from([0xfe]));
    const result = await save('draft', snapshot.revision);
    expect(result.status).not.toBe(200);
    expect(readFileSync(join(root, '笔记 📝.md'))).toEqual(Buffer.from([0xfe]));
  });
});
