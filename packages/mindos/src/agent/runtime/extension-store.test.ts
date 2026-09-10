import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentRuntimeExtensionManifest } from './extension-manifest.js';
import {
  EXTENSION_METADATA_FILE,
  MINDOS_RUNTIME_EXTENSIONS_ROOT,
  installAgentRuntimeExtension,
  listInstalledAgentRuntimeExtensions,
  readInstalledExtensionAppliedAcpAgents,
} from './extension-store.js';

let mindRoot: string;

function manifestFixture(version = '0.1.0') {
  const parsed = parseAgentRuntimeExtensionManifest({
    id: 'store-demo',
    name: 'Store Demo',
    version,
    contributes: {
      acpAdapters: [{ id: 'store-agent', cliCommand: 'store-cli' }],
    },
  });
  if (!parsed.manifest) throw new Error('fixture manifest must parse');
  return parsed.manifest;
}

describe('extension store', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-extension-store-'));
  });

  afterEach(() => {
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('lists nothing when the extension root does not exist', () => {
    expect(listInstalledAgentRuntimeExtensions(mindRoot)).toEqual([]);
  });

  it('installs manifest and metadata through the staged swap', () => {
    const installed = installAgentRuntimeExtension(mindRoot, manifestFixture(), {
      appliedAcpAgents: ['store-agent'],
      replace: false,
      now: () => new Date('2026-09-11T00:00:00.000Z'),
    });

    expect(installed).toMatchObject({
      id: 'store-demo',
      targetDir: `${MINDOS_RUNTIME_EXTENSIONS_ROOT}/store-demo`,
      metadata: {
        source: 'agent-runtime-extension',
        installedAt: '2026-09-11T00:00:00.000Z',
        appliedAcpAgents: ['store-agent'],
      },
    });
    const extensionDir = join(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT, 'store-demo');
    expect(existsSync(join(extensionDir, 'manifest.json'))).toBe(true);
    const metadata = JSON.parse(readFileSync(join(extensionDir, EXTENSION_METADATA_FILE), 'utf-8'));
    expect(metadata.extensionId).toBe('store-demo');
    // No staging leftovers next to the published directory.
    const siblings = readdirSync(join(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT)).sort();
    expect(siblings).toEqual(['store-demo']);
  });

  it('refuses a second install without replace and preserves the original', () => {
    installAgentRuntimeExtension(mindRoot, manifestFixture(), { appliedAcpAgents: [], replace: false });

    expect(() => installAgentRuntimeExtension(mindRoot, manifestFixture(), {
      appliedAcpAgents: [],
      replace: false,
    })).toThrow('Runtime extension is already installed: store-demo');

    const listed = listInstalledAgentRuntimeExtensions(mindRoot);
    expect(listed).toHaveLength(1);
    expect(listed[0].metadata.installedAt).toBeTruthy();
  });

  it('keeps installedAt and stamps updatedAt when replacing', () => {
    installAgentRuntimeExtension(mindRoot, manifestFixture('0.1.0'), {
      appliedAcpAgents: ['store-agent'],
      replace: false,
      now: () => new Date('2026-09-11T00:00:00.000Z'),
    });

    const replaced = installAgentRuntimeExtension(mindRoot, manifestFixture('0.2.0'), {
      appliedAcpAgents: ['store-agent'],
      replace: true,
      now: () => new Date('2026-09-12T00:00:00.000Z'),
    });

    expect(replaced).toMatchObject({
      version: '0.2.0',
      metadata: {
        installedAt: '2026-09-11T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      },
    });
  });

  it('exposes extension-dir applied agents only as the migration fallback read', () => {
    installAgentRuntimeExtension(mindRoot, manifestFixture(), {
      appliedAcpAgents: ['store-agent'],
      replace: false,
    });
    expect(readInstalledExtensionAppliedAcpAgents(mindRoot, manifestFixture())).toEqual(new Set(['store-agent']));

    // A forged metadata file is returned verbatim — callers must prefer the
    // host-settings record (P2-6 lives in the handler, not here).
    const metadataPath = join(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT, 'store-demo', EXTENSION_METADATA_FILE);
    const forged = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    forged.appliedAcpAgents = ['store-agent', 'victim'];
    writeFileSync(metadataPath, JSON.stringify(forged, null, 2), 'utf-8');
    expect(readInstalledExtensionAppliedAcpAgents(mindRoot, manifestFixture())).toEqual(new Set(['store-agent', 'victim']));
  });

  it('skips directories without a parsable manifest when listing', () => {
    const rootDir = join(mindRoot, MINDOS_RUNTIME_EXTENSIONS_ROOT);
    mkdirSync(join(rootDir, 'not-an-extension'), { recursive: true });
    mkdirSync(join(rootDir, 'broken'), { recursive: true });
    writeFileSync(join(rootDir, 'broken', 'manifest.json'), '{oops', 'utf-8');
    installAgentRuntimeExtension(mindRoot, manifestFixture(), { appliedAcpAgents: [], replace: false });

    const listed = listInstalledAgentRuntimeExtensions(mindRoot);
    expect(listed.map((item) => item.id)).toEqual(['store-demo']);
  });
});
