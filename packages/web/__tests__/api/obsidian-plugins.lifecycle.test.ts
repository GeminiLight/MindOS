import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  postRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('/api/obsidian-plugins lifecycle', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('lists discovered plugins with compatibility state', async () => {
    writePlugin('list-plugin', `const { Plugin } = require('obsidian'); module.exports = class ListPlugin extends Plugin {};`);

    const { GET } = await importLifecycleRoute();
    const res = await GET(new NextRequest('http://localhost/api/obsidian-plugins'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.plugins).toEqual([
      expect.objectContaining({
        id: 'list-plugin',
        enabled: false,
        loaded: false,
        compatibilityLevel: 'compatible',
      }),
    ]);
  });

  it('enables and loads a lightweight plugin, returning runtime summary', async () => {
    writePlugin(
      'run-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class RunPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'hello', name: 'Hello', callback: () => {} });
            this.registerMarkdownCodeBlockProcessor('tasks', () => {});
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    let res = await POST(postRequest({ action: 'enable', pluginId: 'run-plugin' }));
    expect(res.status).toBe(200);

    res = await POST(postRequest({ action: 'load-enabled' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result).toEqual({ loaded: ['run-plugin'], failed: [], skipped: [] });
    expect(json.plugins[0]).toMatchObject({
      id: 'run-plugin',
      enabled: true,
      loaded: true,
      runtime: {
        commands: 1,
        commandList: [{ id: 'hello', fullId: 'obsidian:run-plugin:hello', name: 'Hello' }],
        markdownCodeBlockProcessors: 1,
      },
    });
  });

  it('returns editor extension capability gate metadata in the runtime summary', async () => {
    writePlugin(
      'editor-gate-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class EditorGatePlugin extends Plugin {
          onload() {
            this.registerEditorExtension({ name: 'gate-extension' });
          }
        };
      `,
    );

    const { GET, POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'editor-gate-plugin' }));
    const res = await GET(new NextRequest('http://localhost/api/obsidian-plugins?loadEnabled=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plugins[0]).toMatchObject({
      id: 'editor-gate-plugin',
      loaded: true,
      runtime: {
        editorExtensions: 1,
        editorExtensionList: [expect.objectContaining({
          id: 'editor-gate-plugin:editor:1',
          kind: 'object',
          constructorName: 'Object',
          serializable: true,
          mountStatus: 'catalog-only',
          capabilityGate: 'browser-editor-extension-host',
          mountReason: expect.stringContaining('per-plugin editor sandbox'),
          autoMount: false,
        })],
      },
    });
  });

  it('keeps enabled plugins loaded across repeated lifecycle API requests', async () => {
    writePlugin(
      'persistent-api-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class PersistentApiPlugin extends Plugin {
          async onload() {
            const data = await this.loadData() || { count: 0 };
            data.count = (data.count || 0) + 1;
            await this.saveData(data);
            this.addStatusBarItem().setText('api loaded ' + data.count);
          }
        };
      `,
    );

    const { GET, POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'persistent-api-plugin' }));
    await GET(new NextRequest('http://localhost/api/obsidian-plugins?loadEnabled=1'));
    const res = await GET(new NextRequest('http://localhost/api/obsidian-plugins?loadEnabled=1'));
    const json = await res.json();
    const data = JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', 'persistent-api-plugin', 'data.json'), 'utf-8'));

    expect(res.status).toBe(200);
    expect(data).toEqual({ count: 1 });
    expect(json.plugins[0]).toMatchObject({
      id: 'persistent-api-plugin',
      loaded: true,
      runtime: {
        statusBarItems: 1,
        statusBarItemList: [{ text: 'api loaded 1' }],
      },
    });
  });

  it('uninstalls an imported plugin through the lifecycle API without touching other plugins', async () => {
    writePlugin('remove-api-plugin', `const { Plugin } = require('obsidian'); module.exports = class RemoveApiPlugin extends Plugin {};`);
    writePlugin('keep-api-plugin', `const { Plugin } = require('obsidian'); module.exports = class KeepApiPlugin extends Plugin {};`);

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'remove-api-plugin' }));
    await POST(postRequest({ action: 'load-enabled' }));
    const res = await POST(postRequest({ action: 'uninstall', pluginId: 'remove-api-plugin' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'remove-api-plugin'))).toBe(false);
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'keep-api-plugin'))).toBe(true);
    expect(json.plugins.map((plugin: { id: string }) => plugin.id)).toEqual(['keep-api-plugin']);
    const state = JSON.parse(fs.readFileSync(path.join(mindRoot, '.plugins', '.plugin-manager.json'), 'utf-8'));
    expect(state.enabled).toEqual({});
  });

  it('skips blocked plugins during load-enabled without aborting compatible plugins', async () => {
    writePlugin('good-plugin', `const { Plugin } = require('obsidian'); module.exports = class Good extends Plugin {};`);
    writePlugin(
      'fs-plugin',
      `const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class FsPlugin extends Plugin {};`,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'good-plugin' }));
    await POST(postRequest({ action: 'enable', pluginId: 'fs-plugin' }));

    const res = await POST(postRequest({ action: 'load-enabled' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.loaded).toEqual(['good-plugin']);
    expect(json.result.skipped).toEqual(['fs-plugin']);
    expect(json.plugins.find((plugin: { id: string }) => plugin.id === 'fs-plugin')).toMatchObject({
      compatibilityLevel: 'blocked',
      loaded: false,
      lastError: 'Requires unsupported runtime module: fs',
    });
  });
});
