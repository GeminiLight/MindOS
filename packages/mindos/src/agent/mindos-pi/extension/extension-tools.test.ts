import { describe, expect, it } from 'vitest';
import {
  collectMindosPiRegisteredToolSummaries,
} from './extension-tools.js';
import type { MindosPiResourceLoaderAdapter } from '../resource-types.js';

describe('MindOS pi extension tools', () => {
  it('summarizes extension tools so the runtime prompt can answer capability questions', () => {
    const resourceLoader: MindosPiResourceLoaderAdapter = {
      reload: async () => {},
      getExtensions: () => ({
        extensions: [{
          path: '/extensions/pi-web-access/index.ts',
          tools: new Map<string, unknown>([
            ['web_search', {
              definition: {
                name: 'web_search',
                description: 'Search the web',
              },
              sourceInfo: { packageName: 'pi-web-access' },
            }],
            ['fetch_content', {
              definition: {
                name: 'fetch_content',
                description: 'Fetch a URL',
              },
              sourceInfo: { packageName: 'pi-web-access' },
            }],
          ]),
        }],
        errors: [],
      }),
    };

    const summaries = collectMindosPiRegisteredToolSummaries({
      resourceLoader,
      customTools: [{ name: 'bash', description: 'Run a shell command' }],
    });

    expect(summaries).toEqual([
      { name: 'bash', description: 'Run a shell command', source: 'custom', sourceName: 'mindos-runtime' },
      { name: 'fetch_content', description: 'Fetch a URL', source: 'extension', sourceName: 'pi-web-access' },
      { name: 'web_search', description: 'Search the web', source: 'extension', sourceName: 'pi-web-access' },
    ]);
  });
});
