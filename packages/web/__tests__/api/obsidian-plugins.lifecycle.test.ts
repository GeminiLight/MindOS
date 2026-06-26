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
import { resetObsidianPluginRuntimeServicesForTests } from '@/lib/obsidian-compat/runtime-service';

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
        packageLocation: expect.objectContaining({
          relativePath: '.plugins/list-plugin',
          legacy: true,
          migrationAvailable: true,
        }),
        coverageSummary: expect.any(Object),
      }),
    ]);
  });

  it('migrates a legacy plugin package through the lifecycle API', async () => {
    writePlugin('legacy-api-plugin', `const { Plugin } = require('obsidian'); module.exports = class LegacyApiPlugin extends Plugin {};`);

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'legacy-api-plugin' }));
    const res = await POST(postRequest({ action: 'migrate-legacy', pluginId: 'legacy-api-plugin' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toMatchObject({
      migrated: true,
      sourceRelativePath: '.plugins/legacy-api-plugin',
      targetRelativePath: '.mindos/plugins/legacy-api-plugin',
    });
    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'legacy-api-plugin'))).toBe(false);
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'plugins', 'legacy-api-plugin', 'manifest.json'))).toBe(true);
    expect(json.plugins[0]).toMatchObject({
      id: 'legacy-api-plugin',
      enabled: true,
      packageLocation: {
        relativePath: '.mindos/plugins/legacy-api-plugin',
        rootRelativePath: '.mindos/plugins',
        legacy: false,
        migrationAvailable: false,
      },
    });
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
      capabilityLedger: expect.arrayContaining([
        expect.objectContaining({
          capability: 'addCommand',
          phase: 'predicted',
        }),
        expect.objectContaining({
          capability: 'addCommand',
          phase: 'registered',
        }),
        expect.objectContaining({
          capability: 'registerMarkdownCodeBlockProcessor',
          phase: 'registered',
        }),
      ]),
      runtime: {
        commands: 1,
        commandList: [{ id: 'hello', fullId: 'obsidian:run-plugin:hello', name: 'Hello' }],
        markdownCodeBlockProcessors: 1,
        capabilityLedger: expect.arrayContaining([
          expect.objectContaining({
            capability: 'addCommand',
            phase: 'registered',
          }),
          expect.objectContaining({
            capability: 'registerMarkdownCodeBlockProcessor',
            phase: 'registered',
          }),
        ]),
      },
    });
  });

  it('returns persisted runtime capability history after runtime service reset', async () => {
    writePlugin(
      'quickadd',
      `
        const { Plugin } = require('obsidian');
        module.exports = class QuickAddPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'capture', name: 'Capture', callback: () => {} });
          }
        };
      `,
    );

    const { GET, POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'quickadd' }));
    await POST(postRequest({ action: 'load-enabled' }));
    await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:quickadd:capture' }));

    resetObsidianPluginRuntimeServicesForTests();

    const res = await GET(new NextRequest('http://localhost/api/obsidian-plugins'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plugins[0]).toMatchObject({
      id: 'quickadd',
      loaded: false,
      runtime: {
        capabilityLedger: [],
      },
      capabilityLedgerHistory: {
        total: 2,
        summary: expect.objectContaining({
          registered: 1,
          called: 1,
        }),
      },
      workflowAudits: [
        expect.objectContaining({
          id: 'quickadd-capture-macro',
          status: 'partial',
          source: 'runtime-ledger',
          nextStep: expect.stringContaining('Run the workflow probe'),
        }),
      ],
    });
  });

  it('requires capability confirmation before enabling network-capable plugins', async () => {
    writePlugin(
      'network-api-plugin',
      `
        const { Plugin, requestUrl } = require('obsidian');
        module.exports = class NetworkApiPlugin extends Plugin {
          onload() {
            requestUrl('https://example.com/api');
          }
        };
      `,
    );

    const { GET, POST } = await importLifecycleRoute();
    let res = await POST(postRequest({ action: 'enable', pluginId: 'network-api-plugin' }));
    let json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({
      ok: false,
      error: 'Obsidian plugin enable requires capability confirmation.',
      capabilityGate: {
        status: 'review',
        requiresConfirmation: true,
        confirmed: false,
      },
    });
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'))).toBe(false);

    const listRes = await GET(new NextRequest('http://localhost/api/obsidian-plugins'));
    const listJson = await listRes.json();
    expect(listRes.status).toBe(200);
    expect(listJson.plugins[0]).toMatchObject({
      id: 'network-api-plugin',
      enabled: false,
      capabilityLedgerHistory: {
        total: 1,
        summary: expect.objectContaining({
          denied: 1,
          blocked: 0,
        }),
      },
    });

    res = await POST(postRequest({
      action: 'enable',
      pluginId: 'network-api-plugin',
      confirmCapabilityGate: true,
    }));
    json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plugins[0]).toMatchObject({
      id: 'network-api-plugin',
      enabled: true,
      capabilityGate: {
        status: 'limited',
        requiresConfirmation: true,
        confirmed: true,
      },
    });
    const state = JSON.parse(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'), 'utf-8'));
    expect(state.capabilityConfirmations['network-api-plugin']).toMatchObject({
      surfaces: ['network'],
      fingerprint: expect.any(String),
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
          sandbox: expect.objectContaining({
            phase: 'p3a-browser-editor-sandbox',
            target: 'codemirror-extension',
            host: 'browser-codemirror-sandbox',
            status: 'requires-browser-sandbox',
            transferable: true,
            permissionGate: 'browser-editor-extension-host',
            canAutoMount: false,
            cleanupRequired: true,
            requiredPermissions: ['editor.read', 'editor.write', 'editor.selection', 'editor.decorations'],
          }),
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
    const state = JSON.parse(fs.readFileSync(path.join(mindRoot, '.mindos', 'plugins', '.plugin-manager.json'), 'utf-8'));
    expect(state.enabled).toEqual({});
  });

  it('rejects newly enabling blocked plugins without aborting compatible plugin loads', async () => {
    writePlugin('good-plugin', `const { Plugin } = require('obsidian'); module.exports = class Good extends Plugin {};`);
    writePlugin(
      'fs-plugin',
      `const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class FsPlugin extends Plugin {};`,
    );

    const { POST } = await importLifecycleRoute();
    await POST(postRequest({ action: 'enable', pluginId: 'good-plugin' }));
    const blockedEnable = await POST(postRequest({ action: 'enable', pluginId: 'fs-plugin', confirmCapabilityGate: true }));
    expect(blockedEnable.status).toBe(400);
    await expect(blockedEnable.json()).resolves.toEqual({
      error: 'Requires unsupported runtime module: fs',
    });

    const res = await POST(postRequest({ action: 'load-enabled' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.loaded).toEqual(['good-plugin']);
    expect(json.result.skipped).toEqual([]);
    expect(json.plugins.find((plugin: { id: string }) => plugin.id === 'fs-plugin')).toMatchObject({
      compatibilityLevel: 'blocked',
      enabled: false,
      loaded: false,
    });
  });
});
