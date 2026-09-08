import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createObsidianDocumentSession } from './obsidian-document-session';
import { openObsidianDraftStore } from './obsidian-draft-store';
import * as recovery from './obsidian-recovery-session';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'obsidian-recovery-session-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const scope = { vaultId: 'a'.repeat(64), filePath: 'Notes.md', pluginId: 'tables', fingerprint: 'b'.repeat(64) };
const revision = 'c'.repeat(64);
async function fixture(currentRevision = revision, saveStatus = 200) {
  const requests: string[] = [];
  const document = (await createObsidianDocumentSession({ baseUrl: 'http://localhost:4567', ...scope, token: 'test-token',
    isAuthorized: () => true, approve: async () => true, fetchImpl: async (_url, options) => {
      if (options?.method === 'POST') requests.push(String(options.body));
      return new Response(JSON.stringify(options?.method === 'POST'
        ? { ok: true, revision: 'd'.repeat(64) } : { content: 'disk', revision: currentRevision, vaultId: scope.vaultId }),
      { status: options?.method === 'POST' ? saveStatus : 200 });
    },
  }))!;
  const session = { binding: scope, package: {}, get snapshot() { return document.snapshot; },
    setDraft: (content: string) => document.setDraft(content), save: () => document.save(), close: () => document.close() };
  // Transport is real; only the remote server boundary above is substituted.
  return { session, requests };
}
async function savedDraft(store: Awaited<ReturnType<typeof openObsidianDraftStore>>) {
  const old = store.create(scope); old.update({ content: 'recover me', revision, dirty: true }); await old.flush();
  return (await store.list(scope))[0];
}
it('restores explicitly selected matching drafts without writing the vault and preserves them on close', async () => {
  expect(typeof recovery.createRecoverableObsidianSession).toBe('function');
  const store = await openObsidianDraftStore(join(root, 'drafts')); const old = await savedDraft(store); const f = await fixture();
  const recovered = recovery.createRecoverableObsidianSession(f.session, store, old);
  expect(recovered.session.snapshot).toMatchObject({ content: 'recover me', dirty: true });
  recovered.session.close(); await recovered.flush();
  expect(f.requests).toEqual([]);
  expect(await store.list(scope)).toHaveLength(2);
});
it.each(['revision', 'fingerprint', 'vaultId', 'filePath', 'pluginId'] as const)('refuses a stale or differently scoped %s without changing the draft', async field => {
  const store = await openObsidianDraftStore(join(root, 'drafts')); const old = await savedDraft(store); const f = await fixture();
  const mismatch = { ...old, [field]: field === 'revision' || field === 'fingerprint' || field === 'vaultId' ? 'e'.repeat(64) : 'different' };
  expect(() => recovery.createRecoverableObsidianSession(f.session, store, mismatch)).toThrow(/changed|match/i);
  expect(f.session.snapshot.content).toBe('disk'); expect(f.requests).toEqual([]);
  expect(await store.list(scope)).toHaveLength(1);
});
it('removes only the recovered record and current journal after a confirmed save', async () => {
  const store = await openObsidianDraftStore(join(root, 'drafts')); const old = await savedDraft(store); const f = await fixture();
  const recovered = recovery.createRecoverableObsidianSession(f.session, store, old);
  await recovered.session.save(); await recovered.flush();
  expect(await store.list(scope)).toEqual([]);
  expect(JSON.parse(f.requests[0]).expectedRevision).toBe(revision);
});
it('keeps recovery files after conflicts and records later edits against the last confirmed revision', async () => {
  const store = await openObsidianDraftStore(join(root, 'drafts')); const f = await fixture(revision, 409);
  const recovered = recovery.createRecoverableObsidianSession(f.session, store);
  recovered.session.setDraft('conflicting'); await expect(recovered.session.save()).rejects.toThrow(); await recovered.flush();
  expect((await store.list(scope))[0]).toMatchObject({ content: 'conflicting', revision });
});
it('does not resurrect explicitly discarded recovery files during window cleanup', async () => {
  const store = await openObsidianDraftStore(join(root, 'drafts')); const old = await savedDraft(store); const f = await fixture();
  const recovered = recovery.createRecoverableObsidianSession(f.session, store, old);
  await recovered.discard(); recovered.session.close(); recovered.session.close(); await recovered.flush();
  expect(await store.list(scope)).toEqual([]); expect(f.requests).toEqual([]);
});

it('allows explicit discard even when a full recovery directory prevents writing the latest backup', async () => {
  const directory = join(root, 'drafts'); const store = await openObsidianDraftStore(directory); const f = await fixture();
  for (let i = 0; i < 32; i++) await writeFile(join(directory, `preserved-${i}.tmp`), 'older fragment');
  const recovered = recovery.createRecoverableObsidianSession(f.session, store);
  recovered.session.setDraft('discard despite disk quota'); await expect(recovered.flush()).rejects.toThrow();
  await expect(recovered.discard()).resolves.toBeUndefined(); recovered.session.close();
  expect(await readdir(directory)).toHaveLength(32); expect(f.requests).toEqual([]);
});
