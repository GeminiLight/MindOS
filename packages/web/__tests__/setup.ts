import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, beforeEach, afterEach } from 'vitest';

// --- Git env isolation ---
// Git hooks (pre-push etc.) export GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE…
// pointing at the real repository. Tests in this suite (and the product code
// they invoke) spawn `git init/add/commit` in temp dirs with inherited env —
// under a hook those commands would silently operate on the real repo (real
// incident: sync-test commits destroyed the development worktree). Scrub the
// repo-targeting vars for the whole test process.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

type TestGlobal = typeof globalThis & {
  DataTransfer: typeof DataTransfer;
  DragEvent: typeof DragEvent;
};

// --- JSDOM polyfills ---

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function installMemoryStorage(target: object, key: 'localStorage' | 'sessionStorage', fallback?: Storage): Storage {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  const existing = descriptor && 'value' in descriptor ? descriptor.value as Storage | undefined : undefined;
  if (existing) return existing;

  const storage = fallback ?? createMemoryStorage();
  Object.defineProperty(target, key, {
    configurable: true,
    value: storage,
  });
  return storage;
}

const testLocalStorage = installMemoryStorage(globalThis, 'localStorage');
const testSessionStorage = installMemoryStorage(globalThis, 'sessionStorage');

if (typeof window !== 'undefined') {
  installMemoryStorage(window, 'localStorage', testLocalStorage);
  installMemoryStorage(window, 'sessionStorage', testSessionStorage);
}

// JSDOM doesn't implement scrollIntoView
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// JSDOM doesn't implement DataTransfer
if (typeof globalThis.DataTransfer === 'undefined') {
  class DataTransferPolyfill {
    private _data: Record<string, string> = {};
    dropEffect = 'none';
    effectAllowed = 'uninitialized';
    files: FileList = [] as unknown as FileList;
    items: DataTransferItemList = [] as unknown as DataTransferItemList;
    types: string[] = [];
    setData(format: string, data: string) {
      this._data[format] = data;
      if (!this.types.includes(format)) this.types.push(format);
    }
    getData(format: string) {
      return this._data[format] ?? '';
    }
    clearData(format?: string) {
      if (format) {
        delete this._data[format];
        this.types = this.types.filter(t => t !== format);
      } else {
        this._data = {};
        this.types = [];
      }
    }
    setDragImage() {}
  }
  (globalThis as TestGlobal).DataTransfer = DataTransferPolyfill as typeof DataTransfer;
}

// JSDOM doesn't implement DragEvent
if (typeof globalThis.DragEvent === 'undefined' && typeof globalThis.MouseEvent !== 'undefined') {
  class DragEventPolyfill extends MouseEvent {
    readonly dataTransfer: DataTransfer | null;
    constructor(type: string, init?: DragEventInit & { dataTransfer?: DataTransfer | null }) {
      super(type, init);
      this.dataTransfer = init?.dataTransfer ?? null;
    }
  }
  (globalThis as TestGlobal).DragEvent = DragEventPolyfill as typeof DragEvent;
}

// Temp MIND_ROOT for each test
export let testMindRoot: string;

// Helper to seed files into the temp dir
export function seedFile(relativePath: string, content: string): void {
  const abs = path.join(testMindRoot, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

// We need to expose testMindRoot via a getter since it changes per test
const state = { root: '' };
export function getTestMindRoot() {
  return state.root;
}

// Mock the settings module so effectiveSopRoot() returns our temp dir
vi.mock('@/lib/settings', () => ({
  readSettings: () => ({
    ai: {
      activeProvider: 'p_anthro01',
      providers: [
        { id: 'p_anthro01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
        { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
      ],
    },
    mindRoot: '',
  }),
  writeSettings: vi.fn(),
  recordSkillInstall: vi.fn(),
  effectiveSopRoot: () => state.root,
  effectiveAiConfig: () => ({
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4-6',
    baseUrl: '',
  }),
}));

vi.mock('@/lib/mind-root', () => ({
  effectiveMindRoot: () => state.root,
}));

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-app-test-'));
  testMindRoot = state.root;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  fs.rmSync(state.root, { recursive: true, force: true });
  // ask-run-store / ask-session-store keep runs/messages/metadata at module
  // level so background chat runs survive unmounts — in tests that means state
  // leaks across cases unless reset here. Order matters: the run-store reset
  // nulls its bridge slots, the session-store reset re-wires them. Dynamic
  // import keeps non-web suites from paying the cost.
  const { resetAskRunStoreForTests } = await import('@/lib/ask-run-store');
  resetAskRunStoreForTests();
  const { resetAskSessionStoreForTests } = await import('@/lib/ask-session-store');
  resetAskSessionStoreForTests();
  const { resetWorkspaceTabsForTests } = await import('@/lib/workspace-tabs');
  resetWorkspaceTabsForTests();
});
