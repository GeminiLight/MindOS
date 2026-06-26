import { describe, expect, it } from 'vitest';
import {
  capabilityLedgerHistorySummary,
  capabilityLedgerSummary,
  isLoadResult,
  isPluginActionResult,
  runtimeSummary,
  surfaceLedgerProjections,
  surfaceRouting,
  workflowAuditStatusLabel,
  type ObsidianPluginStatus,
} from '@/components/settings/ObsidianPluginHostModel';
import {
  compatibilityPosture,
} from '@/components/settings/ObsidianCompatibilityPostureModel';
import {
  buildObsidianPluginInventory,
} from '@/components/settings/ObsidianPluginHostInventoryModel';

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
        {
          pluginId: 'quickadd-like',
          capability: 'requestUrl',
          surface: 'network',
          support: 'limited',
          phase: 'denied',
          source: 'runtime-ledger',
          evidence: 'policy denied',
        },
      ],
    });

    expect(capabilityLedgerSummary(item)).toBe('1 predicted / 1 registered / 1 called / 1 denied');
  });

  it('projects detected surfaces against runtime ledger evidence', () => {
    const item = plugin({
      surfaceSummary: [{
        surface: 'entries',
        apiCount: 1,
        supportSummary: { full: 0, limited: 0, 'snapshot-only': 1, 'catalog-only': 0, 'request-only': 0, unsupported: 0 },
        apis: ['Notice'],
        hosts: ['Plugin entries dock'],
        routes: ['/api/obsidian-plugins'],
      }],
      capabilityLedger: [
        {
          pluginId: 'quickadd-like',
          capability: 'Notice',
          surface: 'entries',
          support: 'snapshot-only',
          phase: 'predicted',
          source: 'static-analysis',
          evidence: 'static',
        },
        {
          pluginId: 'quickadd-like',
          capability: 'Notice',
          surface: 'entries',
          support: 'snapshot-only',
          phase: 'called',
          source: 'runtime-ledger',
          evidence: 'called',
        },
      ],
    });

    expect(surfaceLedgerProjections(item)).toEqual([
      expect.objectContaining({
        surface: 'entries',
        label: 'Entries',
        support: '1 snapshot',
        apiPreview: 'Notice',
        projection: expect.objectContaining({
          status: 'called',
          predicted: 1,
          called: 1,
        }),
      }),
    ]);
  });

  it('projects runtime policy denials ahead of called evidence for a surface', () => {
    const item = plugin({
      surfaceSummary: [{
        surface: 'network',
        apiCount: 1,
        supportSummary: { full: 0, limited: 1, 'snapshot-only': 0, 'catalog-only': 0, 'request-only': 0, unsupported: 0 },
        apis: ['requestUrl'],
        hosts: ['Network policy gate'],
        routes: ['/api/obsidian-plugins'],
      }],
      capabilityLedger: [
        {
          pluginId: 'quickadd-like',
          capability: 'requestUrl',
          surface: 'network',
          support: 'limited',
          phase: 'called',
          source: 'runtime-ledger',
          evidence: 'attempted request',
        },
        {
          pluginId: 'quickadd-like',
          capability: 'requestUrl',
          surface: 'network',
          support: 'limited',
          phase: 'denied',
          source: 'runtime-ledger',
          evidence: 'requestUrl blocks local/private hosts',
        },
      ],
    });

    expect(surfaceLedgerProjections(item)).toEqual([
      expect.objectContaining({
        surface: 'network',
        label: 'Network',
        projection: expect.objectContaining({
          status: 'denied',
          called: 1,
          denied: 1,
          summary: 'Network has runtime policy denial evidence; this capability was not granted to the plugin.',
          nextStep: 'Review the denied runtime policy event before broadening this plugin capability.',
        }),
      }),
    ]);
  });

  it('keeps runtime called evidence limited until workflow proof exists', () => {
    const item = plugin({
      runtime: {
        ...plugin().runtime,
        capabilityLedger: [{
          pluginId: 'quickadd-like',
          capability: 'addCommand',
          surface: 'commands',
          support: 'full',
          phase: 'called',
          source: 'runtime-ledger',
          evidence: 'Plugin command executed.',
        }],
      },
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
          phase: 'called',
          source: 'runtime-ledger',
          evidence: 'Plugin command executed.',
        },
      ],
    });

    const posture = compatibilityPosture(item);

    expect(posture.status).toBe('limited');
    expect(posture.summary).toContain('Runtime registration or called evidence exists');
    expect(posture.evidence.find((step) => step.layer === 'runtime')).toMatchObject({
      status: 'called',
      statusLabel: 'called',
    });
    expect(posture.evidence.find((step) => step.layer === 'workflow')).toMatchObject({
      status: 'missing',
    });
  });

  it('marks posture observed only when a named workflow audit has probe evidence', () => {
    const item = plugin({
      workflowAudits: [{
        id: 'quickadd-capture-macro',
        label: 'Run capture or macro commands',
        status: 'observed',
        source: 'workflow-probe',
        evidence: ['Probe executed command and observed a vault file write.'],
        lastObservedAt: '2026-06-26T08:00:01.000Z',
        lastProbedAt: '2026-06-26T08:00:01.000Z',
        lastProbeStatus: 'passed',
      }],
    });

    const posture = compatibilityPosture(item);

    expect(posture.status).toBe('observed');
    expect(posture.label).toBe('Workflow observed');
    expect(posture.observedWorkflows).toBe(1);
    expect(posture.evidence.find((step) => step.layer === 'workflow')).toMatchObject({
      status: 'observed',
      summary: '1 workflow passed probe/audit evidence.',
    });
  });

  it('marks posture blocked when capability blockers are present', () => {
    const item = plugin({
      compatibility: {
        supportedApis: ['Plugin'],
        partialApis: [],
        unsupportedApis: ['child_process'],
        blockers: ['Unsupported Node module: child_process.'],
      },
    });

    const posture = compatibilityPosture(item);

    expect(posture.status).toBe('blocked');
    expect(posture.summary).toBe('Unsupported Node module: child_process.');
    expect(posture.evidence.find((step) => step.layer === 'static')).toMatchObject({
      status: 'blocked',
    });
  });

  it('marks posture blocked when runtime policy denial evidence is present', () => {
    const item = plugin({
      capabilityLedger: [{
        pluginId: 'quickadd-like',
        capability: 'requestUrl',
        surface: 'network',
        support: 'limited',
        phase: 'denied',
        source: 'runtime-ledger',
        evidence: 'requestUrl blocks local/private hosts',
      }],
      runtime: {
        ...plugin().runtime,
        capabilityLedger: [{
          pluginId: 'quickadd-like',
          capability: 'requestUrl',
          surface: 'network',
          support: 'limited',
          phase: 'denied',
          source: 'runtime-ledger',
          evidence: 'requestUrl blocks local/private hosts',
        }],
      },
    });

    const posture = compatibilityPosture(item);

    expect(posture.status).toBe('blocked');
    expect(posture.summary).toBe('Runtime policy denial evidence is present.');
    expect(posture.nextStep).toBe('Review denied runtime policy events before broadening this plugin capability or relying on the workflow.');
    expect(posture.evidence.find((step) => step.layer === 'static')).toMatchObject({
      status: 'denied',
      statusLabel: 'denied',
    });
    expect(posture.evidence.find((step) => step.layer === 'runtime')).toMatchObject({
      status: 'denied',
      statusLabel: 'denied',
    });
  });

  it('uses native posture for native replacement workflow audits', () => {
    const item = plugin({
      workflowAudits: [{
        id: 'dataview-native-query',
        label: 'Query notes and metadata',
        status: 'native-replacement',
        source: 'native-replacement',
        evidence: ['Use MindOS native query surfaces.'],
        nextStep: 'Route Dataview-style tables to MindOS native query.',
      }],
    });

    const posture = compatibilityPosture(item);

    expect(posture.status).toBe('native');
    expect(posture.nativeWorkflows).toBe(1);
    expect(posture.evidence.find((step) => step.layer === 'workflow')).toMatchObject({
      status: 'native',
    });
  });

  it('sorts and filters imported plugin inventory by compatibility posture', () => {
    const blocked = plugin({
      id: 'blocked-plugin',
      name: 'Blocked Plugin',
      compatibility: {
        supportedApis: ['Plugin'],
        partialApis: [],
        unsupportedApis: ['child_process'],
        blockers: ['Unsupported Node module: child_process.'],
      },
    });
    const review = plugin({
      id: 'review-plugin',
      name: 'Review Plugin',
      capabilityGate: {
        status: 'review',
        fingerprint: 'review',
        requiresConfirmation: true,
        confirmed: false,
        blocked: false,
        items: [],
        confirmReasons: ['Network APIs can contact external services.'],
        blockedReasons: [],
      },
    });
    const limited = plugin({
      id: 'limited-plugin',
      name: 'Limited Plugin',
      runtime: {
        ...plugin().runtime,
        capabilityLedger: [{
          pluginId: 'limited-plugin',
          capability: 'addCommand',
          surface: 'commands',
          support: 'full',
          phase: 'called',
          source: 'runtime-ledger',
          evidence: 'Plugin command executed.',
        }],
      },
    });
    const native = plugin({
      id: 'native-plugin',
      name: 'Native Plugin',
      workflowAudits: [{
        id: 'dataview-native-query',
        label: 'Query notes and metadata',
        status: 'native-replacement',
        source: 'native-replacement',
        evidence: ['Use MindOS native query surfaces.'],
      }],
    });
    const observed = plugin({
      id: 'observed-plugin',
      name: 'Observed Plugin',
      workflowAudits: [{
        id: 'quickadd-capture-macro',
        label: 'Run capture or macro commands',
        status: 'observed',
        source: 'workflow-probe',
        evidence: ['Probe observed a vault file write.'],
        lastProbedAt: '2026-06-26T08:00:00.000Z',
        lastProbeStatus: 'passed',
      }],
    });

    const inventory = buildObsidianPluginInventory([
      observed,
      limited,
      blocked,
      native,
      review,
    ]);

    expect(inventory.allItems.map((item) => `${item.posture.status}:${item.plugin.name}`)).toEqual([
      'blocked:Blocked Plugin',
      'review:Review Plugin',
      'limited:Limited Plugin',
      'native:Native Plugin',
      'observed:Observed Plugin',
    ]);
    expect(inventory.filterOptions).toEqual(expect.arrayContaining([
      { value: 'all', label: 'All', count: 5 },
      { value: 'blocked', label: 'Blocked', count: 1 },
      { value: 'review', label: 'Review', count: 1 },
      { value: 'limited', label: 'Limited', count: 1 },
      { value: 'native', label: 'Native', count: 1 },
      { value: 'ready', label: 'Ready', count: 0 },
      { value: 'observed', label: 'Observed', count: 1 },
    ]));

    const observedOnly = buildObsidianPluginInventory([
      observed,
      limited,
      blocked,
      native,
      review,
    ], 'observed');
    expect(observedOnly.items.map((item) => item.plugin.id)).toEqual(['observed-plugin']);
  });

  it('summarizes historical runtime ledger without counting static predictions', () => {
    const item = plugin({
      capabilityLedgerHistory: {
        total: 4,
        entries: [],
        summary: {
          predicted: 0,
          registered: 1,
          called: 1,
          denied: 1,
          blocked: 1,
        },
        latestBlocked: [],
        skippedCorruptLines: 0,
      },
    });

    expect(capabilityLedgerHistorySummary(item)).toBe('4 historical · 1 registered / 1 called / 1 denied / 1 blocked');
    expect(workflowAuditStatusLabel('native-replacement')).toBe('native');
  });

  it('keeps API result type guards narrow', () => {
    expect(isLoadResult({ loaded: [], failed: [], skipped: [] })).toBe(true);
    expect(isLoadResult({ loaded: [] })).toBe(false);
    expect(isPluginActionResult({ modalSnapshots: [] })).toBe(true);
    expect(isPluginActionResult({ loaded: [], failed: [], skipped: [] })).toBe(false);
  });
});
