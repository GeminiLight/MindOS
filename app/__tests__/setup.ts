import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, beforeEach, afterEach } from 'vitest';

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
      provider: 'anthropic' as const,
      providers: {
        anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
        openai:    { apiKey: '', model: 'gpt-5.4', baseUrl: '' },
      },
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
