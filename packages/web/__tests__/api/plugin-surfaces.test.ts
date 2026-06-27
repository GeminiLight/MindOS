import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

let mindRoot: string;
const testState = vi.hoisted(() => ({ mindRoot: '' }));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ mindRoot: testState.mindRoot }),
}));

function writePlugin(pluginId: string, mainJs: string, manifest: Record<string, unknown> = {}) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: 'Surface Plugin', version: '1.0.0', ...manifest }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
}

function writePluginStyle(pluginId: string, css: string) {
  fs.writeFileSync(path.join(mindRoot, '.plugins', pluginId, 'styles.css'), css, 'utf-8');
}

function writeObsidianImportConfig(pluginId: string, config: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(mindRoot, '.plugins', pluginId, 'obsidian-import.json'),
    JSON.stringify({ schemaVersion: 1, source: 'obsidian', pluginId, ...config }, null, 2),
    'utf-8',
  );
}

function enablePlugin(...pluginIds: string[]) {
  fs.mkdirSync(path.join(mindRoot, '.plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(mindRoot, '.plugins', '.plugin-manager.json'),
    JSON.stringify({ enabled: Object.fromEntries(pluginIds.map((pluginId) => [pluginId, true])) }, null, 2),
    'utf-8',
  );
}

function writeRuntimeExtension(extensionId = 'aion-style-pack') {
  const extensionDir = path.join(mindRoot, '.mindos', 'runtime-extensions', extensionId);
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    JSON.stringify({
      id: extensionId,
      name: 'Aion Style Pack',
      version: '0.1.0',
      contributes: {
        acpAdapters: [
          {
            id: 'ext-buddy',
            name: 'External Buddy',
            description: 'Extension-provided ACP adapter.',
            cliCommand: 'codebuddy',
            acpArgs: ['--acp'],
            supportsStreaming: true,
          },
        ],
        commands: [
          { id: 'explain', title: 'Explain Selection', slash: '/explain', runtimeId: 'ext-buddy' },
        ],
        mcpServers: [
          { id: 'docs', name: 'Docs MCP', type: 'stdio', command: 'mcp-docs' },
        ],
        assistants: [
          { id: 'reviewer', name: 'Reviewer', prompt: '$file:prompts/reviewer.md' },
        ],
        agents: [
          { id: 'planner', name: 'Planner', command: 'planner-agent', args: ['--json'] },
        ],
        skills: [
          { id: 'review', name: 'Review Skill', entry: '$file:skills/review/SKILL.md' },
        ],
        themes: [
          { name: 'Warm Runtime' },
        ],
        settingsTabs: [
          { title: 'Runtime Settings' },
        ],
      },
    }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(extensionDir, 'mindos-runtime-extension.json'),
    JSON.stringify({
      schemaVersion: 1,
      source: 'agent-runtime-extension',
      extensionId,
      version: '0.1.0',
      installedAt: '2026-06-27T00:00:00.000Z',
      contributionCounts: {
        acpAdapters: 1,
        mcpServers: 1,
        assistants: 1,
        agents: 1,
        skills: 1,
        commands: 1,
        themes: 1,
        settingsTabs: 1,
      },
      appliedAcpAgents: ['ext-buddy'],
      lifecycleScriptsDeclared: 0,
    }, null, 2),
    'utf-8',
  );
}

async function importRoute() {
  return import('../../app/api/plugins/surfaces/route');
}

describe('/api/plugins/surfaces', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-plugin-surfaces-api-'));
    testState.mindRoot = mindRoot;
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('maps Obsidian runtime registrations to MindOS plugin surfaces', async () => {
    writePlugin(
      'surface-plugin',
      `
        const { Plugin, PluginSettingTab, Setting } = require('obsidian');
        class SurfaceSettings extends PluginSettingTab {
          display() {
            new Setting(this).setName('Enabled').addToggle((toggle) => toggle.setValue(true));
          }
        }
        module.exports = class SurfacePlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'run',
              name: 'Run Surface',
              hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'r' }],
              callback: () => {},
            });
            this.addSettingTab(new SurfaceSettings(this.app, this));
            this.addRibbonIcon('sparkles', 'Run from ribbon', () => {});
            this.addStatusBarItem().setText('Surface ready');
            this.registerView('surface-view', () => ({}));
            this.registerExtensions(['surface', '.mind'], 'surface-view');
            this.registerMarkdownCodeBlockProcessor('surface', () => {});
            this.registerMarkdownPostProcessor(() => {});
            this.registerEditorExtension({ name: 'surface-extension' });
          }
        };
      `,
    );
    writePluginStyle('surface-plugin', '.surface-plugin { display: block; }');
    enablePlugin('surface-plugin');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({ loaded: ['surface-plugin'], failed: [], skipped: [] });
    expect(json.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'command',
        location: 'command-center',
        availability: 'available',
        title: 'Run Surface',
        host: expect.objectContaining({ state: 'mounted', label: 'Command Center' }),
        action: { type: 'obsidian-command', commandId: 'obsidian:surface-plugin:run' },
        metadata: expect.objectContaining({
          hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'r' }],
          hotkeyPolicy: {
            binding: 'user-confirmable',
            status: 'ready',
            reason: expect.stringContaining('user confirmation'),
            conflicts: [],
          },
          supportKind: 'limited',
          supportLabel: 'Limited',
          importable: true,
        }),
      }),
      expect.objectContaining({ kind: 'settings', location: 'settings', availability: 'available', host: expect.objectContaining({ state: 'mounted' }) }),
      expect.objectContaining({
        kind: 'ribbon',
        location: 'plugin-actions',
        availability: 'available',
        title: 'Run from ribbon',
        host: expect.objectContaining({ state: 'mounted' }),
        action: { type: 'obsidian-ribbon', pluginId: 'surface-plugin', ribbonIndex: 0 },
      }),
      expect.objectContaining({ kind: 'status', location: 'status-bar', availability: 'recorded', title: 'Surface ready', host: expect.objectContaining({ state: 'mounted' }) }),
      expect.objectContaining({
        kind: 'view',
        location: 'plugin-views',
        availability: 'available',
        title: 'surface-view',
        host: expect.objectContaining({ state: 'mounted', label: 'Plugin View host' }),
        action: { type: 'obsidian-view', pluginId: 'surface-plugin', viewType: 'surface-view' },
        metadata: expect.objectContaining({
          fileExtensions: ['mind', 'surface'],
        }),
      }),
      expect.objectContaining({ kind: 'markdown', location: 'document', availability: 'available', title: '```surface', host: expect.objectContaining({ state: 'mounted', label: 'Document rendering host' }) }),
      expect.objectContaining({
        kind: 'style',
        location: 'plugin-assets',
        availability: 'available',
        title: 'Surface Plugin stylesheet',
        host: expect.objectContaining({ state: 'mounted', label: 'Scoped stylesheet host' }),
        metadata: expect.objectContaining({
          path: 'styles.css',
          injectionPolicy: 'scoped-plugin-view',
          scope: 'plugin-view-host',
          globalInjection: false,
        }),
      }),
      expect.objectContaining({ kind: 'markdown', location: 'document', availability: 'available', title: 'Surface Plugin markdown post processors', host: expect.objectContaining({ state: 'mounted', label: 'Document rendering host' }) }),
      expect.objectContaining({
        kind: 'editor',
        location: 'editor',
        availability: 'recorded',
        host: expect.objectContaining({
          state: 'catalog',
          label: 'Editor capability gate',
        }),
        metadata: expect.objectContaining({
          count: 1,
          mountPolicy: 'catalog-only',
          capabilityGate: expect.objectContaining({
            capability: 'browser-editor-extension-host',
            status: 'required',
            autoEnable: false,
          }),
          editorExtensions: [expect.objectContaining({
            id: 'surface-plugin:editor:1',
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
            }),
          })],
          browserEditorSandbox: expect.objectContaining({
            phase: 'p3a-browser-editor-sandbox',
            host: 'browser-codemirror-sandbox',
            status: 'requires-browser-sandbox',
            registrations: 1,
            transferableRegistrations: 1,
            cleanupRequired: true,
            canAutoMount: false,
            permissionGate: 'browser-editor-extension-host',
            requirements: expect.arrayContaining([
              'per-plugin browser editor sandbox',
              'explicit user permission gate',
              'deterministic unload cleanup for extensions, keymaps, suggestions, and decorations',
            ]),
          }),
        }),
      }),
    ]));
    expect(json.counts.surfaces).toBeGreaterThanOrEqual(7);
  });

  it('maps Obsidian command availability without exposing editor-only commands as actions', async () => {
    writePlugin(
      'command-availability',
      `
        const { Plugin } = require('obsidian');
        module.exports = class CommandAvailabilityPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'callback', name: 'Callback command', callback: () => {} });
            this.addCommand({
              id: 'checked',
              name: 'Checked command',
              checkCallback: (checking) => checking ? true : undefined,
            });
            this.addCommand({
              id: 'hidden',
              name: 'Hidden command',
              checkCallback: (checking) => checking ? false : undefined,
            });
            this.addCommand({
              id: 'editor',
              name: 'Editor command',
              editorCallback: () => {},
            });
          }
        };
      `,
    );
    enablePlugin('command-availability');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=command'));
    const json = await res.json();
    const commandSurfaces = json.surfaces.filter((surface: { kind: string }) => surface.kind === 'command');

    expect(res.status).toBe(200);
    expect(commandSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Callback command',
        availability: 'available',
        host: expect.objectContaining({ state: 'mounted', label: 'Command Center' }),
        action: { type: 'obsidian-command', commandId: 'obsidian:command-availability:callback' },
        metadata: expect.objectContaining({
          callbackType: 'callback',
          executable: true,
          requiresEditor: false,
        }),
      }),
      expect.objectContaining({
        title: 'Checked command',
        availability: 'available',
        action: { type: 'obsidian-command', commandId: 'obsidian:command-availability:checked' },
        metadata: expect.objectContaining({
          callbackType: 'check-callback',
          executable: true,
        }),
      }),
      expect.objectContaining({
        title: 'Hidden command',
        availability: 'recorded',
        host: expect.objectContaining({ state: 'catalog', label: 'Command catalog' }),
        metadata: expect.objectContaining({
          callbackType: 'check-callback',
          executable: false,
          requiresEditor: false,
        }),
      }),
      expect.objectContaining({
        title: 'Editor command',
        availability: 'recorded',
        host: expect.objectContaining({ state: 'catalog', label: 'Editor command catalog' }),
        metadata: expect.objectContaining({
          callbackType: 'editor-callback',
          executable: false,
          requiresEditor: true,
        }),
      }),
    ]));

    const executableActions = commandSurfaces
      .filter((surface: { availability: string; action?: unknown }) => surface.availability === 'available' && surface.action)
      .map((surface: { title: string }) => surface.title)
      .sort();
    expect(executableActions).toEqual(['Callback command', 'Checked command']);
    expect(commandSurfaces.find((surface: { title: string }) => surface.title === 'Hidden command')?.action).toBeUndefined();
    expect(commandSurfaces.find((surface: { title: string }) => surface.title === 'Editor command')?.action).toBeUndefined();
  });

  it('exposes editor commands as available command surfaces when a Markdown sourcePath is active', async () => {
    fs.mkdirSync(path.join(mindRoot, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'notes', 'current.md'), '# Current', 'utf-8');
    writePlugin(
      'editor-surface-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class EditorSurfacePlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'append',
              name: 'Append editor text',
              editorCallback: (editor) => {
                editor.setValue(editor.getValue() + '\\nupdated');
              },
            });
          }
        };
      `,
    );
    enablePlugin('editor-surface-plugin');

    const { GET } = await importRoute();
    const withoutContext = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=command'));
    const withoutJson = await withoutContext.json();
    expect(withoutJson.surfaces[0]).toMatchObject({
      title: 'Append editor text',
      availability: 'recorded',
      metadata: expect.objectContaining({
        callbackType: 'editor-callback',
        executable: false,
        requiresEditor: true,
      }),
    });
    expect(withoutJson.surfaces[0].action).toBeUndefined();

    const withContext = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=command&sourcePath=notes%2Fcurrent.md'));
    const withJson = await withContext.json();
    expect(withJson.surfaces[0]).toMatchObject({
      title: 'Append editor text',
      availability: 'available',
      host: expect.objectContaining({ state: 'mounted', label: 'Command Center' }),
      action: { type: 'obsidian-command', commandId: 'obsidian:editor-surface-plugin:append' },
      metadata: expect.objectContaining({
        callbackType: 'editor-callback',
        executable: true,
        requiresEditor: true,
      }),
    });
  });

  it('marks Obsidian default hotkeys as display-only and reports conflicts', async () => {
    writePlugin(
      'conflict-a',
      `
        const { Plugin } = require('obsidian');
        module.exports = class ConflictA extends Plugin {
          onload() {
            this.addCommand({
              id: 'open',
              name: 'Open capture',
              hotkeys: [
                { modifiers: ['Mod'], key: 'K' },
                { modifiers: ['Mod', 'Shift'], key: 'C' },
              ],
              callback: () => {},
            });
          }
        };
      `,
      { name: 'Conflict A' },
    );
    writePlugin(
      'conflict-b',
      `
        const { Plugin } = require('obsidian');
        module.exports = class ConflictB extends Plugin {
          onload() {
            this.addCommand({
              id: 'capture',
              name: 'Capture now',
              hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'C' }],
              callback: () => {},
            });
          }
        };
      `,
      { name: 'Conflict B' },
    );
    enablePlugin('conflict-a', 'conflict-b');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=command'));
    const json = await res.json();

    expect(res.status).toBe(200);
    const conflictA = json.surfaces.find((surface: { action?: { commandId?: string } }) => surface.action?.commandId === 'obsidian:conflict-a:open');
    const conflictB = json.surfaces.find((surface: { action?: { commandId?: string } }) => surface.action?.commandId === 'obsidian:conflict-b:capture');

    expect(conflictA?.metadata.hotkeyPolicy).toMatchObject({
      binding: 'display-only',
      status: 'conflict',
    });
    expect(conflictA?.metadata.hotkeyConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Mod+K',
        owner: 'mindos-reserved',
        ownerLabel: 'MindOS Search',
      }),
      expect.objectContaining({
        label: 'Mod+Shift+C',
        owner: 'plugin-command',
        ownerLabel: 'Conflict B: Capture now',
        pluginId: 'conflict-b',
        commandId: 'obsidian:conflict-b:capture',
      }),
    ]));
    expect(conflictB?.metadata.hotkeyPolicy).toMatchObject({
      binding: 'display-only',
      status: 'conflict',
    });
    expect(conflictB?.metadata.hotkeyConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Mod+Shift+C',
        owner: 'plugin-command',
        ownerLabel: 'Conflict A: Open capture',
        pluginId: 'conflict-a',
        commandId: 'obsidian:conflict-a:open',
      }),
    ]));
  });

  it('surfaces imported Obsidian user hotkeys as display-only command metadata', async () => {
    writePlugin(
      'imported-hotkeys',
      `
        const { Plugin } = require('obsidian');
        module.exports = class ImportedHotkeys extends Plugin {
          onload() {
            this.addCommand({
              id: 'capture',
              name: 'Capture imported',
              callback: () => {},
            });
          }
        };
      `,
      { name: 'Imported Hotkeys' },
    );
    writeObsidianImportConfig('imported-hotkeys', {
      enabledInObsidian: true,
      hotkeyCount: 1,
      hotkeys: [{
        commandId: 'imported-hotkeys:capture',
        hotkeys: [{ modifiers: ['Mod'], key: 'K' }],
      }],
    });
    enablePlugin('imported-hotkeys');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=command'));
    const json = await res.json();
    const command = json.surfaces.find((surface: { action?: { commandId?: string } }) => surface.action?.commandId === 'obsidian:imported-hotkeys:capture');

    expect(command?.metadata).toMatchObject({
      hotkeys: [{ modifiers: ['Mod'], key: 'K' }],
      hotkeySources: { default: 0, obsidianImport: 1 },
      hotkeyPolicy: {
        binding: 'display-only',
        status: 'conflict',
      },
    });
    expect(command?.metadata.hotkeyConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Mod+K',
        owner: 'mindos-reserved',
        ownerLabel: 'MindOS Search',
      }),
    ]));
  });

  it('surfaces registerExtensions mappings even when the matching view is missing', async () => {
    writePlugin(
      'extension-only-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class ExtensionOnlyPlugin extends Plugin {
          onload() {
            this.registerExtensions(['kanban', '.board'], 'kanban-view');
          }
        };
      `,
      { name: 'Extension Only' },
    );
    enablePlugin('extension-only-plugin');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=view'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.surfaces).toEqual([expect.objectContaining({
      kind: 'view',
      location: 'plugin-views',
      availability: 'recorded',
      pluginId: 'extension-only-plugin',
      pluginName: 'Extension Only',
      title: 'kanban-view',
      host: expect.objectContaining({
        state: 'diagnostic',
        label: 'Plugin View host',
      }),
      metadata: expect.objectContaining({
        viewType: 'kanban-view',
        fileExtensions: ['kanban', 'board'],
        missingViewRegistration: true,
      }),
    })]);
  });

  it('does not expose partial surfaces from plugins whose onload fails', async () => {
    writePlugin(
      'failing-surfaces',
      `
        const { Plugin } = require('obsidian');
        module.exports = class FailingSurfaces extends Plugin {
          onload() {
            this.addCommand({ id: 'partial-command', name: 'Partial command', callback: () => {} });
            this.addRibbonIcon('sparkles', 'Partial ribbon', () => {});
            this.addStatusBarItem().setText('Partial status');
            this.registerView('partial-view', () => ({}));
            this.registerExtensions(['partial'], 'partial-view');
            this.registerMarkdownCodeBlockProcessor('partial', () => {});
            this.registerMarkdownPostProcessor(() => {});
            this.registerEditorExtension({ name: 'partial-extension' });
            throw new Error('failed after registering surfaces');
          }
        };
      `,
      { name: 'Failing Surfaces' },
    );
    enablePlugin('failing-surfaces');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.failed).toEqual(['failing-surfaces']);
    expect(json.surfaces.filter((surface: { pluginId: string }) => surface.pluginId === 'failing-surfaces')).toEqual([]);
  });

  it('filters surfaces by kind', async () => {
    writePlugin(
      'surface-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class SurfacePlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'run', name: 'Run Surface', callback: () => {} });
            this.addRibbonIcon('sparkles', 'Run from ribbon', () => {});
          }
        };
      `,
    );
    enablePlugin('surface-plugin');

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?loadEnabled=1&kind=command'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.surfaces).toHaveLength(1);
    expect(json.surfaces[0]).toMatchObject({
      kind: 'command',
      title: 'Run Surface',
    });
  });

  it('includes MindOS renderer plugins as document renderer surfaces', async () => {
    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?kind=document-renderer&source=mindos-renderer'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mindos-renderer:document-renderer:backlinks',
        source: 'mindos-renderer',
        kind: 'document-renderer',
        location: 'document',
        availability: 'available',
        pluginId: 'backlinks',
        title: 'Backlinks Explorer',
        host: expect.objectContaining({ state: 'mounted', label: 'Document renderer' }),
        metadata: expect.objectContaining({
          manifest: expect.objectContaining({
            id: 'backlinks',
            name: 'Backlinks Explorer',
            version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
            minAppVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
            isDesktopOnly: false,
          }),
        }),
      }),
    ]));
    expect(json.counts.rendererPlugins).toBeGreaterThan(0);
  });

  it('maps installed runtime extension contributions to declarative plugin surfaces', async () => {
    writeRuntimeExtension();

    const { GET } = await importRoute();
    const res = await GET(new NextRequest('http://localhost/api/plugins/surfaces?source=runtime-extension'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.counts).toMatchObject({
      runtimeExtensions: 1,
      surfaces: 8,
    });
    expect(json.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'runtime-extension:acp-adapter:aion-style-pack:ext-buddy',
        source: 'runtime-extension',
        kind: 'command',
        location: 'command-center',
        availability: 'available',
        title: 'External Buddy',
        host: expect.objectContaining({ state: 'mounted', label: 'ACP Registry' }),
        metadata: expect.objectContaining({
          contribution: 'acpAdapter',
          adapterId: 'ext-buddy',
          command: 'codebuddy',
          args: ['--acp'],
        }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:command:aion-style-pack:explain',
        kind: 'command',
        availability: 'recorded',
        title: 'Explain Selection',
        host: expect.objectContaining({ state: 'catalog', label: 'Runtime command catalog' }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:mcp-server:aion-style-pack:docs',
        kind: 'settings',
        availability: 'recorded',
        title: 'Docs MCP',
        host: expect.objectContaining({ state: 'catalog', label: 'MCP declaration catalog' }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:assistant:aion-style-pack:reviewer',
        kind: 'settings',
        availability: 'recorded',
        title: 'Reviewer',
        host: expect.objectContaining({ state: 'catalog', label: 'Assistant declaration catalog' }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:agent:aion-style-pack:planner',
        kind: 'settings',
        availability: 'recorded',
        title: 'Planner',
        host: expect.objectContaining({ state: 'catalog', label: 'Agent declaration catalog' }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:skill:aion-style-pack:review',
        kind: 'settings',
        availability: 'recorded',
        title: 'Review Skill',
        host: expect.objectContaining({ state: 'catalog', label: 'Skill declaration catalog' }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:theme:aion-style-pack:0',
        kind: 'style',
        availability: 'recorded',
        title: 'Warm Runtime',
        host: expect.objectContaining({ state: 'catalog', label: 'Theme declaration catalog' }),
      }),
      expect.objectContaining({
        id: 'runtime-extension:settings:aion-style-pack:0',
        kind: 'settings',
        availability: 'recorded',
        title: 'Runtime Settings',
        host: expect.objectContaining({ state: 'catalog', label: 'Settings declaration catalog' }),
      }),
    ]));
  });
});
