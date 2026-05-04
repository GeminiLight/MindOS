import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from '../core/helpers';

const completeMock = vi.fn();
const writeBaseUrlCompatMock = vi.fn();

vi.mock('@mariozechner/pi-ai', () => ({
  complete: completeMock,
}));

vi.mock('@/lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings')>();
  return {
    ...actual,
    effectiveAiConfig: () => ({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-test',
      baseUrl: 'https://proxy.example/openai',
    }),
    readBaseUrlCompat: () => ({}),
    writeBaseUrlCompat: writeBaseUrlCompatMock,
  };
});

vi.mock('@/lib/agent/model', () => ({
  getModelConfig: () => ({
    model: { id: 'gpt-test', input: ['text'] },
    modelName: 'gpt-test',
    apiKey: 'test-key',
    provider: 'openai',
    baseUrl: 'https://proxy.example/openai',
  }),
}));

vi.mock('@/lib/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fs')>();
  let mindRoot = '';
  return {
    ...actual,
    getMindRoot: () => mindRoot,
    setMindRootForTest: (p: string) => { mindRoot = p; },
    collectAllFiles: () => {
      const results: string[] = [];
      function walk(dir: string, prefix: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
          else results.push(rel);
        }
      }
      walk(mindRoot, '');
      return results;
    },
    invalidateCache: vi.fn(),
  };
});

const { compileSpaceOverview, isCompileError } = await import('@/lib/compile');
const { setMindRootForTest } = await import('@/lib/fs') as any;

describe('compileSpaceOverview LLM fallback', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    setMindRootForTest(mindRoot);
    seedFile(mindRoot, 'Space/note.md', '# Note\nImportant local context.');
    completeMock.mockResolvedValue({ content: [] });
    writeBaseUrlCompatMock.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '# Space\n\nGenerated overview.' } }],
    }), { status: 200 })));
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
    vi.unstubAllGlobals();
    completeMock.mockReset();
  });

  it('falls back to non-streaming OpenAI-compatible chat completions when pi-ai returns empty content', async () => {
    const result = await compileSpaceOverview('Space');

    expect(isCompileError(result)).toBe(false);
    if (isCompileError(result)) return;
    expect(result.content).toContain('Generated overview');
    expect(fs.readFileSync(path.join(mindRoot, 'Space/README.md'), 'utf-8')).toContain('Generated overview');
    expect(fetch).toHaveBeenCalledWith(
      'https://proxy.example/openai/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":false'),
      }),
    );
    expect(writeBaseUrlCompatMock).toHaveBeenCalledWith('https://proxy.example/openai', 'non-streaming');
  });
});
