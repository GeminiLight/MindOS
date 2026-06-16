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

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel } from '@/lib/obsidian-compat/compatibility-report';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';

const REAL_PLUGINS_DIR = path.join(__dirname, '../../__fixtures__/real-plugins');
const REAL_PLUGINS_MATRIX_PATH = path.join(REAL_PLUGINS_DIR, 'matrix.json');
const REAL_PLUGIN_TARGETS_PATH = path.join(__dirname, '../../../../scripts/obsidian-community-real-plugins.json');
const ENABLED = process.env.TEST_REAL_PLUGINS === '1';

interface RealPluginTarget {
  id: string;
  name: string;
  repo: string;
  expectedCompatibilityLevel: 'compatible' | 'partial' | 'blocked';
  requiredFiles?: string[];
  optionalFiles?: string[];
}

interface RealPluginMatrix {
  schemaVersion: 1;
  sourcePolicy: string;
  generatedAt: string;
  plugins: Array<{
    id: string;
    name: string;
    repo: string;
    sourcePolicy: string;
    releaseTag: string;
    releaseUrl?: string;
    expectedCompatibilityLevel: 'compatible' | 'partial' | 'blocked';
    manifest: {
      id: string;
      name: string;
      version: string;
      isDesktopOnly?: boolean;
    };
    files: Record<string, {
      present: boolean;
      optional?: boolean;
      bytes?: number;
      sha256?: string;
      url?: string;
    }>;
  }>;
  failures?: Array<{ id: string; error: string }>;
}

const REAL_PLUGIN_FIXTURES: RealPluginTarget[] = readRealPluginTargets();

let mindRoot: string;

function getPluginPath(pluginId: string): string {
  return path.join(REAL_PLUGINS_DIR, pluginId);
}

function pluginExists(pluginId: string): boolean {
  const pluginPath = getPluginPath(pluginId);
  return fs.existsSync(path.join(pluginPath, 'main.js')) &&
         fs.existsSync(path.join(pluginPath, 'manifest.json'));
}

function readRealPluginTargets(): RealPluginTarget[] {
  const raw = JSON.parse(fs.readFileSync(REAL_PLUGIN_TARGETS_PATH, 'utf-8')) as { plugins?: RealPluginTarget[] };
  return Array.isArray(raw.plugins) ? raw.plugins : [];
}

function readRealPluginMatrix(): RealPluginMatrix {
  return JSON.parse(fs.readFileSync(REAL_PLUGINS_MATRIX_PATH, 'utf-8')) as RealPluginMatrix;
}

function matrixPlugin(matrix: RealPluginMatrix, pluginId: string): RealPluginMatrix['plugins'][number] | undefined {
  return matrix.plugins.find((plugin) => plugin.id === pluginId);
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
  let matrix: RealPluginMatrix;

  beforeAll(() => {
    const missingPlugins = REAL_PLUGIN_FIXTURES.filter((fixture) => !pluginExists(fixture.id));
    if (missingPlugins.length > 0) {
      throw new Error([
        'Real plugin fixtures are missing. Run:',
        '  node scripts/download-community-plugins.js',
        'Missing:',
        ...missingPlugins.map((plugin) => `  - ${plugin.name} (${plugin.repo})`),
      ].join('\n'));
    }
    if (!fs.existsSync(REAL_PLUGINS_MATRIX_PATH)) {
      throw new Error('Real plugin matrix is missing. Run: node scripts/download-community-plugins.js');
    }

    matrix = readRealPluginMatrix();
    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.failures ?? []).toEqual([]);
    for (const fixture of REAL_PLUGIN_FIXTURES) {
      const item = matrixPlugin(matrix, fixture.id);
      expect(item, `matrix entry for ${fixture.id}`).toBeDefined();
      expect(item?.repo).toBe(fixture.repo);
      expect(item?.expectedCompatibilityLevel).toBe(fixture.expectedCompatibilityLevel);
    }
  });

  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-real-plugins-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  for (const fixture of REAL_PLUGIN_FIXTURES) {
    describe(fixture.name, () => {
      it(`analyzes ${fixture.name} compatibility against the downloaded matrix`, () => {
        const mainJsPath = path.join(getPluginPath(fixture.id), 'main.js');
        const manifestPath = path.join(getPluginPath(fixture.id), 'manifest.json');
        const code = fs.readFileSync(mainJsPath, 'utf-8');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { id: string; name: string; version: string };
        const matrixItem = matrixPlugin(matrix, fixture.id);
        expect(matrixItem).toBeDefined();
        expect(matrixItem?.manifest).toMatchObject({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
        });

        const report = analyzePluginCompatibility(code, manifest);
        const level = getCompatibilityLevel(report);

        console.log(`${fixture.name} compatibility: ${level}`);
        console.log(`  Supported APIs: ${report.supportedApis.length}`);
        console.log(`  Partial APIs: ${report.partialApis.length}`);
        console.log(`  Unsupported APIs: ${report.unsupportedApis.length}`);
        console.log(`  Blockers: ${report.blockers.length}`);

        expect(level).toBe(fixture.expectedCompatibilityLevel);
      });

      it(`loads ${fixture.name} plugin or records a typed runtime failure`, async () => {
        copyPluginToVault(fixture.id, mindRoot);

        const manager = new PluginManager(mindRoot);
        const plugins = await manager.discover();

        const plugin = plugins.find((p) => p.id === fixture.id);
        expect(plugin).toBeDefined();
        expect(plugin?.name).toBe(fixture.name);

        await manager.enable(fixture.id);
        const result = await manager.loadEnabledPlugins();

        const loaded = result.loaded.includes(fixture.id);
        const failed = result.failed.includes(fixture.id);
        const skipped = result.skipped.includes(fixture.id);
        expect(loaded || failed || skipped).toBe(true);

        if (fixture.expectedCompatibilityLevel !== 'blocked') {
          expect(loaded, `${fixture.name} should load as a non-blocked real-plugin fixture`).toBe(true);
        }

        if (loaded) {
          console.log(`✓ ${fixture.name} loaded successfully`);
        } else if (skipped) {
          console.log(`- ${fixture.name} skipped by compatibility gate`);
        } else {
          const afterLoad = manager.list().find((p) => p.id === fixture.id);
          expect(afterLoad?.lastError, `${fixture.name} should expose a runtime failure reason`).toBeTruthy();
          console.log(`✗ ${fixture.name} failed to load: ${afterLoad?.lastError}`);
        }
      });
    });
  }

  it('records source provenance for the manual compatibility matrix', () => {
    expect(matrix.sourcePolicy).toBe('github-release-assets');
    for (const fixture of REAL_PLUGIN_FIXTURES) {
      const item = matrixPlugin(matrix, fixture.id);
      expect(item?.releaseTag).toBeTruthy();
      expect(item?.files['manifest.json']?.present).toBe(true);
      expect(item?.files['manifest.json']?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item?.files['main.js']?.present).toBe(true);
      expect(item?.files['main.js']?.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
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
