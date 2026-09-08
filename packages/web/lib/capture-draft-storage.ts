/** Browser-local capture drafts. Files stay binary; no base64 in localStorage. */
export type StagedTextNote = { id: string; content: string; wordCount: number; createdAt: string };
export type CaptureDraft = {
  draftText: string;
  stagedNotes: StagedTextNote[];
  pendingUrls: string[];
  pendingFiles: File[];
};
export type CaptureDraftRecord = { schema: 1; revision: string; value: CaptureDraft };
export interface CaptureDraftStorage {
  read(scope: string): Promise<CaptureDraftRecord | null>;
  write(scope: string, revision: string | null, value: CaptureDraft): Promise<string>;
}
export class CaptureDraftConflictError extends Error {
  constructor() { super('Another window updated this capture draft.'); }
}
const DATABASE = 'mindos-capture-drafts';
const STORE = 'drafts';
const TIMEOUT = 8000;

export function validateCaptureDraftRecord(input: unknown): CaptureDraftRecord {
  const record = input as CaptureDraftRecord | null;
  const value = record?.value;
  if (!record || record.schema !== 1 || typeof record.revision !== 'string' || !record.revision
    || !value || typeof value.draftText !== 'string'
    || !Array.isArray(value.stagedNotes) || !value.stagedNotes.every(note => note
      && typeof note.id === 'string' && typeof note.content === 'string'
      && typeof note.createdAt === 'string' && Number.isFinite(note.wordCount) && note.wordCount >= 0)
    || !Array.isArray(value.pendingUrls) || !value.pendingUrls.every(url => typeof url === 'string' && /^https?:\/\//i.test(url))
    || !Array.isArray(value.pendingFiles) || !value.pendingFiles.every(file => file instanceof File)) {
    throw new Error('The saved capture draft could not be read. The original has been retained.');
  }
  return record;
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('Draft storage timed out.')); }, TIMEOUT);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      resolve(request.result);
    };
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (
  store: IDBObjectStore,
  result: (value: T) => void,
  fail: (error: unknown) => void,
) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    let error: unknown;
    const fail = (reason: unknown) => { error = reason; tx.abort(); };
    const timer = setTimeout(() => fail(new Error('Draft transaction timed out.')), TIMEOUT);
    const close = () => { clearTimeout(timer); db.close(); };
    tx.oncomplete = () => { close(); resolve(result); };
    tx.onabort = () => { close(); reject(error ?? tx.error ?? new Error('Draft transaction aborted.')); };
    tx.onerror = () => { error ??= tx.error; };
    try { run(tx.objectStore(STORE), value => { result = value; }, fail); }
    catch (reason) { fail(reason); }
  });
}

export const captureDraftStorage: CaptureDraftStorage = {
  read: scope => transact('readonly', (store, result, fail) => {
    const request = store.get(scope);
    request.onsuccess = () => {
      try { result(request.result === undefined ? null : validateCaptureDraftRecord(request.result)); }
      catch (error) { fail(error); }
    };
  }),
  write: (scope, expectedRevision, value) => transact('readwrite', (store, result, fail) => {
    const request = store.get(scope);
    request.onsuccess = () => {
      try {
        const previous = request.result === undefined ? null : validateCaptureDraftRecord(request.result);
        if ((previous?.revision ?? null) !== expectedRevision) throw new CaptureDraftConflictError();
        // getRandomValues is available on LAN HTTP too; randomUUID requires HTTPS.
        const revision = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        // Keep an empty tombstone: a stale window must not resurrect saved captures.
        store.put({ schema: 1, revision, value } satisfies CaptureDraftRecord, scope);
        result(revision);
      } catch (error) { fail(error); }
    };
  }),
};
