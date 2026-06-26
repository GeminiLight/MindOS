import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  importViewsRoute,
  postRequest,
  viewGetRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('/api/obsidian-plugins views', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('opens an enabled plugin view through the view API', async () => {
    writePlugin(
      'view-plugin',
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
            this.contentEl.createDiv({ text: 'Calendar ready' });
          }
        }
        module.exports = class ViewPlugin extends Plugin {
          onload() {
            this.registerView('calendar-view', (leaf) => new CalendarView(leaf));
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'view-plugin' }));

    const { GET } = await importViewsRoute();
    const res = await GET(viewGetRequest({ pluginId: 'view-plugin', viewType: 'calendar-view' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.view).toMatchObject({
      pluginId: 'view-plugin',
      viewType: 'calendar-view',
      resolvedViewType: 'calendar-view',
      displayText: 'Calendar',
      text: 'Calendar ready',
    });
  });

  it('provides app access to ItemView subclasses during view rendering', async () => {
    writePlugin(
      'view-app-plugin',
      `
        const { Plugin, ItemView } = require('obsidian');
        class AppAwareView extends ItemView {
          getViewType() {
            return 'app-aware-view';
          }
          getDisplayText() {
            return 'App aware';
          }
          onOpen() {
            this.contentEl.createDiv({ text: this.app && this.app.workspace ? 'workspace-ready' : 'workspace-missing' });
          }
        }
        module.exports = class ViewAppPlugin extends Plugin {
          onload() {
            this.registerView('app-aware-view', (leaf) => new AppAwareView(leaf));
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'view-app-plugin' }));

    const { GET } = await importViewsRoute();
    const res = await GET(viewGetRequest({ pluginId: 'view-app-plugin', viewType: 'app-aware-view' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.view.text).toBe('workspace-ready');
  });

  it('opens plugin views with active file context when sourcePath is provided', async () => {
    fs.mkdirSync(path.join(mindRoot, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'projects', 'roadmap.kanban'), '- Todo', 'utf-8');
    writePlugin(
      'file-view-plugin',
      `
        const { Plugin, ItemView } = require('obsidian');
        module.exports = class FileViewPlugin extends Plugin {
          onload() {
            const app = this.app;
            this.registerView('kanban-board', (leaf) => {
              class KanbanView extends ItemView {
                getViewType() {
                  return 'kanban-board';
                }
                getDisplayText() {
                  return 'Kanban Board';
                }
                onOpen() {
                  const activeFile = app.workspace.getActiveFile();
                  const state = this.leaf.getViewState().state || {};
                  this.contentEl.createDiv({ text: 'active:' + (activeFile ? activeFile.path : 'none') });
                  this.contentEl.createDiv({ text: 'state:' + (state.sourcePath || 'none') });
                  this.contentEl.createDiv({ text: 'file:' + (state.file ? state.file.path : 'none') });
                }
              }
              return new KanbanView(leaf);
            });
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'file-view-plugin' }));

    const { GET } = await importViewsRoute();
    const res = await GET(viewGetRequest({
      pluginId: 'file-view-plugin',
      viewType: 'kanban-board',
      sourcePath: 'projects/roadmap.kanban',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.view).toMatchObject({
      pluginId: 'file-view-plugin',
      viewType: 'kanban-board',
      resolvedViewType: 'kanban-board',
      displayText: 'Kanban Board',
      sourcePath: 'projects/roadmap.kanban',
      file: {
        path: 'projects/roadmap.kanban',
        name: 'roadmap.kanban',
        basename: 'roadmap',
        extension: 'kanban',
      },
    });
    expect(json.view.text).toContain('active:projects/roadmap.kanban');
    expect(json.view.text).toContain('state:projects/roadmap.kanban');
    expect(json.view.text).toContain('file:projects/roadmap.kanban');
  });

  it('opens plugin views without active file context when sourcePath is omitted', async () => {
    writePlugin(
      'generic-view-plugin',
      `
        const { Plugin, ItemView } = require('obsidian');
        module.exports = class GenericViewPlugin extends Plugin {
          onload() {
            const app = this.app;
            this.registerView('generic-view', (leaf) => {
              class GenericView extends ItemView {
                getViewType() {
                  return 'generic-view';
                }
                getDisplayText() {
                  return 'Generic View';
                }
                onOpen() {
                  const activeFile = app.workspace.getActiveFile();
                  const state = this.leaf.getViewState().state || {};
                  this.contentEl.createDiv({ text: 'active:' + (activeFile ? activeFile.path : 'none') });
                  this.contentEl.createDiv({ text: 'state:' + (state.sourcePath || 'none') });
                }
              }
              return new GenericView(leaf);
            });
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'generic-view-plugin' }));

    const { GET } = await importViewsRoute();
    const res = await GET(viewGetRequest({ pluginId: 'generic-view-plugin', viewType: 'generic-view' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.view.sourcePath).toBeUndefined();
    expect(json.view.file).toBeUndefined();
    expect(json.view.text).toContain('active:none');
    expect(json.view.text).toContain('state:none');
  });

  it('rejects plugin view sourcePath values that do not resolve to an existing vault file', async () => {
    writePlugin(
      'missing-file-view-plugin',
      `
        const { Plugin, ItemView } = require('obsidian');
        module.exports = class MissingFileViewPlugin extends Plugin {
          onload() {
            this.registerView('missing-file-view', (leaf) => new ItemView(leaf));
          }
        };
      `,
    );

    const lifecycle = await importLifecycleRoute();
    await lifecycle.POST(postRequest({ action: 'enable', pluginId: 'missing-file-view-plugin' }));

    const { GET } = await importViewsRoute();
    const res = await GET(viewGetRequest({
      pluginId: 'missing-file-view-plugin',
      viewType: 'missing-file-view',
      sourcePath: 'notes/missing.kanban',
    }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('Plugin view source file not found: notes/missing.kanban');
  });

  it('rejects plugin view requests without required query params', async () => {
    const { GET } = await importViewsRoute();
    const res = await GET(viewGetRequest({ pluginId: 'view-plugin' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Missing viewType');
  });
});
