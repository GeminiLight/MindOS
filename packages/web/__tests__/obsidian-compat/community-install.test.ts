import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  installObsidianCommunityPlugin,
  planObsidianCommunityPluginUpdate,
  updateObsidianCommunityPlugin,
} from '@/lib/obsidian-compat/community-install';

let mindRoot: string;

function createFetchMock(options: {
  manifest?: Record<string, unknown>;
  mainJs?: string;
  stylesCss?: string | null;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/manifest.json')) {
      return new Response(JSON.stringify(options.manifest ?? {
        id: 'quickadd',
        name: 'QuickAdd',
        version: '1.2.3',
      }), { status: 200 });
    }
    if (url.endsWith('/main.js')) {
      return new Response(options.mainJs ?? "const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};", { status: 200 });
    }
    if (url.endsWith('/styles.css') && options.stylesCss !== null) {
      return new Response(options.stylesCss ?? '.quickadd { display: block; }', { status: 200 });
    }
    return new Response('missing', { status: 404 });
  });
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function expectSha256Digest() {
  return expect.stringMatching(/^[a-f0-9]{64}$/);
}

function expectPackageDigest(styles = true) {
  return {
    algorithm: 'sha256',
    manifestJson: expectSha256Digest(),
    mainJs: expectSha256Digest(),
    ...(styles ? { stylesCss: expectSha256Digest() } : {}),
    package: expectSha256Digest(),
  };
}

function writeCommunityMetadata(
  targetDir: string,
  pluginId = 'quickadd',
  repo = 'owner/quickadd',
) {
  fs.writeFileSync(path.join(targetDir, 'obsidian-community.json'), JSON.stringify({
    schemaVersion: 1,
    source: 'obsidian-community',
    pluginId,
    repo,
    manifestUrl: 'old',
    mainUrl: 'old',
    stylesUrl: 'old',
    installedAt: '2026-06-13T00:00:00.000Z',
    compatibilityLevel: 'compatible',
    installBlockedReasons: [],
  }), 'utf-8');
}

describe('Obsidian community plugin install helper', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-community-install-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('atomically installs a fetched community plugin package without enabling or loading it', async () => {
    const fetchMock = createFetchMock({});
    const result = await installObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    });

    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    expect(result).toMatchObject({
      ok: true,
      plugin: {
        id: 'quickadd',
        name: 'QuickAdd',
        repo: 'owner/quickadd',
        githubUrl: 'https://github.com/owner/quickadd',
      },
      installed: {
        pluginId: 'quickadd',
        targetDir,
        enabled: false,
        loaded: false,
        source: 'obsidian-community',
      },
      preflight: {
        installable: true,
      },
    });
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toContain('"quickadd"');
    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toContain('class QuickAdd');
    expect(fs.readFileSync(path.join(targetDir, 'styles.css'), 'utf-8')).toBe('.quickadd { display: block; }');
    expect(fs.existsSync(path.join(targetDir, 'data.json'))).toBe(false);
    expect(fs.existsSync(path.join(mindRoot, '.plugins', '.plugin-manager.json'))).toBe(false);
    expect(readJson(path.join(targetDir, 'obsidian-community.json'))).toEqual({
      schemaVersion: 1,
      source: 'obsidian-community',
      pluginId: 'quickadd',
      repo: 'owner/quickadd',
      githubUrl: 'https://github.com/owner/quickadd',
      sourceType: 'github-release',
      sourceStrategy: 'latest-release',
      resolvedVersion: '1.2.3',
      latestVersion: '1.2.3',
      versionsUrl: 'https://raw.githubusercontent.com/owner/quickadd/HEAD/versions.json',
      manifestUrl: 'https://github.com/owner/quickadd/releases/download/1.2.3/manifest.json',
      mainUrl: 'https://github.com/owner/quickadd/releases/download/1.2.3/main.js',
      stylesUrl: 'https://github.com/owner/quickadd/releases/download/1.2.3/styles.css',
      packageDigest: expectPackageDigest(),
      installedAt: '2026-06-14T00:00:00.000Z',
      compatibilityLevel: 'compatible',
      installBlockedReasons: [],
    });
  });

  it('requires explicit confirmation before fetching remote plugin assets', async () => {
    const fetchMock = createFetchMock({});

    await expect(installObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: false,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Community plugin install requires explicit confirmation.');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(mindRoot, '.plugins'))).toBe(false);
  });

  it('rejects existing plugin directories without overwriting local files', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), '{"id":"quickadd"}', 'utf-8');
    const fetchMock = createFetchMock({});

    await expect(installObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Obsidian plugin is already installed: quickadd');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toBe('{"id":"quickadd"}');
  });

  it('rejects blocked compatibility reports and does not create a target directory', async () => {
    const fetchMock = createFetchMock({
      mainJs: "const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class Bad extends Plugin {};",
    });

    await expect(installObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Requires unsupported runtime module: fs');

    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'quickadd'))).toBe(false);
  });

  it('rejects manifest id mismatches and leaves only no plugin target behind', async () => {
    const fetchMock = createFetchMock({
      manifest: {
        id: 'other-id',
        name: 'Other',
        version: '1.0.0',
      },
    });

    await expect(installObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Manifest id "other-id" does not match requested plugin id "quickadd".');

    expect(fs.existsSync(path.join(mindRoot, '.plugins', 'quickadd'))).toBe(false);
  });

  it('cleans the staging directory when the final rename fails', async () => {
    const fetchMock = createFetchMock({});
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    await expect(installObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('rename failed');

    const pluginsRoot = path.join(mindRoot, '.plugins');
    const entries = fs.existsSync(pluginsRoot) ? fs.readdirSync(pluginsRoot) : [];
    expect(entries.filter((entry) => entry.startsWith('.installing-quickadd-'))).toEqual([]);
    expect(fs.existsSync(path.join(pluginsRoot, 'quickadd'))).toBe(false);
  });

  it('plans an installed community plugin update without writing local files', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'styles.css'), '.local { color: red; }', 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'data.json'), '{"keep":true}', 'utf-8');
    writeCommunityMetadata(targetDir);
    const before = {
      manifest: fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8'),
      main: fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8'),
      styles: fs.readFileSync(path.join(targetDir, 'styles.css'), 'utf-8'),
      data: fs.readFileSync(path.join(targetDir, 'data.json'), 'utf-8'),
      metadata: fs.readFileSync(path.join(targetDir, 'obsidian-community.json'), 'utf-8'),
    };
    const fetchMock = createFetchMock({
      manifest: {
        id: 'quickadd',
        name: 'QuickAdd',
        version: '1.2.3',
      },
      mainJs: "const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};",
      stylesCss: null,
    });

    const plan = await planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(plan).toMatchObject({
      ok: true,
      readOnly: true,
      writePolicy: 'preview-only',
      plugin: {
        id: 'quickadd',
        name: 'QuickAdd',
        repo: 'owner/quickadd',
      },
      installed: {
        pluginId: 'quickadd',
        targetDir,
        version: '1.0.0',
        hasCommunityMetadata: true,
      },
      version: {
        installed: '1.0.0',
        remote: '1.2.3',
        state: 'update-available',
      },
      updatable: true,
      blockedReasons: [],
    });
    expect(plan.files).toEqual([
      expect.objectContaining({ path: 'manifest.json', action: 'modify' }),
      expect.objectContaining({ path: 'main.js', action: 'modify' }),
      expect.objectContaining({ path: 'styles.css', action: 'remove' }),
      expect.objectContaining({ path: 'obsidian-community.json', action: 'refresh', generated: true }),
    ]);
    expect(plan.packageDigest).toEqual(expectPackageDigest(false));
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toBe(before.manifest);
    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe(before.main);
    expect(fs.readFileSync(path.join(targetDir, 'styles.css'), 'utf-8')).toBe(before.styles);
    expect(fs.readFileSync(path.join(targetDir, 'data.json'), 'utf-8')).toBe(before.data);
    expect(fs.readFileSync(path.join(targetDir, 'obsidian-community.json'), 'utf-8')).toBe(before.metadata);
  });

  it('does not mark a blocked remote package as updatable in update preview', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    writeCommunityMetadata(targetDir);
    const fetchMock = createFetchMock({
      mainJs: "const fs = require('fs'); const { Plugin } = require('obsidian'); module.exports = class Bad extends Plugin {};",
    });

    const plan = await planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(plan.version.state).toBe('update-available');
    expect(plan.updatable).toBe(false);
    expect(plan.blockedReasons).toEqual(['Requires unsupported runtime module: fs']);
  });

  it('rejects update previews for plugins that are not installed locally', async () => {
    const fetchMock = createFetchMock({});

    await expect(planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Obsidian plugin is not installed: quickadd');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects update previews for local plugins without community provenance before fetching remote assets', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    const fetchMock = createFetchMock({});

    await expect(planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Community plugin update requires Obsidian Community provenance for quickadd.');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe('local main');
  });

  it('rejects update previews when community provenance belongs to another repo', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    writeCommunityMetadata(targetDir, 'quickadd', 'other/repo');
    const fetchMock = createFetchMock({});

    await expect(planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Community plugin update provenance mismatch for quickadd: installed from other/repo, requested owner/quickadd.');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies a confirmed community plugin update while preserving local plugin state', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'styles.css'), '.local { color: red; }', 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'data.json'), '{"keep":true}', 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'extra.txt'), 'keep me', 'utf-8');
    fs.mkdirSync(path.join(targetDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'cache', 'state.json'), '{"cached":true}', 'utf-8');
    fs.writeFileSync(path.join(mindRoot, 'outside-secret.txt'), 'outside', 'utf-8');
    fs.symlinkSync(path.join(mindRoot, 'outside-secret.txt'), path.join(targetDir, 'outside-link.txt'));
    fs.symlinkSync(path.join(mindRoot, 'outside-secret.txt'), path.join(targetDir, 'cache', 'outside-link.txt'));
    writeCommunityMetadata(targetDir);
    fs.writeFileSync(
      path.join(mindRoot, '.plugins', '.plugin-manager.json'),
      JSON.stringify({ enabled: { quickadd: true } }),
      'utf-8',
    );
    const fetchMock = createFetchMock({
      manifest: {
        id: 'quickadd',
        name: 'QuickAdd',
        version: '1.2.3',
      },
      mainJs: "const { Plugin } = require('obsidian'); module.exports = class QuickAdd extends Plugin {};",
      stylesCss: null,
    });
    const plan = await planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await updateObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      expectedRemoteVersion: '1.2.3',
      expectedPackageDigest: plan.packageDigest.package,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => new Date('2026-06-14T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      updated: {
        pluginId: 'quickadd',
        targetDir,
        previousVersion: '1.0.0',
        version: '1.2.3',
        preservedDataJson: true,
      },
      preflight: {
        installable: true,
      },
    });
    expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8'))).toMatchObject({
      id: 'quickadd',
      version: '1.2.3',
    });
    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toContain('class QuickAdd');
    expect(fs.existsSync(path.join(targetDir, 'styles.css'))).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, 'data.json'), 'utf-8')).toBe('{"keep":true}');
    expect(fs.readFileSync(path.join(targetDir, 'extra.txt'), 'utf-8')).toBe('keep me');
    expect(fs.readFileSync(path.join(targetDir, 'cache', 'state.json'), 'utf-8')).toBe('{"cached":true}');
    expect(fs.existsSync(path.join(targetDir, 'outside-link.txt'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'cache', 'outside-link.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(mindRoot, '.plugins', '.plugin-manager.json'), 'utf-8')).toBe(JSON.stringify({ enabled: { quickadd: true } }));
    expect(readJson(path.join(targetDir, 'obsidian-community.json'))).toMatchObject({
      schemaVersion: 1,
      source: 'obsidian-community',
      pluginId: 'quickadd',
      repo: 'owner/quickadd',
      installedAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      previousVersion: '1.0.0',
      compatibilityLevel: 'compatible',
      installBlockedReasons: [],
      packageDigest: expectPackageDigest(false),
    });
    expect(fs.readdirSync(path.join(mindRoot, '.plugins')).filter((entry) => entry.startsWith('.updating-quickadd-'))).toEqual([]);
    expect(fs.readdirSync(path.join(mindRoot, '.plugins')).filter((entry) => entry.startsWith('.previous-quickadd-'))).toEqual([]);
  });

  it('requires explicit confirmation before applying a community plugin update', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    writeCommunityMetadata(targetDir);
    const fetchMock = createFetchMock({});

    await expect(updateObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: false,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Community plugin update requires explicit confirmation.');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe('local main');
  });

  it('rejects stale update previews without writing local files', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    writeCommunityMetadata(targetDir);
    const fetchMock = createFetchMock({});

    await expect(updateObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      expectedRemoteVersion: '1.2.2',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('Remote plugin version changed from 1.2.2 to 1.2.3. Preview the update again.');

    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe('local main');
  });

  it('rejects update previews when package content changes without a version change', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    writeCommunityMetadata(targetDir);

    const plan = await planObsidianCommunityPluginUpdate({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      fetchImpl: createFetchMock({
        mainJs: "const { Plugin } = require('obsidian'); module.exports = class PreviewQuickAdd extends Plugin {};",
      }) as unknown as typeof fetch,
    });

    await expect(updateObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      expectedRemoteVersion: plan.version.remote,
      expectedPackageDigest: plan.packageDigest.package,
      fetchImpl: createFetchMock({
        mainJs: "const { Plugin } = require('obsidian'); module.exports = class ChangedQuickAdd extends Plugin {};",
      }) as unknown as typeof fetch,
    })).rejects.toThrow('Remote plugin package changed since preview. Preview the update again.');

    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe('local main');
  });

  it('rolls back the local plugin directory when update publish fails', async () => {
    const targetDir = path.join(mindRoot, '.plugins', 'quickadd');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      id: 'quickadd',
      name: 'QuickAdd',
      version: '1.0.0',
    }), 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'main.js'), 'local main', 'utf-8');
    writeCommunityMetadata(targetDir);
    const fetchMock = createFetchMock({});
    const originalRename = fs.renameSync;
    let renameCalls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        throw new Error('publish failed');
      }
      return originalRename(from, to);
    });

    await expect(updateObsidianCommunityPlugin({
      repo: 'owner/quickadd',
      pluginId: 'quickadd',
      targetMindRoot: mindRoot,
      confirm: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('publish failed');

    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe('local main');
    expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8'))).toMatchObject({
      version: '1.0.0',
    });
    expect(fs.readdirSync(path.join(mindRoot, '.plugins')).filter((entry) => entry.startsWith('.updating-quickadd-'))).toEqual([]);
    expect(fs.readdirSync(path.join(mindRoot, '.plugins')).filter((entry) => entry.startsWith('.previous-quickadd-'))).toEqual([]);
  });
});
