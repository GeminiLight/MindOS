import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { handleInboxPost, handleInboxDelete } from './inbox.js';
import { handleConnectGet } from './connect.js';

describe('capture destination identity', () => {
  it('does not archive same-name files after the library changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-identity-'));
    try {
      handleInboxPost({ files: [{ name: 'note.md', content: 'keep me' }] }, { mindRoot: root });
      expect(handleInboxDelete({ names: ['note.md'], expectedRootId: 'old-vault' }, { mindRoot: root }).status).toBe(409);
      expect(existsSync(join(root, 'Inbox', 'note.md'))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects a stale vault before creating inbox files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-identity-'));
    try {
      const response = handleInboxPost({ expectedRootId: 'previous-vault', files: [{ name: 'private.md', content: 'private idea' }] }, { mindRoot: root });
      expect(response.status).toBe(409); expect(existsSync(join(root, 'Inbox'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('accepts the identity returned by connect and keeps legacy clients compatible', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-identity-'));
    try {
      const expectedRootId = handleConnectGet({ mindRoot: root }).body.rootId;
      for (const extra of [{ expectedRootId }, {}]) {
        expect(handleInboxPost({ ...extra, files: [{ name: 'note.md', content: 'idea' }] }, { mindRoot: root }).status).toBe(200);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects malformed identity instead of silently dropping the guard', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-identity-'));
    try {
      for (const expectedRootId of ['', null, 123, []]) {
        expect(handleInboxPost({ expectedRootId, files: [{ name: 'note.md', content: 'idea' }] }, { mindRoot: root }).status).toBe(409);
      }
      expect(existsSync(join(root, 'Inbox'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
