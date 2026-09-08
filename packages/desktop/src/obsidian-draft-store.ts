import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { untilAbort } from './obsidian-response';

export type DraftScope = Readonly<{ vaultId: string; filePath: string; pluginId: string; fingerprint: string }>;
export type DraftState = Readonly<{ content: string; revision: string; dirty: boolean }>;
export type DraftRecord = DraftScope & DraftState & Readonly<{ version: 1; id: string; updatedAt: number }>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_CONTENT = 2 * 1024 * 1024;
// JSON can expand a control byte to six bytes. Bound both wire and decoded size.
const MAX_RECORD = 6 * MAX_CONTENT + 8192;
const MAX_ENTRIES = 32;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function assertScope(scope: DraftScope) {
  if (!scope || !HASH.test(scope.vaultId) || !HASH.test(scope.fingerprint)
    || typeof scope.pluginId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(scope.pluginId)
    || typeof scope.filePath !== 'string' || scope.filePath.length > 1024 || !/\.md$/i.test(scope.filePath)
    || /[\\:\x00-\x1f]/.test(scope.filePath) || scope.filePath.split('/').some(part => !part || part.startsWith('.'))) {
    throw new Error('Invalid recovery scope.');
  }
}
function assertState(state: DraftState) {
  if (!state || typeof state.revision !== 'string' || !HASH.test(state.revision)) throw new Error('Invalid recovery revision.');
  if (typeof state.content !== 'string' || typeof state.dirty !== 'boolean') throw new Error('Invalid recovery draft.');
  if (Buffer.byteLength(state.content, 'utf8') > MAX_CONTENT) throw new Error('Recovery draft is too large (2 MiB limit).');
}

/** Main-owned private directory only. No vault writes, renderer paths or credentials. */
export async function openObsidianDraftStore(directory: string) {
  if (!isAbsolute(directory)) throw new Error('Recovery directory must be absolute.');
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const checkDirectory = async () => {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()
      || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Recovery directory must be private and not a symlink.');
  };
  await checkDirectory();
  const filename = (id: string) => {
    if (!ID.test(id)) throw new Error('Invalid recovery record id.');
    return join(directory, `${id}.json`);
  };
  const checkFile = async (file: string) => {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1
        || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Unsafe recovery record.');
      return info;
    } catch (error) { if (missing(error)) return null; throw error; }
  };
  const entries = async () => {
    await checkDirectory();
    const names: string[] = [];
    for await (const entry of await opendir(directory)) {
      names.push(entry.name);
      if (names.length > MAX_ENTRIES) throw new Error('Recovery storage is full. Preserve or remove old drafts before continuing.');
    }
    return names;
  };
  const remove = async (id: string) => {
    const file = filename(id); await checkDirectory();
    if (await checkFile(file)) await unlink(file);
  };
  return Object.freeze({
    remove,
    async list(scope: DraftScope): Promise<readonly DraftRecord[]> {
      assertScope(scope);
      const records: DraftRecord[] = [];
      for (const name of await entries()) {
        if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue;
        const file = join(directory, name);
        try {
          const info = await checkFile(file);
          if (!info) continue;
          if (info.size > MAX_RECORD) throw new Error('Record too large.');
          const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
          let record: DraftRecord;
          try {
            const opened = await handle.stat();
            if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev || opened.size > MAX_RECORD) throw new Error('Record changed.');
            // Bounded allocation even if another process grows the file after stat.
            const bytes = Buffer.alloc(opened.size + 1);
            let offset = 0;
            while (offset < bytes.length) {
              const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
              if (!bytesRead) break;
              offset += bytesRead;
            }
            if (offset > opened.size) throw new Error('Record changed.');
            record = JSON.parse(bytes.subarray(0, offset).toString('utf8'));
          } finally { await handle.close(); }
          assertScope(record); assertState(record);
          if (record.version !== 1 || record.id !== name.slice(0, -5) || record.dirty !== true
            || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0) throw new Error('Invalid record.');
          if (record.vaultId === scope.vaultId && record.filePath === scope.filePath && record.pluginId === scope.pluginId) records.push(Object.freeze(record));
        } catch (error) { throw new Error(`Cannot read recovery record ${name}; original file preserved.`, { cause: error }); }
      }
      return Object.freeze(records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
    },
    create(binding: DraftScope) {
      assertScope(binding);
      const scope = Object.freeze({ vaultId: binding.vaultId, filePath: binding.filePath, pluginId: binding.pluginId, fingerprint: binding.fingerprint });
      const id = randomUUID(); const file = filename(id);
      let pending: DraftState | undefined; let running: Promise<void> | undefined; let error = ''; let discarded = false;
      const write = async (state: DraftState) => {
        if (!state.dirty) { await remove(id); return; }
        const names = await entries();
        if (!names.includes(`${id}.json`) && names.length >= MAX_ENTRIES) throw new Error('Recovery storage is full.');
        await checkFile(file);
        const temporary = join(directory, `${id}-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try {
            await handle.writeFile(JSON.stringify({ ...scope, ...state, version: 1, id, updatedAt: Date.now() }));
            await handle.sync();
          } finally { await handle.close(); }
          await checkDirectory(); await checkFile(file); await rename(temporary, file);
        }
        finally { await unlink(temporary).catch(failure => { if (!missing(failure)) throw failure; }); }
      };
      const start = () => {
        if (running) return;
        running = (async () => {
          while (pending) {
            const next = pending; pending = undefined;
            try { await write(next); error = ''; }
            catch (failure) {
              pending ??= next;
              error = 'Draft recovery backup failed. Keep this window open and save the note.';
              throw new Error(error, { cause: failure });
            }
          }
        })().finally(() => {
          running = undefined;
          // An update can arrive between the worker settling and this microtask.
          if (pending && !error) start();
        });
        // Updates arrive through fire-and-forget IPC; flush is the explicit error boundary.
        void running.catch(() => {});
      };
      const flush = async () => {
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new Error('Recovery backup timed out; keep the editor open and save the note.')), 5000);
        try {
          while (running || pending) {
            if (!running) start();
            await untilAbort(running!, deadline.signal);
          }
          if (error) throw new Error(error);
        } finally { clearTimeout(timer); }
      };
      return Object.freeze({
        id, get error() { return error; },
        update(state: DraftState) {
          if (discarded) throw new Error('Recovery journal was discarded.');
          assertState(state);
          pending = { content: state.content, revision: state.revision, dirty: state.dirty };
          start();
        },
        flush,
        async discard() {
          discarded = true; pending = undefined;
          await running?.catch(() => {});
          pending = undefined;
          try { await remove(id); error = ''; }
          finally { discarded = false; }
        },
      });
    },
  });
}
