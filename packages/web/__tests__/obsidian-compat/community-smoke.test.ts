import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel } from '@/lib/obsidian-compat/compatibility-report';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';
import { OBSIDIAN_COMMUNITY_FIXTURES } from '../fixtures/obsidian-community-fixtures';

let mindRoot: string;
const PACKAGED_FIXTURES_DIR = path.join(__dirname, '../fixtures/obsidian-plugin-packages');

function writePlugin(pluginId: string, mainJs: string, styles?: string) {
  const pluginDir = path.join(mindRoot, '.plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
  if (styles) {
    fs.writeFileSync(path.join(pluginDir, 'styles.css'), styles, 'utf-8');
  }
}

function writeVaultFile(filePath: string, content: string | Buffer) {
  const fullPath = path.join(mindRoot, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(mindRoot, filePath), 'utf-8')) as T;
}

describe('community plugin smoke suite', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-community-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  for (const fixture of OBSIDIAN_COMMUNITY_FIXTURES) {
    it(`classifies ${fixture.displayName} from ${fixture.source}`, async () => {
      writePlugin(fixture.pluginId, fixture.code, fixture.styles);

      const report = analyzePluginCompatibility(fixture.code);
      expect(getCompatibilityLevel(report)).toBe(fixture.expectedCompatibilityLevel);

      const manager = new PluginManager(mindRoot);
      const plugins = await manager.discover();
      const plugin = plugins.find((item) => item.id === fixture.pluginId);
      expect(plugin).toMatchObject({ id: fixture.pluginId, compatibilityLevel: fixture.expectedCompatibilityLevel });
    });
  }

  it('loads the QuickAdd-like fixture successfully', async () => {
    const fixture = OBSIDIAN_COMMUNITY_FIXTURES.find((item) => item.pluginId === 'quickadd-like');
    if (!fixture) throw new Error('Missing quickadd-like fixture');

    writePlugin(fixture.pluginId, fixture.code, fixture.styles);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable(fixture.pluginId, { confirmCapabilityGate: true });
    const result = await manager.loadEnabledPlugins();

    expect(result.loaded).toEqual([fixture.pluginId]);
    expect(manager.list()[0]).toMatchObject({ compatibilityLevel: fixture.expectedCompatibilityLevel, loaded: true });
  });

  it('executes the Dataview/Tasks-like fixture against rich metadata', async () => {
    const fixture = OBSIDIAN_COMMUNITY_FIXTURES.find((item) => item.pluginId === 'dataview-tasks-like');
    if (!fixture) throw new Error('Missing dataview-tasks-like fixture');

    writePlugin(fixture.pluginId, fixture.code, fixture.styles);
    writeVaultFile('notes/project.md', `---
related: "[[Reference Note|Reference]]"
---

# Project

Body #important with ![[image.png]]

- [ ] Open task ^task-block
`);
    writeVaultFile('notes/reference.md', '# Reference');

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable(fixture.pluginId, { confirmCapabilityGate: true });
    const result = await manager.executeCommand('obsidian:dataview-tasks-like:build-metadata-report');

    const rows = readJsonFile<Array<{
      path: string;
      tags: string[];
      taskCount: number;
      blockIds: string[];
      embedCount: number;
      firstHeadingLine: number | null;
      frontmatterLinks: string[];
    }>>('reports/metadata.json');
    const project = rows.find((row) => row.path === 'notes/project.md');

    expect(project).toMatchObject({
      tags: ['#important'],
      taskCount: 1,
      blockIds: ['task-block'],
      embedCount: 1,
      firstHeadingLine: 4,
      frontmatterLinks: ['Reference Note'],
    });
    expect(result.noticeSnapshots?.[0]?.message).toBe('Metadata report built: 2');
  });

  it('executes the attachment lifecycle fixture through Vault and FileManager shims', async () => {
    const fixture = OBSIDIAN_COMMUNITY_FIXTURES.find((item) => item.pluginId === 'attachment-lifecycle-like');
    if (!fixture) throw new Error('Missing attachment-lifecycle-like fixture');

    writePlugin(fixture.pluginId, fixture.code, fixture.styles);
    writeVaultFile('notes/image.png', Buffer.from('existing'));

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable(fixture.pluginId, { confirmCapabilityGate: true });
    const result = await manager.executeCommand('obsidian:attachment-lifecycle-like:capture-attachment');

    const attachment = readJsonFile<{ attachmentPath: string; resourcePath: string }>('reports/attachment.json');
    expect(attachment).toEqual({
      attachmentPath: 'notes/image 1.png',
      resourcePath: `mindos-vault:///${encodeURIComponent('notes/image 1.png')}`,
    });
    expect(fs.readFileSync(path.join(mindRoot, 'notes/image 1.png'), 'utf-8')).toBe('png-tail');
    expect(fs.readFileSync(path.join(mindRoot, 'notes/source.md'), 'utf-8')).toContain('![](notes/image 1.png)');
    expect(result.noticeSnapshots?.[0]?.message).toBe('Attachment captured');
  });

  it('imports and executes a packaged community canary through the Obsidian vault path', async () => {
    const sourceVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-source-'));
    const pluginId = 'community-canary';

    try {
      const pluginSourceDir = path.join(PACKAGED_FIXTURES_DIR, pluginId);
      const obsidianPluginDir = path.join(sourceVault, '.obsidian', 'plugins', pluginId);
      fs.mkdirSync(path.dirname(obsidianPluginDir), { recursive: true });
      fs.cpSync(pluginSourceDir, obsidianPluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(sourceVault, '.obsidian', 'community-plugins.json'),
        JSON.stringify([pluginId], null, 2),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(sourceVault, '.obsidian', 'hotkeys.json'),
        JSON.stringify({ 'community-canary:run-canary': [{ modifiers: ['Mod'], key: 'R' }] }, null, 2),
        'utf-8',
      );

      const manager = new PluginManager(mindRoot);
      const scan = await manager.scanObsidianVault(sourceVault);
      expect(scan.skipped).toEqual([]);
      expect(scan.plugins.find((item) => item.id === pluginId)).toMatchObject({
        compatibilityLevel: 'partial',
        hasStyles: true,
        hasData: true,
        obsidianConfig: {
          enabledInObsidian: true,
          hotkeyCount: 1,
          hotkeys: [{
            commandId: 'community-canary:run-canary',
            hotkeys: [{ modifiers: ['Mod'], key: 'R' }],
          }],
        },
      });

      await manager.importFromObsidianVault(sourceVault, pluginId);
      const discovered = await manager.discover();
      expect(discovered.find((item) => item.id === pluginId)).toMatchObject({
        id: pluginId,
        enabled: false,
        compatibilityLevel: 'partial',
      });

      await manager.enable(pluginId, { confirmCapabilityGate: true });
      const load = await manager.loadEnabledPlugins();
      expect(load).toEqual({ loaded: [pluginId], failed: [], skipped: [] });

      const runtime = manager.list()[0]?.runtime;
      expect(runtime).toMatchObject({
        commands: 1,
        settingTabs: 1,
        ribbonIcons: 1,
        statusBarItems: 1,
        styleSheets: 1,
        markdownCodeBlockProcessors: 1,
        markdownCodeBlockLanguages: ['canary'],
      });
      expect(runtime?.commandList[0]).toMatchObject({
        id: 'run-canary',
        fullId: 'obsidian:community-canary:run-canary',
        name: 'Run Canary',
        hotkeySources: { default: 0, obsidianImport: 1 },
        hotkeys: [{ modifiers: ['Mod'], key: 'R' }],
      });
      expect(runtime?.ribbonIconList).toEqual([{ icon: 'sparkles', title: 'Run canary' }]);
      expect(runtime?.statusBarItemList).toEqual([{ text: 'Canary ready' }]);
      expect(runtime?.styleSheetList[0]).toMatchObject({ path: 'styles.css' });

      const action = await manager.executeCommand('obsidian:community-canary:run-canary');
      expect(action.noticeSnapshots?.[0]?.message).toBe('Community canary ran');
      expect(fs.readFileSync(path.join(mindRoot, 'Inbox/community-canary.md'), 'utf-8')).toContain('- run');

      const data = readJsonFile<{ runs: number; lastHeading: string; sourceVault: string }>('.mindos/plugins/community-canary/data.json');
      expect(data).toMatchObject({ runs: 1, lastHeading: 'Community Canary', sourceVault: 'obsidian' });
      expect(readJsonFile<{ enabledInObsidian: boolean; hotkeyCount: number }>(
        '.mindos/plugins/community-canary/obsidian-import.json',
      )).toMatchObject({ enabledInObsidian: true, hotkeyCount: 1 });

      const codeBlocks = await manager.renderMarkdownCodeBlock('canary', 'hello');
      expect(codeBlocks).toHaveLength(1);
      expect(codeBlocks[0]).toMatchObject({
        pluginId,
        language: 'canary',
        text: 'canary:HELLO',
      });
    } finally {
      fs.rmSync(sourceVault, { recursive: true, force: true });
    }
  });
});
