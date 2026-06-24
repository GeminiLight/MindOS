import { describe, expect, it } from 'vitest';
import type { ObsidianCapabilityGateReport } from '@/lib/obsidian-compat/capability-gate';
import {
  buildObsidianRealPluginMatrix,
  renderObsidianRealPluginMatrixMarkdown,
  type ObsidianRealPluginMatrixInputItem,
  type ObsidianRealPluginSmokeResult,
} from '@/lib/obsidian-compat/real-plugin-matrix';
import type { ObsidianCommunityPluginPreflight } from '@/lib/obsidian-compat/community-catalog';

describe('Obsidian real plugin matrix', () => {
  it('summarizes real-plugin rows into action-oriented recommendations', () => {
    const matrix = buildObsidianRealPluginMatrix({
      generatedAt: '2026-06-24T00:00:00.000Z',
      targetSet: 'test-p0',
      sourcePolicy: 'test-source-policy',
      sources: testSources(),
      plugins: [
        matrixItem({
          id: 'loaded-plugin',
          name: 'Loaded Plugin',
          supportKind: 'limited',
          compatibilityLevel: 'partial',
          gate: gateReport({ status: 'limited' }),
          smoke: { outcome: 'loaded', stage: 'load', runtime: runtimeSummary({ commands: 2 }) },
          downloads: 10,
        }),
        matrixItem({
          id: 'native-plugin',
          name: 'Native Plugin',
          supportKind: 'native',
          compatibilityLevel: 'blocked',
          gate: gateReport({ status: 'blocked', blockedReasons: ['Requires native Desktop capabilities.'] }),
          smoke: { outcome: 'skipped', stage: 'capability-gate', reason: 'Native runtime only.' },
          downloads: 20,
        }),
        matrixItem({
          id: 'blocked-plugin',
          name: 'Blocked Plugin',
          category: 'editor-enhancement',
          supportKind: 'blocked',
          compatibilityLevel: 'blocked',
          unsupportedModules: ['@codemirror/state', '@codemirror/view'],
          gate: gateReport({ status: 'blocked', blockedReasons: ['Unsupported API.'] }),
          smoke: { outcome: 'skipped', stage: 'capability-gate', reason: 'Unsupported API.' },
          downloads: 30,
        }),
      ],
      failures: [{ id: 'oversized-plugin', stage: 'preflight', error: 'main.js is too large' }],
    });

    expect(matrix.summary).toMatchObject({
      total: 3,
      totalDownloads: 60,
      byCompatibilityLevel: { compatible: 0, partial: 1, blocked: 2 },
      byGateStatus: { ready: 0, limited: 1, review: 0, blocked: 2 },
      bySmokeOutcome: { loaded: 1, skipped: 2, failed: 0, 'not-run': 0 },
      byRecommendation: {
        'runtime-candidate': 1,
        'review-before-enable': 0,
        'catalog-or-native': 1,
        blocked: 1,
        investigate: 0,
      },
      byEditorAdapterPlan: {
        'not-editor-scoped': 2,
        'declarative-adapter-candidate': 0,
        'native-product-feature': 0,
        'full-codemirror-host': 1,
        'native-or-desktop-host': 0,
      },
    });
    expect(matrix.plugins.map((plugin) => [plugin.id, plugin.recommendation])).toEqual([
      ['loaded-plugin', 'runtime-candidate'],
      ['native-plugin', 'catalog-or-native'],
      ['blocked-plugin', 'blocked'],
    ]);
    expect(matrix.plugins.find((plugin) => plugin.id === 'blocked-plugin')?.editorAdapterPlan).toMatchObject({
      status: 'full-codemirror-host',
      route: 'full-codemirror-host',
      signals: expect.arrayContaining(['unsupported module: @codemirror/state']),
      nextSteps: expect.arrayContaining([
        expect.stringContaining('Keep raw CodeMirror extensions catalog-only'),
      ]),
    });
    expect(matrix.failures).toEqual([{ id: 'oversized-plugin', stage: 'preflight', error: 'main.js is too large' }]);
  });

  it('renders a stable Markdown report with blockers, failures, and table columns', () => {
    const matrix = buildObsidianRealPluginMatrix({
      generatedAt: '2026-06-24T00:00:00.000Z',
      targetSet: 'test-p0',
      sourcePolicy: 'test-source-policy',
      sources: testSources(),
      plugins: [
        matrixItem({
          id: 'review-plugin',
          name: 'Review Plugin',
          supportKind: 'review',
          compatibilityLevel: 'partial',
          obsidianApis: ['registerEditorExtension'],
          gate: gateReport({
            status: 'review',
            requiresConfirmation: true,
            confirmReasons: ['Vault APIs can read or change local MindOS files inside the vault boundary.'],
          }),
          smoke: { outcome: 'not-run', stage: 'not-run', reason: 'Smoke harness was skipped.' },
          surfaces: [{ id: 'commands', state: 'mounted', count: 2 }],
        }),
      ],
      failures: [{ id: 'missing-plugin', stage: 'catalog', error: 'Plugin id was not found.' }],
    });

    const markdown = renderObsidianRealPluginMatrixMarkdown(matrix);
    const matrixRow = markdown.split('\n').find((line) => line.includes('`review-plugin`'));

    expect(matrixRow).toBeDefined();
    expect(matrixRow?.split('|')).toHaveLength(11);
    expect(matrixRow).toContain('review (confirmation)');
    expect(matrixRow).toContain('commands:mountedx2');
    expect(matrixRow).toContain('declarative adapter candidate');
    expect(markdown).toContain('| Declarative editor adapter candidates | 1 |');
    expect(markdown).toContain('## Editor Adapter Plans');
    expect(markdown).toContain('### Review Plugin');
    expect(markdown).toContain('- Route: `browser-editor-sandbox`');
    expect(markdown).toContain('- Signal: Obsidian API: registerEditorExtension');
    expect(markdown).toContain('## Blockers And Review Reasons');
    expect(markdown).toContain('- Vault APIs can read or change local MindOS files inside the vault boundary.');
    expect(markdown).toContain('## Harness Failures');
    expect(markdown).toContain('| `missing-plugin` | catalog | Plugin id was not found. |');
  });
});

function matrixItem(options: {
  id: string;
  name: string;
  category?: string;
  supportKind: ObsidianCommunityPluginPreflight['support']['kind'];
  compatibilityLevel: ObsidianCommunityPluginPreflight['compatibility']['level'];
  gate: ObsidianCapabilityGateReport;
  smoke: ObsidianRealPluginSmokeResult;
  downloads?: number;
  surfaces?: ObsidianCommunityPluginPreflight['surfacePreview'];
  obsidianApis?: string[];
  unsupportedApis?: string[];
  unsupportedModules?: string[];
}): ObsidianRealPluginMatrixInputItem {
  return {
    target: {
      id: options.id,
      priority: 'P0',
      category: options.category ?? 'test-category',
      reason: 'Representative test plugin.',
    },
    catalog: {
      id: options.id,
      name: options.name,
      description: `${options.name} description`,
      author: 'Test Author',
      repo: `test/${options.id}`,
      githubUrl: `https://github.com/test/${options.id}`,
    },
    stats: typeof options.downloads === 'number' ? { downloads: options.downloads } : undefined,
    preflight: preflight({
      id: options.id,
      name: options.name,
      supportKind: options.supportKind,
      compatibilityLevel: options.compatibilityLevel,
      surfaces: options.surfaces,
      obsidianApis: options.obsidianApis,
      unsupportedApis: options.unsupportedApis,
      unsupportedModules: options.unsupportedModules,
    }),
    capabilityGate: options.gate,
    smoke: options.smoke,
  };
}

function preflight(options: {
  id: string;
  name: string;
  supportKind: ObsidianCommunityPluginPreflight['support']['kind'];
  compatibilityLevel: ObsidianCommunityPluginPreflight['compatibility']['level'];
  surfaces?: ObsidianCommunityPluginPreflight['surfacePreview'];
  obsidianApis?: string[];
  unsupportedApis?: string[];
  unsupportedModules?: string[];
}): ObsidianCommunityPluginPreflight {
  const blocked = options.compatibilityLevel === 'blocked';
  const obsidianApis = options.obsidianApis ?? [];
  const unsupportedApis = options.unsupportedApis ?? [];
  const unsupportedModules = options.unsupportedModules ?? [];
  return {
    ok: true,
    plugin: {
      id: options.id,
      name: options.name,
      repo: `test/${options.id}`,
      githubUrl: `https://github.com/test/${options.id}`,
    },
    package: {
      manifest: {
        id: options.id,
        name: options.name,
        version: '1.0.0',
      },
      assets: {
        manifestJson: true,
        mainJs: true,
        stylesCss: false,
      },
      source: {
        type: 'github-release',
        strategy: 'latest-release',
        resolvedVersion: '1.0.0',
        latestVersion: '1.0.0',
        versionsUrl: `https://example.com/${options.id}/versions.json`,
        manifestUrl: `https://example.com/${options.id}/manifest.json`,
        mainUrl: `https://example.com/${options.id}/main.js`,
        stylesUrl: `https://example.com/${options.id}/styles.css`,
      },
      digest: {
        algorithm: 'sha256',
        manifestJson: 'manifest-digest',
        mainJs: 'main-digest',
        package: `${options.id}-package-digest`,
      },
    },
    compatibility: {
      level: options.compatibilityLevel,
      report: {
        obsidianApis,
        moduleImports: [],
        nodeModules: [],
        supportedModules: [],
        unsupportedModules,
        supportedApis: [],
        partialApis: [],
        unsupportedApis,
        blockers: blocked ? ['Unsupported API.'] : [],
      },
    },
    policy: {
      status: 'ok',
      issues: [],
    },
    derivedCapabilities: {
      coverage: [],
      summary: {
        full: 0,
        limited: 0,
        'snapshot-only': 0,
        'catalog-only': 0,
        'request-only': 0,
        unsupported: 0,
      },
    },
    support: {
      kind: options.supportKind,
      label: options.supportKind,
      reason: `${options.supportKind} support`,
      installable: !blocked,
    },
    surfacePreview: options.surfaces ?? [],
    installable: !blocked,
    installBlockedReasons: blocked ? ['Unsupported API.'] : [],
  } as ObsidianCommunityPluginPreflight;
}

function gateReport(options: {
  status: ObsidianCapabilityGateReport['status'];
  requiresConfirmation?: boolean;
  confirmReasons?: string[];
  blockedReasons?: string[];
}): ObsidianCapabilityGateReport {
  const blockedReasons = options.blockedReasons ?? [];
  const confirmReasons = options.confirmReasons ?? [];
  return {
    status: options.status,
    fingerprint: `${options.status}-fingerprint`,
    requiresConfirmation: options.requiresConfirmation ?? confirmReasons.length > 0,
    confirmed: false,
    blocked: options.status === 'blocked' || blockedReasons.length > 0,
    items: [],
    confirmReasons,
    blockedReasons,
  };
}

function runtimeSummary(
  overrides: Partial<NonNullable<ObsidianRealPluginSmokeResult['runtime']>>,
): NonNullable<ObsidianRealPluginSmokeResult['runtime']> {
  return {
    commands: 0,
    settingTabs: 0,
    views: 0,
    markdownPostProcessors: 0,
    markdownCodeBlockProcessors: 0,
    ribbonIcons: 0,
    statusBarItems: 0,
    styleSheets: 0,
    editorExtensions: 0,
    ...overrides,
  };
}

function testSources() {
  return {
    communityPlugins: 'https://example.com/community-plugins.json',
    communityStats: 'https://example.com/community-plugin-stats.json',
    releaseAssets: 'https://github.com/<owner>/<repo>/releases/download/<version>',
  };
}
