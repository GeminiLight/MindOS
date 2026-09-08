import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));
import * as recovery from './obsidian-draft-store';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'obsidian-drafts-')); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const scope = { vaultId: 'a'.repeat(64), filePath: '笔记/草稿 📝.md', pluginId: 'tables', fingerprint: 'b'.repeat(64) };
const draft = { content: '恢复我 📝', revision: 'c'.repeat(64), dirty: true };
const directory = () => join(root, 'drafts');

it('persists a bounded private recovery copy that survives reopening the store', async () => {
  expect(typeof recovery.openObsidianDraftStore).toBe('function');
  const store = await recovery.openObsidianDraftStore(directory());
  const journal = store.create(scope);
  journal.update(draft); await journal.flush();
  const reopened = await recovery.openObsidianDraftStore(directory());
  expect(await reopened.list(scope)).toEqual([expect.objectContaining({ ...scope, ...draft, id: journal.id })]);
  const entries = await readdir(directory());
  expect(entries).toEqual([`${journal.id}.json`]);
  if (process.platform !== 'win32') {
    expect((await stat(directory())).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory(), entries[0]))).mode & 0o777).toBe(0o600);
  }
});

it('coalesces a dirty/clean/new-dirty burst without deleting the newest draft', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const journal = store.create(scope);
  journal.update(draft); journal.update({ ...draft, dirty: false });
  journal.update({ ...draft, content: 'latest', revision: 'd'.repeat(64) });
  await journal.flush();
  expect(await store.list(scope)).toEqual([expect.objectContaining({ content: 'latest', revision: 'd'.repeat(64) })]);
  journal.update({ ...draft, dirty: false }); await journal.flush();
  expect(await store.list(scope)).toEqual([]);
});

it('keeps different sessions independent and deletes only an explicitly selected record', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const first = store.create(scope); const second = store.create(scope);
  first.update(draft); second.update({ ...draft, content: 'second' }); await Promise.all([first.flush(), second.flush()]);
  await first.discard();
  expect(await store.list(scope)).toEqual([expect.objectContaining({ id: second.id, content: 'second' })]);
  expect(await store.list({ ...scope, vaultId: 'e'.repeat(64) })).toEqual([]);
  // Changed plugin bytes remain discoverable, but are NOT safe to auto-restore.
  expect(await store.list({ ...scope, fingerprint: 'f'.repeat(64) })).toHaveLength(1);
  await expect(store.remove('../escape')).rejects.toThrow(/id/i);
});

it('copies caller data and supports empty, maximum-size, and JSON-escaped drafts', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const binding = { ...scope }; const journal = store.create(binding);
  const mutable = { ...draft }; journal.update(mutable); mutable.content = 'mutated'; binding.filePath = 'Other.md'; await journal.flush();
  expect((await store.list(scope))[0].content).toBe(draft.content);
  for (const content of ['', '\u0000'.repeat(2 * 1024 * 1024)]) {
    journal.update({ ...draft, content }); await journal.flush(); expect((await store.list(scope))[0].content).toBe(content);
  }
  expect(() => journal.update({ ...draft, content: '字'.repeat(1024 * 1024) })).toThrow(/large/i);
  expect(() => journal.update({ ...draft, revision: '' })).toThrow(/revision/i);
});

it('rejects symlink directories and records without changing their targets', async () => {
  await mkdir(join(root, 'outside')); await symlink(join(root, 'outside'), directory());
  await expect(recovery.openObsidianDraftStore(directory())).rejects.toThrow(/directory/i);
  await rm(directory()); const store = await recovery.openObsidianDraftStore(directory()); const journal = store.create(scope);
  const target = join(root, 'private'); await writeFile(target, 'do not read or overwrite');
  await symlink(target, join(directory(), `${journal.id}.json`));
  await expect(store.list(scope)).rejects.toThrow();
  journal.update(draft); await expect(journal.flush()).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('do not read or overwrite');
});

it('preserves corrupt records and reports storage failures without an unhandled rejection', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const journal = store.create(scope);
  const file = join(directory(), `${journal.id}.json`); await writeFile(file, '{broken', { mode: 0o600 });
  await expect(store.list(scope)).rejects.toThrow(/recovery/i);
  expect(await readFile(file, 'utf8')).toBe('{broken');
  await rm(file); await rm(directory(), { recursive: true }); await writeFile(directory(), 'not a directory');
  journal.update(draft); await expect(journal.flush()).rejects.toThrow();
  expect(journal.error).toMatch(/recovery/i);
});

it.each([{ filePath: '../escape.md' }, { pluginId: '../plugin' }, { vaultId: '' }, { fingerprint: '' }])('rejects malformed scope %j', async invalid => {
  const store = await recovery.openObsidianDraftStore(directory());
  expect(() => store.create({ ...scope, ...invalid })).toThrow();
});

it('cleans a partial temporary file after a disk flush failure, retaining the last good backup', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const journal = store.create(scope);
  journal.update(draft); await journal.flush();
  const realOpen = filesystem.open;
  vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
    const handle = await realOpen(...args);
    if (args[1] === 'wx') handle.sync = async () => { throw new Error('disk full'); };
    return handle;
  });
  journal.update({ ...draft, content: 'newer' }); await expect(journal.flush()).rejects.toThrow(/backup failed/i);
  expect(await readdir(directory())).toEqual([`${journal.id}.json`]);
  expect((await store.list(scope))[0].content).toBe(draft.content);
  vi.restoreAllMocks(); await journal.flush(); expect((await store.list(scope))[0].content).toBe('newer');
});

it('allows further checkpoints if explicit discard fails instead of permanently disabling recovery', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const journal = store.create(scope);
  journal.update(draft); await journal.flush(); const file = join(directory(), `${journal.id}.json`);
  await rm(file); await mkdir(file);
  await expect(journal.discard()).rejects.toThrow(); await rm(file, { recursive: true });
  expect(() => journal.update({ ...draft, content: 'still editable' })).not.toThrow();
  await journal.flush(); expect((await store.list(scope))[0].content).toBe('still editable');
});

it('bounds retained recovery entries without silently evicting old user drafts', async () => {
  const store = await recovery.openObsidianDraftStore(directory());
  for (let i = 0; i < 32; i++) await writeFile(join(directory(), `preserved-${i}.tmp`), 'old recovery fragment');
  const journal = store.create(scope); journal.update(draft);
  await expect(journal.flush()).rejects.toThrow();
  expect(await readdir(directory())).toHaveLength(32);
});

it('bounds waiting for a stalled filesystem flush while retaining the previous backup', async () => {
  const store = await recovery.openObsidianDraftStore(directory()); const journal = store.create(scope);
  journal.update(draft); await journal.flush();
  let unblock!: () => void; let started!: () => void;
  const blocked = new Promise<void>(resolve => { started = resolve; });
  const realOpen = filesystem.open;
  vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
    const handle = await realOpen(...args);
    if (args[1] === 'wx') handle.sync = async () => { started(); await new Promise<void>(resolve => { unblock = resolve; }); };
    return handle;
  });
  journal.update({ ...draft, content: 'pending' }); await blocked;
  vi.useFakeTimers();
  let settled = false;
  const waiting = journal.flush().then(() => { settled = true; }, () => { settled = true; });
  await vi.advanceTimersByTimeAsync(5001);
  try {
    expect(settled).toBe(true);
    expect((await store.list(scope))[0].content).toBe(draft.content);
  } finally { unblock(); vi.useRealTimers(); await waiting; await journal.flush(); }
});
