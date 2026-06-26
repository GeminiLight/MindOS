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

function writeQuickAddDataJson(plugin: ScannedObsidianPlugin): void {
  fs.writeFileSync(path.join(plugin.sourceDir, 'data.json'), JSON.stringify({
    choices: [
      {
        id: 'capture',
        name: 'Inbox Capture',
        type: 'Capture',
        command: true,
        onePageInput: 'never',
        captureTo: 'Inbox/capture.md',
        captureToActiveFile: false,
        captureToCanvasNodeId: '',
        useSelectionAsCaptureValue: false,
        format: { enabled: true, format: 'Captured text' },
        createFileIfItDoesntExist: { enabled: true, createWithTemplate: false },
        insertAfter: { enabled: false },
        insertBefore: { enabled: false },
        newLineCapture: { enabled: false },
        templater: { afterCapture: 'none' },
      },
      {
        id: 'template',
        name: 'Daily Note',
        type: 'Template',
        command: true,
        templatePath: 'Templates/daily.md',
        folder: {
          enabled: true,
          folders: ['Daily'],
          chooseWhenCreatingNote: false,
          createInSameFolderAsActiveFile: false,
          chooseFromSubfolders: false,
        },
        fileNameFormat: {
          enabled: true,
          format: 'today',
        },
      },
      {
        id: 'macro',
        name: 'Needs Macro Review',
        type: 'Macro',
        command: true,
      },
    ],
  }), 'utf-8');
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
    expect(preview.surfaceCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        surface: 'commands',
        label: 'Commands',
        status: 'ready',
        source: 'static-analysis',
        apis: ['addCommand'],
        hosts: ['Command Center'],
        summary: 'Command registrations map to MindOS Command Center.',
      }),
      expect.objectContaining({
        surface: 'document',
        label: 'Document',
        status: 'limited',
        apis: expect.arrayContaining(['htmlToMarkdown', 'MarkdownView']),
        limitations: expect.arrayContaining([
          'Limited APIs require capability review and focused workflow verification before relying on them.',
        ]),
      }),
      expect.objectContaining({
        surface: 'network',
        label: 'Network',
        status: 'limited',
        apis: ['requestUrl'],
        limitations: expect.arrayContaining([
          'Outbound requests are limited by protocol, host, timeout, and size policy.',
        ]),
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

  it('surfaces QuickAdd data.json Capture and Template choices in the migration preview without applying them', () => {
    const plugin = makePlugin({
      id: 'quickadd',
      manifest: { id: 'quickadd', name: 'QuickAdd', version: '2.13.1' },
      compatibilityLevel: 'partial',
      compatibility: {
        obsidianApis: ['Plugin', 'addCommand', 'Modal', 'Notice'],
        moduleImports: [],
        nodeModules: [],
        unsupportedModules: [],
        supportedApis: ['Plugin', 'addCommand'],
        partialApis: ['Modal', 'Notice'],
        unsupportedApis: [],
        blockers: [],
      },
      hasData: true,
    });
    writeQuickAddDataJson(plugin);

    const preview = buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath: '.obsidian/plugins',
      hasEnabledList: true,
    });

    expect(preview.settingsMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'quickadd-choice-inventory',
        label: 'QuickAdd choice inventory',
        source: 'data.json',
        mappedItems: [
          'Capture: Inbox Capture -> Inbox/capture.md',
          'Template: Daily Note -> Daily/today.md from Templates/daily.md',
        ],
        ignoredItems: ['Macro: Needs Macro Review (requires review)'],
        warnings: ['QuickAdd choices are copied for review; MindOS does not rewrite or auto-run them during import.'],
        appliedOnImport: false,
      }),
    ]));
    expect(preview.workflowOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'quickadd-capture-choice',
        status: 'limited',
        evidence: expect.arrayContaining([
          'Detected 1 command-enabled Capture choice in QuickAdd data.json.',
          'Capture: Inbox Capture -> Inbox/capture.md',
        ]),
      }),
      expect.objectContaining({
        id: 'quickadd-template-choice',
        status: 'limited',
        evidence: expect.arrayContaining([
          'Detected 1 command-enabled Template choice in QuickAdd data.json.',
          'Template: Daily Note -> Daily/today.md from Templates/daily.md',
        ]),
      }),
    ]));
    expect(preview.nextSteps).toEqual(expect.arrayContaining([
      'Review imported QuickAdd choices, then run workflow probes before treating Capture or Template choices as observed.',
    ]));
    expect(preview.packagePath.copiedFiles).toEqual(['manifest.json', 'main.js', 'data.json', 'obsidian-import.json']);
  });

  it('keeps official Templater runtime behind explicit editor and native gates', () => {
    const plugin = makePlugin({
      id: 'templater-obsidian',
      manifest: { id: 'templater-obsidian', name: 'Templater', version: '2.23.0' },
      compatibilityLevel: 'blocked',
      compatibility: {
        obsidianApis: ['Plugin', 'registerEditorExtension'],
        moduleImports: ['@codemirror/language', '@codemirror/state', 'child_process'],
        nodeModules: ['child_process'],
        unsupportedModules: ['@codemirror/language', '@codemirror/state', 'child_process'],
        supportedApis: ['Plugin'],
        partialApis: ['registerEditorExtension'],
        unsupportedApis: [],
        blockers: [
          'Requires unsupported runtime module: @codemirror/language',
          'Requires unsupported runtime module: @codemirror/state',
          'Requires unsupported runtime module: child_process',
        ],
      },
      hasData: true,
    });

    const preview = buildObsidianCompatibilityPreview(plugin, {
      sourcePluginsPath: '.obsidian/plugins',
      coverage: buildObsidianCapabilityCoverage(plugin.compatibility),
    });

    expect(preview.supportKind).toBe('blocked');
    expect(preview.surfaceCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        surface: 'editor',
        label: 'Editor',
        status: 'native-gated',
        apis: ['registerEditorExtension'],
      }),
      expect.objectContaining({
        surface: 'unsupported',
        label: 'Blocked capability',
        status: 'blocked',
        apis: ['module:@codemirror/language', 'module:@codemirror/state', 'module:child_process'],
        limitations: expect.arrayContaining([
          'Unsupported runtime modules: @codemirror/language, @codemirror/state, child_process.',
        ]),
      }),
    ]));
    expect(preview.workflowOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'templater-runtime-gate',
        label: 'Run dynamic Templater scripts',
        status: 'not-available',
        evidence: expect.arrayContaining([
          'Official Templater runtime depends on editor and scripting capabilities that must stay behind explicit gates.',
          'Current blockers: @codemirror/language, @codemirror/state, child_process.',
        ]),
        nextStep: 'Use QuickAdd Template choice migration for the safe template-note subset; keep official Templater behind CodeMirror/native/script gates.',
      }),
      expect.objectContaining({
        id: 'editor-native-adapter',
        status: 'native-replacement',
      }),
      expect.objectContaining({
        id: 'desktop-broker-native-replacement',
        status: 'native-replacement',
      }),
    ]));
    expect(preview.nextSteps).toEqual(expect.arrayContaining([
      'Use MindOS native editor adapters for editor-heavy behavior; raw CodeMirror extensions are not auto-mounted.',
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
    expect(preview.surfaceCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        surface: 'commands',
        status: 'ready',
      }),
      expect.objectContaining({
        surface: 'settings',
        status: 'ready',
      }),
      expect.objectContaining({
        surface: 'editor',
        status: 'native-gated',
        nextStep: 'Route this behavior through a MindOS native adapter instead of raw community plugin mounting.',
      }),
    ]));
    expect(preview.nextSteps).toEqual(expect.arrayContaining([
      'Use MindOS native editor adapters for editor-heavy behavior; raw CodeMirror extensions are not auto-mounted.',
    ]));
  });
});
