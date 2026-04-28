import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the extension
vi.mock('@/lib/agent/web-search', () => ({
  webSearch: vi.fn(),
  formatSearchResults: vi.fn(),
}));

vi.mock('@/lib/settings', () => ({
  readSettings: vi.fn(() => ({})),
}));

vi.mock('@sinclair/typebox', () => ({
  Type: {
    Object: (schema: Record<string, unknown>) => schema,
    String: (opts?: unknown) => ({ type: 'string', ...(opts as object) }),
    Integer: (opts?: unknown) => ({ type: 'integer', ...(opts as object) }),
    Optional: (schema: unknown) => schema,
  },
}));

import { webSearch, formatSearchResults } from '@/lib/agent/web-search';
import { readSettings } from '@/lib/settings';
import webSearchExtension from '@/lib/agent/web-search-extension';

const mockWebSearch = vi.mocked(webSearch);
const mockFormat = vi.mocked(formatSearchResults);
const mockReadSettings = vi.mocked(readSettings);

// Capture the registered tool's execute function
let registeredExecute: (toolCallId: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;

beforeEach(() => {
  vi.resetAllMocks();
  mockReadSettings.mockReturnValue({
    ai: { provider: 'anthropic', model: 'test', apiKey: 'test' },
    mindRoot: '',
  } as any);

  // Capture registerTool call
  const mockPi = {
    registerTool: vi.fn((def: { execute: typeof registeredExecute }) => {
      registeredExecute = def.execute;
    }),
  };
  webSearchExtension(mockPi as any);
});

describe('web-search-extension', () => {
  it('registers a tool named web_search', () => {
    const mockPi = { registerTool: vi.fn() };
    webSearchExtension(mockPi as any);
    expect(mockPi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search' }),
    );
  });

  it('returns formatted results on success', async () => {
    mockWebSearch.mockResolvedValue({
      results: [{ title: 'Result', url: 'https://example.com', snippet: 'Found it' }],
      engine: 'DuckDuckGo',
    });
    mockFormat.mockReturnValue('## Web Search Results for: "test"\n\n### 1. Result');

    const result = await registeredExecute('call-1', { query: 'test' });

    expect(mockWebSearch).toHaveBeenCalledWith('test', undefined);
    expect(result.content[0].text).toContain('Web Search Results');
    expect(result.details).toEqual({ engine: 'DuckDuckGo' });
  });

  it('passes webSearch config from settings', async () => {
    mockReadSettings.mockReturnValue({
      ai: { provider: 'anthropic', model: 'test', apiKey: 'test' },
      mindRoot: '',
      webSearch: { provider: 'tavily', apiKey: 'tvly-xxx' },
    } as any);
    mockWebSearch.mockResolvedValue({ results: [{ title: 'R', url: 'https://r.com', snippet: 's' }], engine: 'Tavily' });
    mockFormat.mockReturnValue('formatted');

    await registeredExecute('call-2', { query: 'test' });

    expect(mockWebSearch).toHaveBeenCalledWith('test', { provider: 'tavily', apiKey: 'tvly-xxx' });
  });

  it('returns error message when query is empty', async () => {
    const result = await registeredExecute('call-3', { query: '  ' });

    expect(mockWebSearch).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('query cannot be empty');
  });

  it('returns error message when webSearch throws', async () => {
    mockWebSearch.mockRejectedValue(new Error('Network timeout'));

    const result = await registeredExecute('call-4', { query: 'test' });

    expect(result.content[0].text).toContain('Web search error: Network timeout');
  });

  it('trims whitespace from query', async () => {
    mockWebSearch.mockResolvedValue({ results: [{ title: 'R', url: 'https://r.com', snippet: 's' }], engine: 'Bing' });
    mockFormat.mockReturnValue('formatted');

    await registeredExecute('call-5', { query: '  react 19  ' });

    expect(mockWebSearch).toHaveBeenCalledWith('react 19', undefined);
  });
});
