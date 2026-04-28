import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel } from '@/lib/obsidian-compat/compatibility-report';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';
import { OBSIDIAN_COMMUNITY_FIXTURES } from '../fixtures/obsidian-community-fixtures';

let mindRoot: string;

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
    await manager.enable(fixture.pluginId);
    const result = await manager.loadEnabledPlugins();

    expect(result.loaded).toEqual([fixture.pluginId]);
    expect(manager.list()[0]).toMatchObject({ compatibilityLevel: 'compatible', loaded: true });
  });
});
