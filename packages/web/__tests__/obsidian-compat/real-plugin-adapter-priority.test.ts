import { describe, expect, it } from 'vitest';
import {
  buildObsidianRealPluginAdapterPriorityReport,
  renderObsidianRealPluginAdapterPriorityMarkdown,
} from '@/lib/obsidian-compat/real-plugin-adapter-priority';
import type {
  ObsidianEditorAdapterPlan,
  ObsidianRealPluginMatrix,
  ObsidianRealPluginMatrixRow,
  ObsidianRealPluginSurfacePolicy,
} from '@/lib/obsidian-compat/real-plugin-matrix';
import type { ObsidianCapabilitySurface } from '@/lib/obsidian-compat/capability-matrix';
import type { ObsidianSurfacePolicyAction } from '@/lib/obsidian-compat/surface-decision';

describe('Obsidian real plugin adapter priority report', () => {
  it('ranks adapter lanes from real-plugin matrix evidence without granting permissions', () => {
    const report = buildObsidianRealPluginAdapterPriorityReport(testMatrix());

    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-06-27T01:00:00.000Z',
      targetSet: 'adapter-priority-test',
      sourcePolicy: 'test-source-policy',
      summary: {
        totalPlugins: 4,
        totalCandidates: 10,
        actionableCandidates: 8,
        futureGateCandidates: 2,
        failures: 1,
      },
    });
    expect(report.boundaryNotes.some((note) => note.includes('does not grant network, secret, vault, editor, native, or filesystem permissions'))).toBe(true);
    expect(report.boundaryNotes.some((note) => note.includes('not that the community plugin is runtime-compatible today'))).toBe(true);
    expect(report.boundaryNotes.some((note) => note.includes('Future-gate lanes such as full CodeMirror and native/Desktop host remain blocked'))).toBe(true);
    expect(report.summary.topLaneIds).toEqual(expect.arrayContaining([
      'command-workflow-probe',
      'browser-editor-sandbox',
      'generic-runtime-review',
    ]));

    const browserEditorLane = report.lanes.find((lane) => lane.id === 'browser-editor-sandbox');
    expect(browserEditorLane).toMatchObject({
      label: 'Browser editor sandbox adapters',
      phase: 'now',
      candidateCount: 1,
      pluginCount: 1,
      permissionBoundary: expect.stringContaining('do not expose raw CodeMirror objects'),
      candidates: [
        expect.objectContaining({
          pluginId: 'linter-like',
          pluginName: 'Linter Like',
          editorPlan: expect.objectContaining({
            status: 'declarative-adapter-candidate',
            route: 'browser-editor-sandbox',
          }),
          surfaces: [
            expect.objectContaining({
              surface: 'editor',
              action: 'native-adapter',
            }),
          ],
          rankSignals: expect.arrayContaining([
            'editor plan: declarative-adapter-candidate',
            'Obsidian API: registerEditorExtension',
          ]),
        }),
      ],
    });

    const networkLane = report.lanes.find((lane) => lane.id === 'network-review-gate');
    expect(networkLane?.candidates).toEqual([
      expect.objectContaining({
        pluginId: 'network-commands',
        surfaces: [
          expect.objectContaining({
            surface: 'network',
            action: 'review-before-enable',
            requiredEvidence: expect.arrayContaining(['Review destinations']),
          }),
        ],
      }),
    ]);

    const fullCodeMirrorLane = report.lanes.find((lane) => lane.id === 'full-codemirror-host');
    expect(fullCodeMirrorLane).toMatchObject({
      phase: 'future-gate',
      candidates: [
        expect.objectContaining({
          pluginId: 'dataview-like',
          editorPlan: expect.objectContaining({
            status: 'full-codemirror-host',
            blockers: expect.arrayContaining(['Raw CodeMirror dependency']),
          }),
        }),
      ],
    });
  });

  it('renders a stable Markdown report with lane work, candidates, and failure notes', () => {
    const report = buildObsidianRealPluginAdapterPriorityReport(testMatrix());
    const markdown = renderObsidianRealPluginAdapterPriorityMarkdown(report);

    expect(markdown).toContain('# Obsidian Real Plugin Adapter Priority Report');
    expect(markdown).toContain('> Target set: adapter-priority-test');
    expect(markdown).toContain('## Boundary');
    expect(markdown).toContain('Adapter priority is an evidence-planning report; it does not grant network, secret, vault, editor, native, or filesystem permissions.');
    expect(markdown).toContain('| Adapter candidates | 10 |');
    expect(markdown).toContain('| Future-gate candidates | 2 |');
    expect(markdown).toContain('| Command workflow probes | now |');
    expect(markdown).toContain('| Browser editor sandbox adapters | now |');
    expect(markdown).toContain('| Full CodeMirror host | future-gate |');
    expect(markdown).toContain('## Top Candidates');
    expect(markdown).toContain('Linter Like (`linter-like`)');
    expect(markdown).toContain('QuickAdd Like (`quickadd-like`)');
    expect(markdown).toContain('Network Commands (`network-commands`)');
    expect(markdown).toContain('## Browser editor sandbox adapters');
    expect(markdown).toContain('do not expose raw CodeMirror objects');
    expect(markdown).toContain('## Network review gates');
    expect(markdown).toContain('does not create a default network allowlist');
    expect(markdown).toContain('## Harness Failures');
    expect(markdown).toContain('| `missing-plugin` | preflight | main.js is too large |');
    expect(markdown).toContain('## Reading The Result');
  });

  it('keeps old matrix snapshots without surface policies readable', () => {
    const legacyMatrix = testMatrix() as unknown as {
      plugins: Array<Partial<ObsidianRealPluginMatrixRow>>;
    };
    delete legacyMatrix.plugins[0].surfacePolicies;
    delete legacyMatrix.plugins[0].editorAdapterPlan;

    const report = buildObsidianRealPluginAdapterPriorityReport(legacyMatrix as ObsidianRealPluginMatrix);

    expect(report.summary.totalPlugins).toBe(4);
    expect(report.lanes.some((lane) => lane.id === 'browser-editor-sandbox' && lane.candidates.some((candidate) => candidate.pluginId === 'linter-like'))).toBe(false);
    expect(renderObsidianRealPluginAdapterPriorityMarkdown(report)).toContain('# Obsidian Real Plugin Adapter Priority Report');
  });
});

function testMatrix(): ObsidianRealPluginMatrix {
  const plugins = [
    pluginRow({
      id: 'linter-like',
      name: 'Linter Like',
      downloads: 2_000,
      recommendation: 'catalog-or-native',
      gateStatus: 'review',
      smokeOutcome: 'not-run',
      editorPlan: editorPlan({
        status: 'declarative-adapter-candidate',
        route: 'browser-editor-sandbox',
        signals: ['Obsidian API: registerEditorExtension'],
        nextSteps: ['Map lint findings into signed editor decorations.'],
      }),
      policies: [
        policy({
          surface: 'editor',
          label: 'Editor',
          action: 'native-adapter',
          risk: 'high',
          runtimeDefault: 'native-gated',
          requiredEvidence: ['Adapter contract'],
        }),
        policy({
          surface: 'settings',
          label: 'Settings',
          action: 'allow-after-load',
          risk: 'low',
          runtimeDefault: 'mounted',
          requiredEvidence: ['Settings schema evidence'],
        }),
      ],
    }),
    pluginRow({
      id: 'quickadd-like',
      name: 'QuickAdd Like',
      downloads: 500_000,
      recommendation: 'runtime-candidate',
      gateStatus: 'ready',
      smokeOutcome: 'loaded',
      workflowProbes: { passed: 1, failed: 0, skipped: 0 },
      policies: [
        policy({
          surface: 'commands',
          label: 'Commands',
          action: 'allow-after-load',
          risk: 'low',
          runtimeDefault: 'mounted',
          requiredEvidence: ['Command called ledger evidence'],
        }),
        policy({
          surface: 'vault',
          label: 'Vault',
          action: 'review-before-enable',
          risk: 'high',
          runtimeDefault: 'restricted',
          requiredEvidence: ['Before/after file evidence'],
        }),
      ],
    }),
    pluginRow({
      id: 'dataview-like',
      name: 'Dataview Like',
      downloads: 1_500_000,
      recommendation: 'blocked',
      gateStatus: 'blocked',
      smokeOutcome: 'skipped',
      editorPlan: editorPlan({
        status: 'full-codemirror-host',
        route: 'full-codemirror-host',
        signals: ['unsupported module: @codemirror/state'],
        blockers: ['Raw CodeMirror dependency'],
        nextSteps: ['Keep raw CodeMirror extensions catalog-only.'],
      }),
      policies: [
        policy({
          surface: 'editor',
          label: 'Editor',
          action: 'native-adapter',
          risk: 'high',
          runtimeDefault: 'native-gated',
        }),
        policy({
          surface: 'unsupported',
          label: 'Unsupported',
          action: 'blocked',
          risk: 'critical',
          runtimeDefault: 'blocked',
          requiredEvidence: ['Remove blocked module'],
        }),
      ],
    }),
    pluginRow({
      id: 'network-commands',
      name: 'Network Commands',
      downloads: 30_000,
      recommendation: 'runtime-candidate',
      gateStatus: 'ready',
      smokeOutcome: 'loaded',
      policies: [
        policy({
          surface: 'commands',
          label: 'Commands',
          action: 'allow-after-load',
          risk: 'low',
          runtimeDefault: 'mounted',
        }),
        policy({
          surface: 'network',
          label: 'Network',
          action: 'review-before-enable',
          risk: 'high',
          runtimeDefault: 'restricted',
          requiredEvidence: ['Review destinations', 'Denied/called ledger review'],
        }),
      ],
    }),
  ];

  return {
    schemaVersion: 2,
    generatedAt: '2026-06-27T01:00:00.000Z',
    targetSet: 'adapter-priority-test',
    sourcePolicy: 'test-source-policy',
    sources: {
      communityPlugins: 'https://example.com/community-plugins.json',
      communityStats: 'https://example.com/community-plugin-stats.json',
      releaseAssets: 'https://github.com/<owner>/<repo>/releases/download/<version>',
    },
    summary: {
      total: plugins.length,
      byCompatibilityLevel: { compatible: 1, partial: 2, blocked: 1 },
      byGateStatus: { ready: 2, limited: 0, review: 1, blocked: 1 },
      bySmokeOutcome: { loaded: 2, skipped: 1, failed: 0, 'not-run': 1 },
      byRecommendation: {
        'runtime-candidate': 2,
        'review-before-enable': 0,
        'catalog-or-native': 1,
        blocked: 1,
        investigate: 0,
      },
      byEditorAdapterPlan: {
        'not-editor-scoped': 2,
        'declarative-adapter-candidate': 1,
        'native-product-feature': 0,
        'full-codemirror-host': 1,
        'native-or-desktop-host': 0,
      },
      bySurfacePolicyAction: {
        'allow-after-load': 3,
        'review-before-enable': 2,
        'catalog-only': 0,
        'native-adapter': 2,
        blocked: 1,
      },
      totalDownloads: 2_032_000,
    },
    plugins,
    failures: [{ id: 'missing-plugin', stage: 'preflight', error: 'main.js is too large' }],
  };
}

function pluginRow(options: {
  id: string;
  name: string;
  downloads: number;
  recommendation: ObsidianRealPluginMatrixRow['recommendation'];
  gateStatus: ObsidianRealPluginMatrixRow['capabilityGate']['status'];
  smokeOutcome: ObsidianRealPluginMatrixRow['smoke']['outcome'];
  workflowProbes?: { passed: number; failed: number; skipped: number };
  editorPlan?: ObsidianEditorAdapterPlan;
  policies: ObsidianRealPluginSurfacePolicy[];
}): ObsidianRealPluginMatrixRow {
  const blocked = options.gateStatus === 'blocked';
  return {
    id: options.id,
    name: options.name,
    priority: 'P0',
    category: 'test-category',
    reason: 'Representative plugin.',
    author: 'Test Author',
    repo: `test/${options.id}`,
    githubUrl: `https://github.com/test/${options.id}`,
    description: `${options.name} description`,
    downloads: options.downloads,
    manifest: {
      id: options.id,
      name: options.name,
      version: '1.0.0',
    },
    package: {
      resolvedVersion: '1.0.0',
      latestVersion: '1.0.0',
      strategy: 'latest-release',
      digest: `${options.id}-digest`,
      hasStyles: false,
    },
    compatibility: {
      level: blocked ? 'blocked' : 'partial',
      supportedApis: 0,
      partialApis: 0,
      unsupportedApis: blocked ? 1 : 0,
      blockers: blocked ? ['Unsupported module.'] : [],
      unsupportedModules: blocked ? ['@codemirror/state'] : [],
    },
    capabilityGate: {
      status: options.gateStatus,
      requiresConfirmation: options.gateStatus === 'review',
      confirmed: false,
      blocked,
      fingerprint: `${options.id}-fingerprint`,
      confirmReasons: options.gateStatus === 'review' ? ['Review required.'] : [],
      blockedReasons: blocked ? ['Unsupported module.'] : [],
    },
    support: {
      kind: blocked ? 'blocked' : 'limited',
      label: blocked ? 'blocked' : 'limited',
      reason: blocked ? 'blocked support' : 'limited support',
      installable: !blocked,
    },
    surfaces: [],
    surfacePolicies: options.policies,
    smoke: {
      outcome: options.smokeOutcome,
      stage: options.smokeOutcome === 'loaded' ? 'load' : 'capability-gate',
      ...(options.workflowProbes ? {
        workflowProbes: {
          total: options.workflowProbes.passed + options.workflowProbes.failed + options.workflowProbes.skipped,
          passed: options.workflowProbes.passed,
          failed: options.workflowProbes.failed,
          skipped: options.workflowProbes.skipped,
          results: [],
        },
      } : {}),
    },
    recommendation: options.recommendation,
    editorAdapterPlan: options.editorPlan ?? editorPlan({
      status: 'not-editor-scoped',
      route: 'none',
    }),
  };
}

function editorPlan(options: Partial<ObsidianEditorAdapterPlan>): ObsidianEditorAdapterPlan {
  return {
    status: options.status ?? 'not-editor-scoped',
    route: options.route ?? 'none',
    reason: options.reason ?? 'Test editor plan.',
    signals: options.signals ?? [],
    blockers: options.blockers ?? [],
    nextSteps: options.nextSteps ?? ['Keep current path.'],
  };
}

function policy(options: {
  surface: ObsidianCapabilitySurface;
  label: string;
  action: ObsidianSurfacePolicyAction;
  risk: ObsidianRealPluginSurfacePolicy['risk'];
  runtimeDefault: ObsidianRealPluginSurfacePolicy['runtimeDefault'];
  requiredEvidence?: string[];
}): ObsidianRealPluginSurfacePolicy {
  return {
    surface: options.surface,
    label: options.label,
    apiCount: 1,
    action: options.action,
    risk: options.risk,
    runtimeDefault: options.runtimeDefault,
    permissionBoundary: `${options.label} permission boundary.`,
    requiredEvidence: options.requiredEvidence ?? [`${options.label} evidence.`],
    nextStep: `${options.label} next step.`,
  };
}
