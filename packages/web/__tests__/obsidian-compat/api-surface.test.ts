import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createDiagnosticAppProxy,
  createDiagnosticObsidianModule,
  diffObsidianApiSurface,
  getObsidianApiSurface,
  getObsidianApiSurfaceExport,
  renderObsidianApiSurfaceDiffMarkdown,
  type ObsidianApiSurface,
  type ObsidianApiSurfaceMiss,
} from '@/lib/obsidian-compat/api-surface';
import { OBSIDIAN_CAPABILITY_MATRIX } from '@/lib/obsidian-compat/capability-matrix';
import { CompatError, CompatErrorCodes } from '@/lib/obsidian-compat/errors';
import { PluginLoader } from '@/lib/obsidian-compat/loader';
import { ObsidianRuntimeCapabilityLedgerStore } from '@/lib/obsidian-compat/runtime-capability-ledger-store';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

const fakeSurface: ObsidianApiSurface = {
  schemaVersion: 1,
  source: { repo: 'test/obsidian-api', ref: 'test', commit: null, apiVersion: '9.9.9', file: 'obsidian.d.ts', sha256: 'x' },
  exports: [
    { name: 'Plugin', kind: 'abstract-class', members: [{ name: 'addCommand', kind: 'method' }] },
    { name: 'Widget', kind: 'class', since: '1.9.0', members: [{ name: 'render', kind: 'method' }] },
    { name: 'helper', kind: 'function' },
    { name: 'Platform2', kind: 'const', deprecated: true },
    { name: 'OnlyType', kind: 'interface' },
    { name: 'App', kind: 'class', members: [
      { name: 'vault', kind: 'property' },
      { name: 'renderContext', kind: 'property', since: '1.10.0' },
      { name: 'isDarkMode', kind: 'method' },
    ] },
  ],
  globals: [],
};

describe('Obsidian API surface snapshot', () => {
  it('is generated from obsidian.d.ts with provenance and declared members', () => {
    const surface = getObsidianApiSurface();
    expect(surface.schemaVersion).toBe(1);
    expect(surface.source.repo).toBe('obsidianmd/obsidian-api');
    expect(surface.source.apiVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(surface.source.sha256).toMatch(/^[0-9a-f]{64}$/);

    const plugin = getObsidianApiSurfaceExport('Plugin');
    expect(plugin?.kind).toBe('abstract-class');
    expect(plugin?.extends).toEqual(['Component']);
    expect(plugin?.members?.some((member) => member.name === 'addCommand' && member.kind === 'method')).toBe(true);

    const vault = getObsidianApiSurfaceExport('Vault');
    expect(vault?.members?.some((member) => member.name === 'getFileByPath')).toBe(true);
    expect(surface.globals.some((entry) => entry.target === 'HTMLElement')).toBe(true);
  });
});

describe('diffObsidianApiSurface', () => {
  it('separates implemented, missing, shim-only exports and undeclared matrix rows', () => {
    const diff = diffObsidianApiSurface({
      module: createObsidianModule(),
      matrixApis: OBSIDIAN_CAPABILITY_MATRIX.map((row) => row.api),
    });

    expect(diff.exports.declared).toBeGreaterThan(100);
    expect(diff.exports.implemented).toEqual(expect.arrayContaining(['Plugin', 'Notice', 'Modal', 'Setting', 'requestUrl']));
    expect(diff.exports.missing.length).toBeGreaterThan(0);
    expect(diff.exports.missing.map((item) => item.name)).not.toContain('Plugin');
    for (const item of diff.exports.missing) {
      expect(['class', 'abstract-class', 'function', 'const', 'let', 'enum']).toContain(item.kind);
    }

    const vault = diff.members.find((item) => item.owner === 'Vault');
    expect(vault?.declared).toBeGreaterThan(10);
    expect((vault?.implemented.length ?? 0) + (vault?.missing.length ?? 0)).toBe(vault?.declared);

    // MindOS-only rows (app.commands, customCss, CodeMirror adapter) are not part of the public typings.
    expect(diff.matrix.undeclaredRows).toEqual(expect.arrayContaining(['Commands.listCommands', 'CustomCss.readSnippets']));
    expect(diff.matrix.undeclaredRows).not.toContain('Vault.getFileByPath');
    expect(diff.matrix.undeclaredRows).not.toContain('addCommand');

    const markdown = renderObsidianApiSurfaceDiffMarkdown(diff);
    expect(markdown).toContain('# Obsidian API Surface Coverage');
    expect(markdown).toContain('| Declared runtime exports |');
  });

  it('compares App members against a live instance when provided', () => {
    const diff = diffObsidianApiSurface({
      module: {},
      app: { vault: {}, isDarkMode: () => false },
      surface: fakeSurface,
    });
    const app = diff.members.find((item) => item.owner === 'App');
    expect(app).toEqual({ owner: 'App', declared: 3, implemented: ['vault', 'isDarkMode'], missing: ['renderContext'] });
    expect(diff.exports.missing.map((item) => item.name).sort()).toEqual(['App', 'Platform2', 'Plugin', 'Widget', 'helper']);
  });
});

describe('createDiagnosticObsidianModule', () => {
  class Plugin {}

  it('passes implemented exports through untouched and keeps `in` truthful', () => {
    const misses: ObsidianApiSurfaceMiss[] = [];
    const proxied = createDiagnosticObsidianModule({ Plugin }, (miss) => misses.push(miss), fakeSurface);

    expect(proxied.Plugin).toBe(Plugin);
    expect('Plugin' in proxied).toBe(true);
    expect('Widget' in proxied).toBe(false);
    expect(Object.keys(proxied)).toEqual(['Plugin']);
    expect(misses).toEqual([]);
  });

  it('turns declared-but-missing classes into stubs that evaluate but fail on construction', () => {
    const misses: ObsidianApiSurfaceMiss[] = [];
    const proxied = createDiagnosticObsidianModule({ Plugin }, (miss) => misses.push(miss), fakeSurface) as Record<string, any>;

    const Widget = proxied.Widget;
    expect(typeof Widget).toBe('function');
    expect(Widget.name).toBe('Widget');
    class Custom extends Widget {}
    expect(() => new Custom()).toThrowError(CompatError);
    try {
      new Widget();
    } catch (error) {
      expect(error).toBeInstanceOf(CompatError);
      expect((error as CompatError).code).toBe(CompatErrorCodes.API_NOT_IMPLEMENTED);
      expect((error as CompatError).context).toMatchObject({ owner: 'obsidian', api: 'Widget', kind: 'class', declared: true, tier: 'server' });
      expect((error as CompatError).message).toContain('since Obsidian 1.9.0');
    }
    expect(proxied.Widget).toBe(Widget);
    expect(misses).toEqual([{ owner: 'obsidian', api: 'Widget', kind: 'class', declared: true, since: '1.9.0' }]);
  });

  it('turns declared-but-missing functions into throwing stubs', () => {
    const misses: ObsidianApiSurfaceMiss[] = [];
    const proxied = createDiagnosticObsidianModule({}, (miss) => misses.push(miss), fakeSurface) as Record<string, any>;
    expect(() => proxied.helper()).toThrowError(/require\('obsidian'\)\.helper is declared by obsidian\.d\.ts/);
    expect(misses[0]).toMatchObject({ api: 'helper', kind: 'function', declared: true });
  });

  it('leaves non-constructible kinds and undeclared names undefined but records them once', () => {
    const misses: ObsidianApiSurfaceMiss[] = [];
    const proxied = createDiagnosticObsidianModule({}, (miss) => misses.push(miss), fakeSurface) as Record<string, any>;

    expect(proxied.Platform2).toBeUndefined();
    expect(proxied.Platform2).toBeUndefined();
    expect(proxied.OnlyType).toBeUndefined();
    expect(proxied.totallyMadeUp).toBeUndefined();

    expect(misses).toEqual([
      { owner: 'obsidian', api: 'Platform2', kind: 'const', declared: true, deprecated: true },
      { owner: 'obsidian', api: 'OnlyType', kind: 'unknown', declared: false },
      { owner: 'obsidian', api: 'totallyMadeUp', kind: 'unknown', declared: false },
    ]);
  });

  it('ignores bundler and promise probes and survives a throwing listener', () => {
    const listener = vi.fn(() => {
      throw new Error('listener failed');
    });
    const proxied = createDiagnosticObsidianModule({}, listener, fakeSurface) as Record<string, any>;

    expect(proxied.__esModule).toBeUndefined();
    expect(proxied.default).toBeUndefined();
    expect(proxied.then).toBeUndefined();
    expect(proxied[Symbol.toStringTag]).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();

    expect(proxied.totallyMadeUp).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('createDiagnosticAppProxy', () => {
  class FakeApp {
    vault = { name: 'vault' };
    private counter = 0;
    isDarkMode(): boolean {
      this.counter += 1;
      return this.counter % 2 === 0;
    }
    get calls(): number {
      return this.counter;
    }
  }

  it('preserves method, getter and assignment semantics of the real object', () => {
    const app = new FakeApp();
    const misses: ObsidianApiSurfaceMiss[] = [];
    const proxied = createDiagnosticAppProxy(app, (miss) => misses.push(miss), fakeSurface) as FakeApp & Record<string, unknown>;

    expect(proxied.vault).toBe(app.vault);
    expect(proxied.isDarkMode()).toBe(false);
    expect(proxied.isDarkMode()).toBe(true);
    expect(proxied.calls).toBe(2);
    proxied.extra = 'set-through';
    expect((app as unknown as Record<string, unknown>).extra).toBe('set-through');
    expect(proxied.extra).toBe('set-through');
    expect(misses).toEqual([]);
  });

  it('records declared and undeclared member misses once each', () => {
    const misses: ObsidianApiSurfaceMiss[] = [];
    const proxied = createDiagnosticAppProxy(new FakeApp(), (miss) => misses.push(miss), fakeSurface) as Record<string, unknown>;

    expect(proxied.renderContext).toBeUndefined();
    expect(proxied.renderContext).toBeUndefined();
    expect(proxied.plugins).toBeUndefined();
    expect(proxied.then).toBeUndefined();

    expect(misses).toEqual([
      { owner: 'app', api: 'app.renderContext', kind: 'property', declared: true, since: '1.10.0' },
      { owner: 'app', api: 'app.plugins', kind: 'unknown', declared: false },
    ]);
  });
});

describe('PluginLoader API surface diagnostics', () => {
  let mindRoot: string;

  const writePlugin = (pluginId: string, mainJs: string) => {
    const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }), 'utf-8');
    fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
  };

  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-api-surface-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('fails plugin load with a typed error and a ledger entry when a declared class is not implemented', async () => {
    const missingClass = diffObsidianApiSurface({ module: createObsidianModule() }).exports.missing
      .find((item) => item.kind === 'class' || item.kind === 'abstract-class');
    expect(missingClass).toBeDefined();

    writePlugin('needs-missing-class', `
      const obsidian = require('obsidian');
      class Custom extends obsidian.${missingClass!.name} {}
      module.exports = class extends obsidian.Plugin {
        async onload() {
          new Custom();
        }
      };
    `);

    const loader = new PluginLoader(mindRoot);
    await expect(loader.loadPlugin('needs-missing-class')).rejects.toThrow(
      new RegExp(`require\\('obsidian'\\)\\.${missingClass!.name} is declared by obsidian\\.d\\.ts.*not implemented by the MindOS server runtime tier`),
    );

    // A failed load is cleaned up in memory; the persisted ledger keeps the evidence.
    const host = loader.getApp().getRuntimeHost();
    expect(host.getApiSurfaceMisses('needs-missing-class')).toEqual([]);
    const persisted = new ObsidianRuntimeCapabilityLedgerStore(mindRoot).read('needs-missing-class');
    expect(persisted.entries).toEqual([
      expect.objectContaining({
        pluginId: 'needs-missing-class',
        capability: `api-surface:obsidian.${missingClass!.name}`,
        phase: 'blocked',
        surface: 'unsupported',
        support: 'unsupported',
      }),
    ]);
    expect(persisted.latestBlocked[0]?.evidence).toMatch(/Declared (class|abstract-class) not implemented in server tier/);
  });

  it('records undeclared and declared app member access without breaking the plugin', async () => {
    const rawApp = new PluginLoader(mindRoot).getApp() as unknown as Record<string, unknown>;
    const declaredMissing = ['renderContext', 'keymap', 'scope', 'lastEvent'].find((key) => !(key in rawApp));
    expect(declaredMissing).toBeDefined();

    writePlugin('touches-app', `
      const { Plugin } = require('obsidian');
      module.exports = class extends Plugin {
        async onload() {
          this.touchedVault = typeof this.app.vault.getName === 'function';
          this.sameApp = this.app === app && window.app === this.app;
          this.plugins = this.app.plugins;
          this.internal = this.app.notAnObsidianThing;
          this.declared = this.app.${declaredMissing};
        }
      };
    `);

    const loader = new PluginLoader(mindRoot);
    const loaded = await loader.loadPlugin('touches-app');
    const instance = loaded.instance as unknown as Record<string, unknown>;
    expect(instance.touchedVault).toBe(true);
    expect(instance.sameApp).toBe(true);
    expect(instance.internal).toBeUndefined();

    const misses = loader.getApp().getRuntimeHost().getApiSurfaceMisses('touches-app');
    expect(misses.map((miss) => miss.api)).toEqual(expect.arrayContaining(['app.notAnObsidianThing', `app.${declaredMissing}`]));
    expect(misses.find((miss) => miss.api === 'app.notAnObsidianThing')?.declared).toBe(false);
    expect(misses.find((miss) => miss.api === `app.${declaredMissing}`)?.declared).toBe(true);
    // app.plugins is provided by the shim, so it must not be reported.
    expect(misses.map((miss) => miss.api)).not.toContain('app.plugins');

    await loader.unloadPlugin('touches-app');
    expect(loader.getApp().getRuntimeHost().getApiSurfaceMisses('touches-app')).toEqual([]);
  });

  it('names the tier that would satisfy an unsupported module import', async () => {
    writePlugin('needs-codemirror', `
      const { Plugin } = require('obsidian');
      const { StateField } = require('@codemirror/state');
      module.exports = class extends Plugin {};
    `);
    writePlugin('needs-child-process', `
      const { Plugin } = require('obsidian');
      const cp = require('child_process');
      module.exports = class extends Plugin {};
    `);

    const loader = new PluginLoader(mindRoot);
    await expect(loader.loadPlugin('needs-codemirror')).rejects.toThrow(/Unsupported module: @codemirror\/state \(requires the browser runtime tier/);
    await expect(loader.loadPlugin('needs-child-process')).rejects.toThrow(/Unsupported module: child_process \(requires the Desktop native broker tier/);
  });
});
