import { Events, type EventCallback, type EventRef } from '../events';

export type BrowserFileStat = Readonly<{ ctime: number; mtime: number; size: number }>;
export type BrowserVaultSnapshot = Readonly<{
  vaultId: string; name: string; sequence: number; folders: readonly string[];
  files: readonly Readonly<{ path: string; data: Uint8Array; stat: BrowserFileStat }>[];
}>;
type RecordEntry = { path: string; parent: BrowserTFolder | null; children: BrowserTAbstractFile[]; data?: Uint8Array; stat?: BrowserFileStat };
const records = new WeakMap<BrowserTAbstractFile, RecordEntry>();
const entry = (file: BrowserTAbstractFile) => records.get(file)!;

export class BrowserTAbstractFile {
  constructor(readonly vault: BrowserVault, record: RecordEntry) { records.set(this, record); Object.freeze(this); }
  get path(): string { return entry(this).path; }
  get name(): string { return this.path.split('/').pop()!; }
  get parent(): BrowserTFolder | null { return entry(this).parent; }
}
export class BrowserTFile extends BrowserTAbstractFile {
  get extension(): string { const name = this.name; return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''; }
  get basename(): string { return this.extension ? this.name.slice(0, -this.extension.length - 1) : this.name; }
  get stat(): BrowserFileStat { return entry(this).stat!; }
}
export class BrowserTFolder extends BrowserTAbstractFile {
  get children(): BrowserTAbstractFile[] { return [...entry(this).children]; }
  isRoot(): boolean { return this.path === ''; }
}
type State = { closed: boolean; snapshot: BrowserVaultSnapshot; entries: Map<string, BrowserTAbstractFile>; refs: Set<EventRef> };
const states = new WeakMap<BrowserVault, State>();
const active = (vault: BrowserVault): State => {
  const state = states.get(vault)!;
  if (state.closed) throw new Error('Vault runtime is closed.');
  return state;
};

function pathKey(value: string, root = false): string {
  if (root && (value === '' || value === '/')) return '';
  if (typeof value !== 'string' || value.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(value)
    || value.split('/').some(part => !part || part.startsWith('.')) || value.split('/').length > 64) {
    throw new Error('Invalid or private Vault path.');
  }
  return value;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sameData = (a?: Uint8Array, b?: Uint8Array) => a?.length === b?.length && !!a && !!b && a.every((byte, index) => byte === b[index]);
function validate(snapshot: BrowserVaultSnapshot): BrowserVaultSnapshot {
  if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.vaultId) || typeof snapshot.name !== 'string' || !snapshot.name || snapshot.name.length > 256
    || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 || !Array.isArray(snapshot.files) || snapshot.files.length > 10_000
    || !Array.isArray(snapshot.folders) || snapshot.folders.length > 20_000) throw new Error('Invalid Vault snapshot.');
  const paths = new Set<string>(); let bytes = 0;
  // Array.from visits sparse slots; Array.map would silently preserve them and
  // let installation fail after earlier records had already been overwritten.
  const files = Array.from(snapshot.files, file => {
    const path = pathKey(file.path);
    if (paths.has(path)) throw new Error('Duplicate Vault file.'); paths.add(path);
    if (!(file.data instanceof Uint8Array) || file.data.length > 2 * 1024 * 1024 || (bytes += file.data.length) > 64 * 1024 * 1024
      || !file.stat || !Number.isFinite(file.stat.ctime) || file.stat.ctime < 0 || !Number.isFinite(file.stat.mtime) || file.stat.mtime < 0
      || file.stat.size !== file.data.length) throw new Error('Invalid Vault file data or statistics.');
    return Object.freeze({ path, data: new Uint8Array(file.data), stat: Object.freeze({ ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size }) });
  });
  const folders = new Set(Array.from(snapshot.folders, path => pathKey(path)));
  for (const path of [...paths, ...folders]) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) { folders.add(parts.join('/')); parts.pop(); }
  }
  if (folders.size > 20_000 || [...folders].some(path => paths.has(path))) throw new Error('Invalid Vault file/folder collision or folder limit.');
  return Object.freeze({ vaultId: snapshot.vaultId, name: snapshot.name, sequence: snapshot.sequence,
    files: Object.freeze(files.sort((a, b) => compare(a.path, b.path))), folders: Object.freeze([...folders].sort(compare)) });
}
function currentFile(vault: BrowserVault, file: BrowserTFile): RecordEntry {
  const state = active(vault);
  if (!(file instanceof BrowserTFile) || file.vault !== vault || state.entries.get(file.path) !== file) throw new Error('Foreign, missing or stale Vault file.');
  return entry(file);
}
function text(vault: BrowserVault, file: BrowserTFile): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(currentFile(vault, file).data);
}
async function denied(..._args: unknown[]): Promise<never> { throw new Error('Vault is read-only: an authorized mutation broker is required.'); }

/** Read facet only. The trusted owner retains applySnapshot/close separately. */
export class BrowserVault extends Events {
  readonly adapter = Object.freeze({
    getName: () => this.getName(),
    exists: async (path: string) => this.getAbstractFileByPath(path) !== null,
    list: async (path: string) => {
      const folder = this.getFolderByPath(path); if (!folder) throw new Error('Vault folder not found.');
      return { files: folder.children.filter(child => child instanceof BrowserTFile).map(child => child.path),
        folders: folder.children.filter(child => child instanceof BrowserTFolder).map(child => child.path) };
    },
    stat: async (path: string) => {
      const file = this.getAbstractFileByPath(path); if (!file) return null;
      if (!(file instanceof BrowserTFile)) throw new Error('Folder statistics are not supplied by this Vault snapshot.');
      return { type: 'file' as const, ...file.stat };
    },
    read: async (path: string) => this.read(this.requiredFile(path)),
    readBinary: async (path: string) => this.readBinary(this.requiredFile(path)),
    write: denied, writeBinary: denied, append: denied, appendBinary: denied, process: denied,
    mkdir: denied, remove: denied, rmdir: denied, rename: denied, copy: denied, trashSystem: denied, trashLocal: denied,
  });
  override on(name: string, callback: EventCallback, ctx?: unknown): EventRef {
    const state = active(this); const ref = super.on(name, callback, ctx); state.refs.add(ref);
    const off = ref.off; ref.off = () => { off(); state.refs.delete(ref); }; return ref;
  }
  getName(): string { return active(this).snapshot.name; }
  getRoot(): BrowserTFolder { return active(this).entries.get('') as BrowserTFolder; }
  getAbstractFileByPath(path: string): BrowserTAbstractFile | null { return active(this).entries.get(pathKey(path, true)) ?? null; }
  getFileByPath(path: string): BrowserTFile | null { const file = this.getAbstractFileByPath(path); return file instanceof BrowserTFile ? file : null; }
  getFolderByPath(path: string): BrowserTFolder | null { const file = this.getAbstractFileByPath(path); return file instanceof BrowserTFolder ? file : null; }
  getAllLoadedFiles(): BrowserTAbstractFile[] { return [...active(this).entries.values()]; }
  getFiles(): BrowserTFile[] { return this.getAllLoadedFiles().filter(file => file instanceof BrowserTFile); }
  getMarkdownFiles(): BrowserTFile[] { return this.getFiles().filter(file => file.extension.toLowerCase() === 'md'); }
  async read(file: BrowserTFile): Promise<string> { return text(this, file); }
  async cachedRead(file: BrowserTFile): Promise<string> { return text(this, file); }
  async readBinary(file: BrowserTFile): Promise<ArrayBuffer> { return new Uint8Array(currentFile(this, file).data!).buffer; }
  create = denied; createBinary = denied; createFolder = denied; modify = denied; modifyBinary = denied;
  append = denied; process = denied; delete = denied; trash = denied; rename = denied; copy = denied;
  private requiredFile(path: string): BrowserTFile { const file = this.getFileByPath(path); if (!file) throw new Error('Vault file not found.'); return file; }
}

/** Snapshot sources must already be permission checked; this is not an I/O broker. */
export function createBrowserVault(initial: BrowserVaultSnapshot) {
  const vault = new BrowserVault();
  const state: State = { closed: false, snapshot: validate(initial), entries: new Map(), refs: new Set() };
  states.set(vault, state);
  function install(snapshot: BrowserVaultSnapshot, renames: readonly { from: string; to: string }[] = [], notify = true) {
    const previous = state.entries; const next = new Map<string, BrowserTAbstractFile>();
    const sources = new Set<string>(); const renameByTarget = new Map<string, string>();
    for (const { from, to } of renames) {
      pathKey(from); pathKey(to);
      if (!(previous.get(from) instanceof BrowserTFile) || previous.has(to) || sources.has(from) || renameByTarget.has(to)
        || snapshot.files.some(file => file.path === from) || !snapshot.files.some(file => file.path === to)) throw new Error('Invalid Vault rename mapping.');
      sources.add(from); renameByTarget.set(to, from);
    }
    const pending: Array<[string, BrowserTAbstractFile, string?]> = [];
    for (const path of ['', ...snapshot.folders]) {
      const existing = previous.get(path); const old = existing instanceof BrowserTFolder ? existing : undefined;
      const folder = old ?? new BrowserTFolder(vault, { path, parent: null, children: [] });
      next.set(path, folder); if (!old && path) pending.push(['create', folder]);
    }
    for (const file of snapshot.files) {
      const from = renameByTarget.get(file.path); const existing = previous.get(from ?? file.path);
      const old = existing instanceof BrowserTFile ? existing : undefined;
      const target = old ?? new BrowserTFile(vault, { path: file.path, parent: null, children: [] });
      const record = entry(target);
      const modified = !!old && (!sameData(record.data, file.data) || record.stat?.mtime !== file.stat.mtime || record.stat?.ctime !== file.stat.ctime);
      record.path = file.path; record.data = file.data; record.stat = file.stat;
      next.set(file.path, target);
      if (from) pending.push(['rename', target, from]);
      if (!old) pending.push(['create', target]); else if (modified) pending.push(['modify', target]);
    }
    // Reusing a path does not reuse its identity when its file/folder type
    // changes. Retire children before parents and before replacement creates.
    const deleted = [...previous.values()].filter(file => next.get(file.path) !== file)
      .sort((a, b) => b.path.split('/').length - a.path.split('/').length || compare(a.path, b.path));
    pending.unshift(...deleted.map(file => ['delete', file] as [string, BrowserTAbstractFile]));
    for (const file of next.values()) entry(file).children = [];
    for (const file of next.values()) {
      const parentPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      entry(file).parent = file.path ? next.get(parentPath) as BrowserTFolder : null;
      if (file.parent) entry(file.parent).children.push(file);
    }
    for (const file of next.values()) entry(file).children.sort((a, b) => compare(a.path, b.path));
    state.snapshot = snapshot; state.entries = next;
    if (notify) for (const [name, file, oldPath] of pending) {
      // Events catches synchronous listeners. Observe async listeners as well;
      // a plugin failure must not turn a successfully installed snapshot partial.
      for (const result of vault.trigger(name, file, oldPath)) void Promise.resolve(result).catch(error => console.error('[obsidian-compat] Vault listener failed:', error));
    }
  }
  install(state.snapshot, [], false);
  return Object.freeze({
    vault,
    readText: (file: BrowserTFile) => text(vault, file),
    applySnapshot(snapshot: BrowserVaultSnapshot, renames: readonly { from: string; to: string }[] = []) {
      active(vault);
      if (snapshot?.vaultId !== state.snapshot.vaultId || snapshot.sequence <= state.snapshot.sequence) throw new Error('Stale or cross-vault snapshot.');
      install(validate(snapshot), renames);
    },
    close() { if (state.closed) return; state.closed = true; for (const ref of state.refs) ref.off(); state.entries.clear(); },
  });
}
export type BrowserVaultController = ReturnType<typeof createBrowserVault>;
