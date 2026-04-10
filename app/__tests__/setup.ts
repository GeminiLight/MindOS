import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, beforeEach, afterEach } from 'vitest';

// --- JSDOM polyfills ---

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
  (globalThis as any).DataTransfer = DataTransferPolyfill;
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
  (globalThis as any).DragEvent = DragEventPolyfill;
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
  effectiveSopRoot: () => state.root,
  effectiveAiConfig: () => ({
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4-6',
    baseUrl: '',
  }),
}));

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-app-test-'));
  testMindRoot = state.root;
});

afterEach(() => {
  fs.rmSync(state.root, { recursive: true, force: true });
});
