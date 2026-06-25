import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/obsidian/import/route';

const mockedObsidianImport = vi.hoisted(() => {
  const normalizeObsidianConfigDir = (configDir?: string) => {
    const raw = (configDir ?? '.obsidian').trim();
    if (!raw) return '.obsidian';
    const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized || normalized === '.') return '.obsidian';
    if (normalized.startsWith('/') || normalized.includes('//')) {
      throw new Error(`Obsidian config folder must be relative to the vault: ${configDir}`);
    }
    if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Obsidian config folder escapes the vault: ${configDir}`);
    }
    return normalized;
  };

  return {
    importObsidianPlugin: vi.fn(),
    normalizeObsidianConfigDir,
    scanObsidianVaultPlugins: vi.fn(),
    testState: { mindRoot: '/tmp/mindRoot' },
  };
});

const {
  importObsidianPlugin,
  scanObsidianVaultPlugins,
  testState,
} = mockedObsidianImport;

vi.mock('@/lib/obsidian-compat/obsidian-import', () => ({
  importObsidianPlugin: mockedObsidianImport.importObsidianPlugin,
  normalizeObsidianConfigDir: mockedObsidianImport.normalizeObsidianConfigDir,
  scanObsidianVaultPlugins: mockedObsidianImport.scanObsidianVaultPlugins,
}));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ mindRoot: mockedObsidianImport.testState.mindRoot }),
}));

describe('POST /api/obsidian/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.mindRoot = '/tmp/mindRoot';
  });

  it('rejects missing vaultRoot or pluginId', async () => {
    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Missing vaultRoot or pluginId' });
  });

  it('rejects malformed body values', async () => {
    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: 1, pluginId: 'quickadd-like' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Missing vaultRoot or pluginId' });
  });

  it('imports a plugin and returns compatibility details', async () => {
    scanObsidianVaultPlugins.mockResolvedValue({
      plugins: [
        {
          id: 'quickadd-like',
          manifest: { id: 'quickadd-like', name: 'QuickAdd', version: '1.0.0' },
          sourceDir: '/tmp/vault/.obsidian/plugins/quickadd-like',
          compatibilityLevel: 'partial',
          compatibility: {
            obsidianApis: ['Plugin', 'Modal', 'Notice', 'addCommand'],
            moduleImports: [],
            nodeModules: [],
            unsupportedModules: [],
            supportedApis: ['Plugin', 'addCommand'],
            partialApis: ['Modal', 'Notice'],
            unsupportedApis: [],
            blockers: [],
          },
          hasStyles: false,
          hasData: true,
          obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0 },
        },
      ],
      skipped: [],
      vault: { pluginsDirFound: true, hasEnabledList: true, configDir: '.obsidian', pluginsRelativePath: '.obsidian/plugins' },
    });
    importObsidianPlugin.mockResolvedValue({
      pluginId: 'quickadd-like',
      targetDir: '/tmp/mindRoot/.mindos/plugins/quickadd-like',
      copiedFiles: ['manifest.json', 'main.js', 'data.json', 'obsidian-import.json'],
      obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0, sourceConfigDir: '.obsidian' },
    });

    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault', pluginId: 'quickadd-like', targetMindRoot: '/tmp/ignoredRoot' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.plugin.id).toBe('quickadd-like');
    expect(json.plugin.compatibilityLevel).toBe('partial');
    expect(json.plugin.importable).toBe(true);
    expect(json.plugin.support).toMatchObject({ kind: 'limited', importable: true, defaultSelected: true });
    expect(json.plugin.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: 'Modal', support: 'snapshot-only' }),
      expect.objectContaining({ api: 'Notice', support: 'snapshot-only' }),
    ]));
    expect(json.nextStep).toMatchObject({
      manageHref: '/settings?tab=plugins',
      surfacesHref: '/settings?tab=plugins&panel=surfaces',
    });
    expect(json.plugin.sourceDir).toBeUndefined();
    expect(json.imported.targetDir).toBeUndefined();
    expect(json.imported.targetPath).toBe('.mindos/plugins/quickadd-like');
    expect(json.imported.sourceConfigDir).toBe('.obsidian');
    expect(json.imported.copiedFiles).toEqual(['manifest.json', 'main.js', 'data.json', 'obsidian-import.json']);
    expect(importObsidianPlugin).toHaveBeenCalledTimes(1);
    expect(importObsidianPlugin).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'quickadd-like',
      targetMindRoot: '/tmp/mindRoot',
      configDir: '.obsidian',
    }));
    expect(importObsidianPlugin).not.toHaveBeenCalledWith(expect.objectContaining({
      targetMindRoot: '/tmp/ignoredRoot',
    }));
    expect(scanObsidianVaultPlugins).toHaveBeenCalledTimes(1);
    expect(scanObsidianVaultPlugins).toHaveBeenCalledWith(expect.any(String), { configDir: '.obsidian' });
  });

  it('passes imported Obsidian Linter profile metadata through to the client', async () => {
    scanObsidianVaultPlugins.mockResolvedValue({
      plugins: [
        {
          id: 'obsidian-linter',
          manifest: { id: 'obsidian-linter', name: 'Linter', version: '1.0.0' },
          sourceDir: '/tmp/vault/.obsidian/plugins/obsidian-linter',
          compatibilityLevel: 'compatible',
          compatibility: {
            obsidianApis: ['Plugin'],
            moduleImports: [],
            nodeModules: [],
            unsupportedModules: [],
            supportedApis: ['Plugin'],
            partialApis: [],
            unsupportedApis: [],
            blockers: [],
          },
          hasStyles: false,
          hasData: true,
          obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0 },
        },
      ],
      skipped: [],
      vault: { pluginsDirFound: true, hasEnabledList: true, configDir: '.obsidian', pluginsRelativePath: '.obsidian/plugins' },
    });
    importObsidianPlugin.mockResolvedValue({
      pluginId: 'obsidian-linter',
      targetDir: '/tmp/mindRoot/.mindos/plugins/obsidian-linter',
      copiedFiles: ['manifest.json', 'main.js', 'data.json', 'obsidian-import.json'],
      obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0, sourceConfigDir: '.obsidian' },
      linterProfile: {
        schemaVersion: 1,
        source: 'obsidian-linter-data-json',
        pluginId: 'obsidian-linter',
        mappedRules: ['trailing-whitespace'],
        ignoredRules: [],
        warnings: [],
        profile: {
          enabledRules: {
            'heading-space': true,
            'trailing-whitespace': false,
            'hard-tab': true,
            'multiple-blank-lines': true,
            'missing-final-newline': true,
          },
          maxConsecutiveBlankLines: 1,
        },
      },
    });

    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault', pluginId: 'obsidian-linter' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported.linterProfile).toMatchObject({
      source: 'obsidian-linter-data-json',
      mappedRules: ['trailing-whitespace'],
      profile: {
        enabledRules: {
          'trailing-whitespace': false,
        },
      },
    });
  });

  it('imports with a custom Obsidian config folder override', async () => {
    scanObsidianVaultPlugins.mockResolvedValue({
      plugins: [
        {
          id: 'mobile-plugin',
          manifest: { id: 'mobile-plugin', name: 'Mobile Plugin', version: '1.0.0' },
          sourceDir: '/tmp/vault/.obsidian-mobile/plugins/mobile-plugin',
          compatibilityLevel: 'compatible',
          compatibility: {
            obsidianApis: ['Plugin'],
            moduleImports: [],
            nodeModules: [],
            unsupportedModules: [],
            supportedApis: ['Plugin'],
            partialApis: [],
            unsupportedApis: [],
            blockers: [],
          },
          hasStyles: false,
          hasData: false,
          obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0 },
        },
      ],
      skipped: [],
      vault: { pluginsDirFound: true, hasEnabledList: true, configDir: '.obsidian-mobile', pluginsRelativePath: '.obsidian-mobile/plugins' },
    });
    importObsidianPlugin.mockResolvedValue({
      pluginId: 'mobile-plugin',
      targetDir: '/tmp/mindRoot/.mindos/plugins/mobile-plugin',
      copiedFiles: ['manifest.json', 'main.js', 'obsidian-import.json'],
      obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0, sourceConfigDir: '.obsidian-mobile' },
    });

    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault', pluginId: 'mobile-plugin', configDir: '.obsidian-mobile' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported.sourceConfigDir).toBe('.obsidian-mobile');
    expect(scanObsidianVaultPlugins).toHaveBeenCalledWith(expect.any(String), { configDir: '.obsidian-mobile' });
    expect(importObsidianPlugin).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'mobile-plugin',
      configDir: '.obsidian-mobile',
    }));
  });

  it('rejects unsafe Obsidian config folder overrides', async () => {
    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault', pluginId: 'quickadd-like', configDir: '../outside' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'Obsidian config folder escapes the vault: ../outside' });
    expect(scanObsidianVaultPlugins).not.toHaveBeenCalled();
    expect(importObsidianPlugin).not.toHaveBeenCalled();
  });

  it('rejects blocked plugins at the import API boundary', async () => {
    scanObsidianVaultPlugins.mockResolvedValue({
      plugins: [
        {
          id: 'desktop-only-like',
          manifest: { id: 'desktop-only-like', name: 'Desktop Only', version: '1.0.0' },
          sourceDir: '/tmp/vault/.obsidian/plugins/desktop-only-like',
          compatibilityLevel: 'blocked',
          compatibility: {
            obsidianApis: ['Plugin'],
            moduleImports: ['electron'],
            nodeModules: ['electron'],
            unsupportedModules: ['electron'],
            supportedApis: ['Plugin'],
            partialApis: [],
            unsupportedApis: [],
            blockers: ['Requires unsupported runtime module: electron'],
          },
          hasStyles: false,
          hasData: false,
          obsidianConfig: { enabledInObsidian: true, hasEnabledList: true, hotkeys: [], hotkeyCount: 0 },
        },
      ],
      skipped: [],
      vault: { pluginsDirFound: true, hasEnabledList: true, configDir: '.obsidian', pluginsRelativePath: '.obsidian/plugins' },
    });

    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault', pluginId: 'desktop-only-like' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'Requires unsupported runtime module: electron' });
    expect(importObsidianPlugin).not.toHaveBeenCalled();
  });

  it('returns 404 when plugin is not found in the scanned vault', async () => {
    scanObsidianVaultPlugins.mockResolvedValue({ plugins: [], skipped: [], vault: { pluginsDirFound: true, hasEnabledList: false, configDir: '.obsidian', pluginsRelativePath: '.obsidian/plugins' } });
    const req = new NextRequest('http://localhost/api/obsidian/import', {
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '~/vault', pluginId: 'missing-plugin' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'Plugin not found in Obsidian vault' });
  });
});
