import { describe, expect, it } from 'vitest';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  importMarkdownCodeBlocksRoute,
  importMarkdownPostProcessorsRoute,
  postRequest,
  markdownBlocksPostRequest,
  markdownPostProcessorsPostRequest,
} from './obsidian-plugin-api-test-utils';

describe('/api/obsidian-plugins markdown host', () => {
  installObsidianPluginApiHarness();

  it('renders enabled markdown code block processors through the markdown host API', async () => {
    writePlugin(
      'markdown-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class MarkdownPlugin extends Plugin {
          onload() {
            this.registerMarkdownCodeBlockProcessor('tasks', (source, el) => {
              el.createDiv({ text: 'Rendered tasks' });
              el.createDiv({ text: source.trim() });
            });
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'markdown-plugin' }));

    const { POST } = await importMarkdownCodeBlocksRoute();
    const res = await POST(markdownBlocksPostRequest({
      blocks: [{ id: 'tasks-1', language: 'tasks', source: '- [ ] Review plugin hooks' }],
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.blocks).toEqual([
      {
        id: 'tasks-1',
        language: 'tasks',
        renders: [
          {
            processorId: 'markdown-plugin:tasks:1',
            pluginId: 'markdown-plugin',
            pluginName: 'markdown-plugin',
            language: 'tasks',
            text: 'Rendered tasks\n- [ ] Review plugin hooks',
          },
        ],
      },
    ]);
  });

  it('rejects markdown code block render requests without blocks', async () => {
    const { POST } = await importMarkdownCodeBlocksRoute();
    const res = await POST(markdownBlocksPostRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Missing blocks');
  });

  it('renders enabled markdown post processors through the markdown host API', async () => {
    writePlugin(
      'post-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class PostPlugin extends Plugin {
          onload() {
            this.registerMarkdownPostProcessor((el, ctx) => {
              const heading = el.querySelector('h1')?.textContent || 'Untitled';
              el.createDiv({ text: 'Processed ' + ctx.sourcePath + ': ' + heading });
            });
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'post-plugin' }));

    const { POST } = await importMarkdownPostProcessorsRoute();
    const res = await POST(markdownPostProcessorsPostRequest({
      markdown: '# Research note\n\nBody',
      sourcePath: 'notes/research.md',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.renders).toEqual([
      {
        processorId: 'post-plugin:post:1',
        pluginId: 'post-plugin',
        pluginName: 'post-plugin',
        text: 'Processed notes/research.md: Research note',
      },
    ]);
  });

  it('rejects markdown post processor render requests without markdown', async () => {
    const { POST } = await importMarkdownPostProcessorsRoute();
    const res = await POST(markdownPostProcessorsPostRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Missing markdown');
  });
});
