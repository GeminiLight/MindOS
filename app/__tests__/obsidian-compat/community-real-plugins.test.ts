/**
 * Real Community Plugin Smoke Tests
 *
 * This test suite downloads and tests actual Obsidian community plugins.
 * It's disabled by default to avoid network dependencies and slow test runs.
 *
 * To run these tests:
 *   TEST_REAL_PLUGINS=1 npm test -- community-real-plugins.test.ts
 *
 * To download plugins without running tests:
 *   node scripts/download-community-plugins.js
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel } from '@/lib/obsidian-compat/compatibility-report';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';

const REAL_PLUGINS_DIR = path.join(__dirname, '../../__fixtures__/real-plugins');
const ENABLED = process.env.TEST_REAL_PLUGINS === '1';

interface RealPluginFixture {
  id: string;
  name: string;
  repo: string;
  expectedCompatibilityLevel: 'compatible' | 'partial' | 'blocked';
}

const REAL_PLUGIN_FIXTURES: RealPluginFixture[] = [
  {
    id: 'obsidian-style-settings',
    name: 'Style Settings',
    repo: 'mgmeyers/obsidian-style-settings',
    expectedCompatibilityLevel: 'compatible',
  },
  {
    id: 'quickadd',
    name: 'QuickAdd',
    repo: 'chhoumann/quickadd',
    expectedCompatibilityLevel: 'partial', // May use some unsupported APIs
  },
  {
    id: 'tag-wrangler',
    name: 'Tag Wrangler',
    repo: 'pjeby/tag-wrangler',
    expectedCompatibilityLevel: 'compatible',
  },
  {
    id: 'obsidian-homepage',
    name: 'Homepage',
    repo: 'mirnovov/obsidian-homepage',
    expectedCompatibilityLevel: 'compatible',
  },
];

let mindRoot: string;

function getPluginPath(pluginId: string): string {
  return path.join(REAL_PLUGINS_DIR, pluginId);
}

function pluginExists(pluginId: string): boolean {
  const pluginPath = getPluginPath(pluginId);
  return fs.existsSync(path.join(pluginPath, 'main.js')) &&
         fs.existsSync(path.join(pluginPath, 'manifest.json'));
}

function copyPluginToVault(pluginId: string, destDir: string): void {
  const srcDir = getPluginPath(pluginId);
  const destPluginDir = path.join(destDir, '.plugins', pluginId);

  fs.mkdirSync(destPluginDir, { recursive: true });

  // Copy main.js
  fs.copyFileSync(
    path.join(srcDir, 'main.js'),
    path.join(destPluginDir, 'main.js')
  );

  // Copy manifest.json
  fs.copyFileSync(
    path.join(srcDir, 'manifest.json'),
    path.join(destPluginDir, 'manifest.json')
  );

  // Copy styles.css if exists
  const stylesPath = path.join(srcDir, 'styles.css');
  if (fs.existsSync(stylesPath)) {
    fs.copyFileSync(stylesPath, path.join(destPluginDir, 'styles.css'));
  }
}

describe.skipIf(!ENABLED)('real community plugin smoke suite', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-real-plugins-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  for (const fixture of REAL_PLUGIN_FIXTURES) {
    describe(fixture.name, () => {
      it.skipIf(!pluginExists(fixture.id))(`analyzes ${fixture.name} compatibility`, () => {
        const mainJsPath = path.join(getPluginPath(fixture.id), 'main.js');
        const code = fs.readFileSync(mainJsPath, 'utf-8');

        const report = analyzePluginCompatibility(code);
        const level = getCompatibilityLevel(report);

        console.log(`${fixture.name} compatibility: ${level}`);
        console.log(`  Supported APIs: ${report.supportedApis.length}`);
        console.log(`  Unsupported APIs: ${report.unsupportedApis.length}`);
        console.log(`  Blocked APIs: ${report.blockedApis.length}`);

        // We don't enforce exact match because real plugins may evolve
        // Just ensure we can analyze them without crashing
        expect(['compatible', 'partial', 'blocked']).toContain(level);
      });

      it.skipIf(!pluginExists(fixture.id))(`loads ${fixture.name} plugin`, async () => {
        copyPluginToVault(fixture.id, mindRoot);

        const manager = new PluginManager(mindRoot);
        const plugins = await manager.discover();

        const plugin = plugins.find((p) => p.id === fixture.id);
        expect(plugin).toBeDefined();
        expect(plugin?.name).toBe(fixture.name);

        // Try to enable and load
        await manager.enable(fixture.id);
        const result = await manager.loadEnabledPlugins();

        // Plugin should either load successfully or fail gracefully
        expect(result.loaded.includes(fixture.id) || result.failed.includes(fixture.id)).toBe(true);

        if (result.loaded.includes(fixture.id)) {
          console.log(`✓ ${fixture.name} loaded successfully`);
        } else {
          console.log(`✗ ${fixture.name} failed to load (expected for some plugins)`);
        }
      });
    });
  }

  it('provides instructions when plugins are not downloaded', () => {
    const missingPlugins = REAL_PLUGIN_FIXTURES.filter(f => !pluginExists(f.id));

    if (missingPlugins.length > 0) {
      console.log('\nTo download real plugins for testing:');
      console.log('  node scripts/download-community-plugins.js\n');
      console.log('Missing plugins:');
      missingPlugins.forEach(p => {
        console.log(`  - ${p.name} (${p.repo})`);
      });
    }

    expect(true).toBe(true); // Always pass, just informational
  });
});

describe.skipIf(ENABLED)('real plugin tests are disabled', () => {
  it('shows how to enable real plugin tests', () => {
    console.log('\nReal plugin tests are disabled by default.');
    console.log('To enable them:');
    console.log('  TEST_REAL_PLUGINS=1 npm test -- community-real-plugins.test.ts\n');
    expect(true).toBe(true);
  });
});
