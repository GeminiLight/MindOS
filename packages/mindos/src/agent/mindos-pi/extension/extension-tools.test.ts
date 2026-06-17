import { describe, expect, it } from 'vitest';
import {
  collectMindosRuntimeToolsForFallback,
  createMindosHeadlessExtensionContext,
} from './extension-tools.js';
import type { MindosPiResourceLoaderAdapter } from '../resource-types.js';
import type { MindosExecutableTool } from '../../tool/index.js';

describe('MindOS pi extension tools', () => {
  it('adapts pi extension tool wrappers for the non-streaming fallback', async () => {
    const requestTool: MindosExecutableTool = {
      name: 'read_file',
      execute: async () => ({ content: [{ type: 'text', text: 'request result' }] }),
    };
    const captured: {
      params?: unknown;
      ctx?: Record<string, unknown>;
      toolCallId?: string;
    } = {};
    const resourceLoader: MindosPiResourceLoaderAdapter = {
      reload: async () => {},
      getExtensions: () => ({
        extensions: [{
          path: '/extensions/pi-web-access.ts',
          tools: new Map<string, unknown>([
            ['read_file', {
              definition: {
                name: 'read_file',
                execute: async () => ({ content: [{ type: 'text', text: 'extension result' }] }),
              },
            }],
            ['web_search', {
              definition: {
                name: 'web_search',
                description: 'Search the web',
                parameters: { type: 'object', properties: { query: { type: 'string' } } },
                prepareArguments: (args: unknown) => ({
                  query: String((args as { query?: unknown }).query ?? '').trim(),
                }),
                execute: async (
                  toolCallId: string,
                  params: unknown,
                  _signal: AbortSignal | undefined,
                  onUpdate: ((update: unknown) => void) | undefined,
                  ctx: Record<string, unknown>,
                ) => {
                  captured.toolCallId = toolCallId;
                  captured.params = params;
                  captured.ctx = ctx;
                  onUpdate?.({ content: [{ type: 'text', text: 'Searching...' }] });
                  return { ok: true };
                },
              },
              sourceInfo: { packageName: 'pi-web-access' },
            }],
          ]),
        }],
        errors: [],
      }),
    };
    const extensionContext = createMindosHeadlessExtensionContext({
      cwd: '/repo',
      model: { id: 'model' },
      modelRegistry: { registry: true },
      sessionManager: { session: true },
      settingsManager: { settings: true },
      resourceLoader,
    });

    const tools = collectMindosRuntimeToolsForFallback({
      requestTools: [requestTool],
      resourceLoader,
      extensionContext,
    });

    expect(tools.map((tool) => tool.name)).toEqual(['read_file', 'web_search']);
    expect(tools.find((tool) => tool.name === 'read_file')).toBe(requestTool);

    const updates: unknown[] = [];
    const webSearch = tools.find((tool) => tool.name === 'web_search');
    await expect(webSearch?.execute('call-search', { query: ' pi.dev ' }, new AbortController().signal, (update) => {
      updates.push(update);
    })).resolves.toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });

    expect(webSearch).toMatchObject({
      name: 'web_search',
      description: 'Search the web',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    });
    expect(captured).toMatchObject({
      toolCallId: 'call-search',
      params: { query: 'pi.dev' },
      ctx: expect.objectContaining({
        cwd: '/repo',
        hasUI: false,
        model: { id: 'model' },
        resourceLoader,
      }),
    });
    expect(updates).toEqual([{ content: [{ type: 'text', text: 'Searching...' }] }]);
  });
});
