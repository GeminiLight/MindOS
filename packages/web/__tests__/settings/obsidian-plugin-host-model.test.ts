import { describe, expect, it } from 'vitest';
import {
  capabilityLedgerHistorySummary,
  capabilityLedgerSummary,
  isLoadResult,
  isPluginActionResult,
  runtimeSummary,
  surfaceRouting,
  workflowAuditStatusLabel,
  type ObsidianPluginStatus,
} from '@/components/settings/ObsidianPluginHostModel';

function plugin(overrides: Partial<ObsidianPluginStatus> = {}): ObsidianPluginStatus {
  return {
    id: 'quickadd-like',
    name: 'QuickAdd Like',
    version: '1.0.0',
    enabled: true,
    loaded: true,
    compatibilityLevel: 'compatible',
    compatibility: {
      supportedApis: ['Plugin'],
      partialApis: [],
      blockers: [],
    },
    runtime: {
      commands: 0,
      commandList: [],
      settingTabs: 0,
      markdownPostProcessors: 0,
      markdownCodeBlockProcessors: 0,
      views: 0,
      viewExtensions: 0,
      ribbonIcons: 0,
      statusBarItems: 0,
      styleSheets: 0,
      editorExtensions: 0,
      warnings: [],
    },
    ...overrides,
  };
}

describe('ObsidianPluginHostModel', () => {
  it('summarizes mounted and cataloged runtime surfaces', () => {
    const item = plugin({
      runtime: {
        ...plugin().runtime,
        commands: 2,
        commandList: [
          { id: 'capture', fullId: 'obsidian:quickadd-like:capture', name: 'Capture' },
          {
            id: 'editor',
            fullId: 'obsidian:quickadd-like:editor',
            name: 'Editor command',
            executable: false,
            requiresEditor: true,
          },
        ],
        views: 1,
        viewList: [{ type: 'quickadd-view' }],
        viewExtensions: 1,
        viewExtensionList: [{ viewType: 'quickadd-view', extensions: ['qa'] }],
        dataFile: {
          exists: true,
          bytes: 96,
          validJson: true,
        },
        secretStorage: {
          backend: 'local-aes-256-gcm-file',
          encrypted: true,
          path: '.mindos/plugins/.secret-storage.json',
          keyPath: '.mindos/plugins/.secret-storage.key',
          pluginId: 'quickadd-like',
          secrets: 1,
        },
        styleSheets: 1,
        styleSheetList: [{ path: 'styles.css', bytes: 120 }],
        editorExtensions: 1,
        editorExtensionList: [{
          id: 'quickadd-like:editor:1',
          kind: 'StateField',
          valueType: 'object',
          serializable: true,
          mountStatus: 'catalog-only',
        }],
      },
    });

    expect(runtimeSummary(item)).toContain('2 commands');
    expect(runtimeSummary(item)).toContain('1 encrypted secret');
    expect(surfaceRouting(item).map((route) => `${route.label}:${route.state}`)).toEqual([
      'Commands:mounted',
      'Storage:mounted',
      'Secrets:mounted',
      'Views:mounted',
      'Styles:mounted',
      'Editor:catalog',
    ]);
    expect(surfaceRouting(item).find((route) => route.label === 'Views')?.value).toContain('.qa');
    expect(surfaceRouting(item).find((route) => route.label === 'Storage')?.value).toContain('data.json');
    expect(surfaceRouting(item).find((route) => route.label === 'Secrets')?.value).toContain('SecretStorage');
    expect(surfaceRouting(item).find((route) => route.label === 'Styles')?.value).toContain('Scoped stylesheet host');
  });

  it('shows Obsidian Community origin as package provenance', () => {
    const item = plugin({
      runtime: {
        ...plugin().runtime,
        communityOrigin: {
          source: 'obsidian-community',
          repo: 'chhoumann/quickadd',
          githubUrl: 'https://github.com/chhoumann/quickadd',
          installedAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-15T00:00:00.000Z',
          previousVersion: '1.0.0',
          compatibilityLevel: 'compatible',
          validJson: true,
        },
      },
    });

    expect(runtimeSummary(item)).toContain('community source');
    expect(surfaceRouting(item)).toEqual([
      expect.objectContaining({
        label: 'Source',
        state: 'mounted',
        value: 'Obsidian Community · chhoumann/quickadd · installed 2026-06-14 · updated 2026-06-15 · previous 1.0.0',
      }),
    ]);
  });

  it('summarizes merged capability ledger phases', () => {
    const item = plugin({
      capabilityLedger: [
        {
          pluginId: 'quickadd-like',
          capability: 'addCommand',
          surface: 'commands',
          support: 'full',
          phase: 'predicted',
          source: 'static-analysis',
          evidence: 'static',
        },
        {
          pluginId: 'quickadd-like',
          capability: 'addCommand',
          surface: 'commands',
          support: 'full',
          phase: 'registered',
          source: 'runtime-ledger',
          evidence: 'registered',
        },
        {
          pluginId: 'quickadd-like',
          capability: 'addCommand',
          surface: 'commands',
          support: 'full',
          phase: 'called',
          source: 'runtime-ledger',
          evidence: 'called',
        },
      ],
    });

    expect(capabilityLedgerSummary(item)).toBe('1 predicted / 1 registered / 1 called');
  });

  it('summarizes historical runtime ledger without counting static predictions', () => {
    const item = plugin({
      capabilityLedgerHistory: {
        total: 3,
        entries: [],
        summary: {
          predicted: 0,
          registered: 1,
          called: 1,
          blocked: 1,
        },
        latestBlocked: [],
        skippedCorruptLines: 0,
      },
    });

    expect(capabilityLedgerHistorySummary(item)).toBe('3 historical · 1 registered / 1 called / 1 blocked');
    expect(workflowAuditStatusLabel('native-replacement')).toBe('native');
  });

  it('keeps API result type guards narrow', () => {
    expect(isLoadResult({ loaded: [], failed: [], skipped: [] })).toBe(true);
    expect(isLoadResult({ loaded: [] })).toBe(false);
    expect(isPluginActionResult({ modalSnapshots: [] })).toBe(true);
    expect(isPluginActionResult({ loaded: [], failed: [], skipped: [] })).toBe(false);
  });
});
