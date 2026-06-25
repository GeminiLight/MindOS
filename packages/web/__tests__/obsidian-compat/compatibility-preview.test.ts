import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildObsidianCapabilityCoverage } from '@/lib/obsidian-compat/capability-matrix';
import {
  buildObsidianCompatibilityPreview,
  summarizeObsidianRuntimeCapabilityLedger,
} from '@/lib/obsidian-compat/compatibility-preview';
import type { ScannedObsidianPlugin } from '@/lib/obsidian-compat/obsidian-import';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makePlugin(overrides: Partial<ScannedObsidianPlugin> & { id: string }): ScannedObsidianPlugin {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-preview-'));
  tempRoots.push(sourceRoot);
  const sourceDir = path.join(sourceRoot, overrides.id);
  fs.mkdirSync(sourceDir, { recursive: true });

  return {
    id: overrides.id,
    manifest: {
      id: overrides.id,
      name: overrides.id,
      version: '1.0.0',
      ...(overrides.manifest ?? {}),
    },
    sourceDir,
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
      ...(overrides.compatibility ?? {}),
    },
    hasStyles: false,
    hasData: false,
    obsidianConfig: {
      enabledInObsidian: true,
      hasEnabledList: true,
      hotkeys: [],
      hotkeyCount: 0,
      ...(overrides.obsidianConfig ?? {}),
    },
    ...overrides,
  };
}

describe('Obsidian compatibility preview', () => {
  it('previews package paths, Linter settings mapping, workflows, ledger entries, and next steps', () => {
    const plugin = makePlugin({
      id: 'obsidian-linter',
      manifest: { id: 'obsidian-linter', name: 'Linter', version: '1.2.3' },
      compatibilityLevel: 'partial',
      compatibility: {
        obsidianApis: ['Plugin', 'addCommand', 'MarkdownView', 'htmlToMarkdown', 'requestUrl'],
        moduleImports: [],
        nodeModules: [],
        unsupportedModules: [],
        supportedApis: ['Plugin', 'addCommand'],
        partialApis: ['MarkdownView', 'htmlToMarkdown', 'requestUrl'],
        unsupportedApis: [],
        blockers: [],
      },
      hasData: true,
    });
    fs.writeFileSync(path.join(plugin.sourceDir, 'data.json'), JSON.stringify({
      ruleConfigs: {
        'trailing-spaces': { enabled: false, twoSpaceLineBreak: true },
        'consecutive-blank-lines': { enabled: true },
        'line-break-at-document-end': { enabled: true },
        'yaml-title': { enabled: false },
      },
    }), 'utf-8');

    const preview = buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath: '.obsidian/plugins',
      hasEnabledList: true,
    });

    expect(preview).toMatchObject({
      schemaVersion: 1,
      pluginId: 'obsidian-linter',
      packagePath: {
        sourcePath: '.obsidian/plugins/obsidian-linter',
        targetPath: '.mindos/plugins/obsidian-linter',
        copiedFiles: ['manifest.json', 'main.js', 'data.json', 'obsidian-import.json'],
        sourceVaultUnchanged: true,
      },
      supportKind: 'limited',
      blockedReasons: [],
    });
    expect(preview.settingsMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'obsidian-linter-profile',
        label: 'Linter rule profile',
        source: 'data.json',
        mappedItems: ['trailing-whitespace', 'multiple-blank-lines', 'missing-final-newline'],
        ignoredItems: ['yaml-title'],
        warnings: ['Ignored ruleConfigs.trailing-spaces.twoSpaceLineBreak: MindOS currently imports only the rule enabled state.'],
        appliedOnImport: true,
      }),
      expect.objectContaining({
        id: 'obsidian-enabled-state',
        source: 'community-plugins.json',
        appliedOnImport: false,
      }),
    ]));
    expect(preview.workflowOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'linter-markdown-source-editor',
        status: 'available',
      }),
      expect.objectContaining({
        id: 'network-review',
        status: 'limited',
      }),
    ]));
    expect(preview.runtimeCapabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'addCommand',
        surface: 'commands',
        support: 'full',
        phase: 'predicted',
        source: 'static-analysis',
      }),
      expect.objectContaining({
        capability: 'requestUrl',
        surface: 'network',
        support: 'limited',
        phase: 'predicted',
      }),
    ]));
    expect(summarizeObsidianRuntimeCapabilityLedger(preview.runtimeCapabilityLedger)).toMatchObject({
      predicted: expect.any(Number),
      blocked: 0,
    });
    expect(preview.nextSteps).toEqual(expect.arrayContaining([
      'Import package into .mindos/plugins/obsidian-linter.',
      'Review mapped Linter settings before enabling source-editor linting.',
      'Confirm network capability during enable/load if this plugin still needs outbound requests.',
    ]));
  });

  it('marks hard blockers in preview and does not claim runnable workflows', () => {
    const plugin = makePlugin({
      id: 'dataview',
      manifest: { id: 'dataview', name: 'Dataview', version: '0.5.0' },
      compatibilityLevel: 'blocked',
      compatibility: {
        obsidianApis: ['Plugin', 'ImaginaryApi'],
        moduleImports: ['electron'],
        nodeModules: ['electron'],
        unsupportedModules: ['electron'],
        supportedApis: ['Plugin'],
        partialApis: [],
        unsupportedApis: ['ImaginaryApi'],
        blockers: ['Requires unsupported runtime module: electron'],
      },
      hasData: false,
    });

    const preview = buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath: '.obsidian/plugins',
      coverage: buildObsidianCapabilityCoverage(plugin.compatibility),
    });

    expect(preview.supportKind).toBe('blocked');
    expect(preview.blockedReasons).toEqual(expect.arrayContaining([
      'Requires unsupported runtime module: electron',
      'Unsupported Obsidian APIs: ImaginaryApi',
      'Unsupported runtime modules: electron',
    ]));
    expect(preview.workflowOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'native-query-index-replacement',
        status: 'native-replacement',
      }),
    ]));
    expect(preview.workflowOutcomes.some((outcome) => outcome.status === 'available')).toBe(false);
    expect(preview.runtimeCapabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'ImaginaryApi',
        surface: 'unsupported',
        support: 'unsupported',
        phase: 'blocked',
      }),
      expect.objectContaining({
        capability: 'module:electron',
        surface: 'unsupported',
        support: 'unsupported',
        phase: 'blocked',
      }),
    ]));
    expect(preview.nextSteps[0]).toBe('Do not import until blocked capabilities are replaced or explicitly supported.');
  });

  it('generates generic outcomes for unknown plugins from detected surfaces', () => {
    const plugin = makePlugin({
      id: 'command-settings-like',
      manifest: { id: 'command-settings-like', name: 'Command Settings Like', version: '1.0.0' },
      compatibilityLevel: 'partial',
      compatibility: {
        obsidianApis: ['Plugin', 'addCommand', 'PluginSettingTab', 'registerEditorExtension'],
        moduleImports: [],
        nodeModules: [],
        unsupportedModules: [],
        supportedApis: ['Plugin', 'addCommand', 'PluginSettingTab'],
        partialApis: ['registerEditorExtension'],
        unsupportedApis: [],
        blockers: [],
      },
    });

    const preview = buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath: '.obsidian/plugins',
    });

    expect(preview.workflowOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'generic-plugin-commands',
        label: 'Run plugin commands',
        status: 'available',
      }),
      expect.objectContaining({
        id: 'generic-plugin-settings',
        label: 'Review plugin settings',
        status: 'available',
      }),
      expect.objectContaining({
        id: 'editor-native-adapter',
        status: 'native-replacement',
      }),
    ]));
    expect(preview.nextSteps).toEqual(expect.arrayContaining([
      'Use MindOS native editor adapters for editor-heavy behavior; raw CodeMirror extensions are not auto-mounted.',
    ]));
  });
});
