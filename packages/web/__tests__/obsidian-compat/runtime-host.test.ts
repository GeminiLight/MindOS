import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginLoader } from '@/lib/obsidian-compat/loader';

let mindRoot: string;

const writePlugin = (pluginId: string, mainJs: string) => {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
};

describe('ObsidianRuntimeHost', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-runtime-host-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('records plugin registrations that are not mounted in the MindOS UI yet', async () => {
    writePlugin(
      'runtime-plugin',
      `
        const { Plugin, ItemView } = require('obsidian');
        module.exports = class RuntimePlugin extends Plugin {
          onload() {
            this.addRibbonIcon('calendar', 'Open calendar', () => {});
            this.addStatusBarItem().setText('Ready');
            this.registerMarkdownPostProcessor(() => {});
            this.registerMarkdownCodeBlockProcessor('tasks', () => {});
            this.registerEditorExtension([]);
            this.registerView('calendar-view', () => new ItemView());
            this.registerExtensions(['calendar', '.ics', 'calendar'], 'calendar-view');
            this.app.workspace.onLayoutReady(() => {
              this.app.workspace.openLinkText('Home', '');
            });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('runtime-plugin');
    const host = loader.getApp().getRuntimeHost();

    expect(host.getRibbonIcons()).toHaveLength(1);
    expect(host.getStatusBarItems()).toHaveLength(1);
    expect(host.getMarkdownPostProcessors()).toHaveLength(1);
    expect(host.getMarkdownCodeBlockProcessors()).toMatchObject([{ pluginId: 'runtime-plugin', language: 'tasks' }]);
    expect(host.getEditorExtensions()).toMatchObject([{
      id: 'runtime-plugin:editor:1',
      pluginId: 'runtime-plugin',
      summary: {
        kind: 'array',
        valueType: 'array',
        serializable: true,
        count: 0,
        constructorName: 'Array',
        mountStatus: 'catalog-only',
        capabilityGate: 'browser-editor-extension-host',
        mountReason: expect.stringContaining('per-plugin editor sandbox'),
        autoMount: false,
      },
    }]);
    expect(host.getViews()).toMatchObject([{ pluginId: 'runtime-plugin', type: 'calendar-view' }]);
    expect(host.getViewExtensions()).toEqual([{
      pluginId: 'runtime-plugin',
      viewType: 'calendar-view',
      extensions: ['calendar', 'ics'],
    }]);
    expect(host.getWorkspaceOpenRequests()).toEqual([{ linktext: 'Home', sourcePath: '', openState: undefined }]);
    expect(host.getWarnings().map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'editor-extension-recorded-only',
      'file-extension-registration-recorded-only',
      'view-registered-without-native-host',
    ]));
  });

  it('summarizes registered editor extensions for the metadata catalog', async () => {
    writePlugin(
      'editor-catalog-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class EditorCatalogPlugin extends Plugin {
          onload() {
            this.registerEditorExtension({ name: 'plain-extension', enabled: true });
            this.registerEditorExtension(() => {});
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('editor-catalog-plugin');

    expect(loader.getApp().getRuntimeHost().getEditorExtensions()).toMatchObject([
      {
        id: 'editor-catalog-plugin:editor:1',
        pluginId: 'editor-catalog-plugin',
        summary: {
          kind: 'object',
          valueType: 'object',
          serializable: true,
          constructorName: 'Object',
          keys: ['name', 'enabled'],
          mountStatus: 'catalog-only',
          capabilityGate: 'browser-editor-extension-host',
          mountReason: expect.stringContaining('per-plugin editor sandbox'),
          autoMount: false,
        },
      },
      {
        id: 'editor-catalog-plugin:editor:2',
        pluginId: 'editor-catalog-plugin',
        summary: {
          kind: 'function',
          valueType: 'function',
          serializable: false,
          mountStatus: 'catalog-only',
          capabilityGate: 'browser-editor-extension-host',
          mountReason: expect.stringContaining('per-plugin editor sandbox'),
          autoMount: false,
        },
      },
    ]);
  });

  it('cleans plugin runtime registrations on unload', async () => {
    writePlugin(
      'cleanup-runtime-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class CleanupRuntimePlugin extends Plugin {
          onload() {
            this.addRibbonIcon('icon', 'Title', () => {});
            this.registerExtensions(['mind'], 'mind-view');
            this.registerMarkdownPostProcessor(() => {});
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('cleanup-runtime-plugin');
    expect(loader.getApp().getRuntimeHost().getRibbonIcons()).toHaveLength(1);

    await loader.unloadPlugin('cleanup-runtime-plugin');

    expect(loader.getApp().getRuntimeHost().getRibbonIcons()).toHaveLength(0);
    expect(loader.getApp().getRuntimeHost().getViewExtensions()).toHaveLength(0);
    expect(loader.getApp().getRuntimeHost().getMarkdownPostProcessors()).toHaveLength(0);
  });

  it('executes recorded ribbon callbacks by plugin and index', async () => {
    writePlugin(
      'ribbon-runtime-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class RibbonRuntimePlugin extends Plugin {
          onload() {
            this.addRibbonIcon('sparkles', 'Capture', async () => {
              await this.app.vault.create('notes/from-runtime-ribbon.md', 'captured');
            });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('ribbon-runtime-plugin');

    await loader.getApp().getRuntimeHost().executeRibbonIcon('ribbon-runtime-plugin', 0);

    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'from-runtime-ribbon.md'), 'utf-8')).toBe('captured');
  });

  it('records notice snapshots from executed ribbon callbacks and cleans them on unload', async () => {
    writePlugin(
      'notice-runtime-plugin',
      `
        const { Notice, Plugin } = require('obsidian');
        module.exports = class NoticeRuntimePlugin extends Plugin {
          onload() {
            this.addRibbonIcon('sparkles', 'Save', () => {
              new Notice('Saved from ribbon', 1200);
            });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('notice-runtime-plugin');
    const host = loader.getApp().getRuntimeHost();

    const offset = host.getNoticeSnapshotCount();
    await host.executeRibbonIcon('notice-runtime-plugin', 0);

    expect(host.renderNoticeSnapshotsSince(offset)).toEqual([{
      id: 'notice-runtime-plugin:notice:1',
      pluginId: 'notice-runtime-plugin',
      message: 'Saved from ribbon',
      timeout: 1200,
      level: 'success',
    }]);

    await loader.unloadPlugin('notice-runtime-plugin');

    expect(host.renderNoticeSnapshotsSince(0)).toEqual([]);
  });

  it('renders markdown code block processor output as a text snapshot', async () => {
    writePlugin(
      'markdown-runtime-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class MarkdownRuntimePlugin extends Plugin {
          onload() {
            this.registerMarkdownCodeBlockProcessor('tasks', (source, el) => {
              el.createDiv({ text: 'Rendered task list' });
              el.createDiv({ text: source.trim() });
            });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('markdown-runtime-plugin');
    const processorId = loader.getApp().getRuntimeHost().getMarkdownCodeBlockProcessors()[0]?.id;
    if (!processorId) throw new Error('Expected markdown processor registration');

    const snapshot = await loader.getApp().getRuntimeHost().renderMarkdownCodeBlock(
      processorId,
      '- [ ] Review plugin hooks',
    );

    expect(snapshot).toEqual({
      processorId: 'markdown-runtime-plugin:tasks:1',
      pluginId: 'markdown-runtime-plugin',
      language: 'tasks',
      text: 'Rendered task list\n- [ ] Review plugin hooks',
    });
  });

  it('renders the exact markdown code block processor registration for duplicate languages', async () => {
    writePlugin(
      'duplicate-markdown-runtime-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class DuplicateMarkdownRuntimePlugin extends Plugin {
          onload() {
            this.registerMarkdownCodeBlockProcessor('tasks', (_source, el) => {
              el.createDiv({ text: 'first renderer' });
            });
            this.registerMarkdownCodeBlockProcessor('tasks', (_source, el) => {
              el.createDiv({ text: 'second renderer' });
            });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('duplicate-markdown-runtime-plugin');
    const host = loader.getApp().getRuntimeHost();
    const processors = host.getMarkdownCodeBlockProcessors();

    const snapshots = await Promise.all(processors.map((processor) => (
      host.renderMarkdownCodeBlock(processor.id, '- [ ] Review plugin hooks')
    )));

    expect(snapshots.map((snapshot) => snapshot.text)).toEqual([
      'first renderer',
      'second renderer',
    ]);
  });

  it('renders markdown post processor output as a text snapshot', async () => {
    writePlugin(
      'post-runtime-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class PostRuntimePlugin extends Plugin {
          onload() {
            this.registerMarkdownPostProcessor((el, ctx) => {
              const heading = el.querySelector('h1')?.textContent || 'Untitled';
              el.createDiv({ text: 'Post processed ' + ctx.sourcePath + ': ' + heading });
            });
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('post-runtime-plugin');
    const processorId = loader.getApp().getRuntimeHost().getMarkdownPostProcessors()[0]?.id;
    if (!processorId) throw new Error('Expected markdown post processor registration');

    const snapshot = await loader.getApp().getRuntimeHost().renderMarkdownPostProcessor(
      processorId,
      '# Research note\n\nBody',
      'notes/research.md',
    );

    expect(snapshot).toEqual({
      processorId: 'post-runtime-plugin:post:1',
      pluginId: 'post-runtime-plugin',
      text: 'Post processed notes/research.md: Research note',
    });
  });

  it('opens registered ItemView snapshots through the compatibility view host', async () => {
    writePlugin(
      'view-runtime-plugin',
      `
        const { Plugin, ItemView } = require('obsidian');

        class CalendarView extends ItemView {
          getViewType() {
            return 'calendar-view';
          }

          getDisplayText() {
            return 'Calendar';
          }

          onOpen() {
            this.contentEl.setText('Calendar ready');
          }
        }

        module.exports = class ViewRuntimePlugin extends Plugin {
          onload() {
            this.registerView('calendar-view', (leaf) => new CalendarView(leaf));
          }
        };
      `,
    );

    const loader = new PluginLoader(mindRoot);
    await loader.loadPlugin('view-runtime-plugin');
    const app = loader.getApp();
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: 'calendar-view', state: { pluginId: 'view-runtime-plugin' } });

    const snapshot = await app.getRuntimeHost().renderView('view-runtime-plugin', 'calendar-view', leaf);

    expect(snapshot).toMatchObject({
      pluginId: 'view-runtime-plugin',
      viewType: 'calendar-view',
      resolvedViewType: 'calendar-view',
      displayText: 'Calendar',
      className: 'CalendarView',
      text: 'Calendar ready',
    });
  });
});
