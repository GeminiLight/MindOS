import type { DraftRecord, DraftScope, DraftState, openObsidianDraftStore } from './obsidian-draft-store';

type RecoverableSession = {
  readonly binding: DraftScope;
  readonly snapshot: DraftState & { status: string };
  setDraft(content: string): void;
  save(): Promise<void>;
  close(): void;
};
type Store = Awaited<ReturnType<typeof openObsidianDraftStore>>;

export function canRestoreObsidianDraft(session: RecoverableSession, record: DraftRecord): boolean {
  return session.snapshot.status === 'ready' && session.snapshot.revision === record.revision
    && (['vaultId', 'filePath', 'pluginId', 'fingerprint'] as const).every(key => session.binding[key] === record[key]);
}

/** Persistence decorates main-owned operations; it never performs a vault write itself. */
export function createRecoverableObsidianSession<S extends RecoverableSession>(approved: S, store: Store, restored?: DraftRecord) {
  if (restored && !canRestoreObsidianDraft(approved, restored)) throw new Error('Recovery draft does not match: note or plugin changed.');
  const journal = store.create(approved.binding);
  let closed = false; let discarded = false;
  const checkpoint = () => { if (!discarded) journal.update(approved.snapshot); };
  if (restored) { approved.setDraft(restored.content); checkpoint(); }
  const session = Object.freeze({
    ...approved,
    get snapshot() { return approved.snapshot; },
    setDraft(content: string) { approved.setDraft(content); checkpoint(); },
    async save() {
      try { await approved.save(); }
      finally { checkpoint(); }
      await journal.flush();
      // Keep the previous copy until both vault save and the new journal settle.
      if (!approved.snapshot.dirty && approved.snapshot.status === 'ready' && restored) {
        await store.remove(restored.id); restored = undefined;
      }
    },
    close() {
      if (closed) return;
      closed = true; approved.close(); checkpoint();
    },
  });
  return Object.freeze({
    session, get error() { return journal.error; }, flush: journal.flush,
    async discard() {
      discarded = true;
      try {
        // Explicit discard must not require another successful backup (e.g. disk full).
        await journal.discard();
        if (restored) { await store.remove(restored.id); restored = undefined; }
      } catch (failure) { discarded = false; checkpoint(); throw failure; }
    },
  });
}
