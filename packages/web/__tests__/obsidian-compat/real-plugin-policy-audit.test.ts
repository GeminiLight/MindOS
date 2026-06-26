import { describe, expect, it } from 'vitest';
import {
  buildObsidianRealPluginPolicyAudit,
  renderObsidianRealPluginPolicyAuditMarkdown,
} from '@/lib/obsidian-compat/real-plugin-policy-audit';
import type {
  ObsidianRealPluginMatrix,
  ObsidianRealPluginMatrixRow,
  ObsidianRealPluginSurfacePolicy,
} from '@/lib/obsidian-compat/real-plugin-matrix';
import type { ObsidianCapabilitySurface } from '@/lib/obsidian-compat/capability-matrix';
import type { ObsidianSurfacePolicyAction } from '@/lib/obsidian-compat/surface-decision';

describe('Obsidian real plugin policy audit', () => {
  it('groups real-plugin surface policies into reviewable action buckets', () => {
    const audit = buildObsidianRealPluginPolicyAudit(testMatrix());

    expect(audit).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-06-27T00:00:00.000Z',
      targetSet: 'test-p0',
      sourcePolicy: 'test-source-policy',
      summary: {
        totalPlugins: 4,
        totalSurfaces: 5,
        failures: 1,
        byAction: {
          'allow-after-load': { surfaces: 1, plugins: 1 },
          'review-before-enable': { surfaces: 1, plugins: 1 },
          'catalog-only': { surfaces: 1, plugins: 1 },
          'native-adapter': { surfaces: 1, plugins: 1 },
          blocked: { surfaces: 1, plugins: 1 },
        },
        runtimeCandidatesRequiringReview: 1,
      },
    });
    expect(audit.actionGroups.map((group) => group.action)).toEqual([
      'review-before-enable',
      'native-adapter',
      'blocked',
      'catalog-only',
      'allow-after-load',
    ]);
    expect(audit.actionGroups.find((group) => group.action === 'review-before-enable')?.plugins).toEqual([
      expect.objectContaining({
        pluginId: 'loaded-network',
        pluginName: 'Loaded Network',
        recommendation: 'runtime-candidate',
        gateStatus: 'ready',
        smokeOutcome: 'loaded',
        surfaces: [
          expect.objectContaining({
            surface: 'network',
            label: 'Network',
            action: 'review-before-enable',
            risk: 'high',
            runtimeDefault: 'restricted',
          }),
        ],
      }),
    ]);
    expect(audit.runtimeCandidatesRequiringReview).toEqual([
      expect.objectContaining({
        pluginId: 'loaded-network',
        surfaces: [expect.objectContaining({ action: 'review-before-enable', surface: 'network' })],
      }),
    ]);
    expect(audit.boundaryNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('does not grant network, secret, vault, editor, native, or filesystem permissions'),
      expect.stringContaining('allow-after-load still requires runtime registered/called ledger evidence'),
      expect.stringContaining('review-before-enable requires capability gate confirmation'),
    ]));
  });

  it('renders a stable Markdown audit with permission-boundary language', () => {
    const audit = buildObsidianRealPluginPolicyAudit(testMatrix());
    const markdown = renderObsidianRealPluginPolicyAuditMarkdown(audit);

    expect(markdown).toContain('# Obsidian Real Plugin Surface Policy Audit');
    expect(markdown).toContain('> Target set: test-p0');
    expect(markdown).toContain('## Permission Boundary');
    expect(markdown).toContain('Surface policy is an evidence and default-handling layer; it does not grant network, secret, vault, editor, native, or filesystem permissions.');
    expect(markdown).toContain('| review-before-enable | 1 | 1 |');
    expect(markdown).toContain('| native-adapter | 1 | 1 |');
    expect(markdown).toContain('| blocked | 1 | 1 |');
    expect(markdown).toContain('## Runtime Candidates Needing Review');
    expect(markdown).toContain('| Loaded Network (`loaded-network`) | runtime-candidate | ready | loaded | Network (review-before-enable; high; restricted) |');
    expect(markdown).toContain('## Review Before Enable');
    expect(markdown).toContain('| Loaded Network (`loaded-network`) | runtime-candidate | ready | loaded | Network (high; restricted; apis=1) | Capability gate confirmation; Ledger denied/called review |');
    expect(markdown).toContain('## Native Adapter');
    expect(markdown).toContain('| Editor Bridge (`editor-bridge`) | catalog-or-native | review | skipped | Editor (high; native-gated; apis=1) | Adapter contract; Isolation fixture |');
    expect(markdown).toContain('## Blocked');
    expect(markdown).toContain('| Blocked Module (`blocked-module`) | blocked | blocked | skipped | Unsupported (critical; blocked; apis=1) | Remove blocked module |');
    expect(markdown).toContain('## Harness Failures');
    expect(markdown).toContain('| `missing-plugin` | preflight | main.js is too large |');
  });
});

function testMatrix(): ObsidianRealPluginMatrix {
  const plugins: ObsidianRealPluginMatrixRow[] = [
    pluginRow({
      id: 'loaded-network',
      name: 'Loaded Network',
      recommendation: 'runtime-candidate',
      gateStatus: 'ready',
      smokeOutcome: 'loaded',
      policies: [
        policy({ surface: 'commands', label: 'Commands', action: 'allow-after-load', risk: 'low', runtimeDefault: 'mounted' }),
        policy({
          surface: 'network',
          label: 'Network',
          action: 'review-before-enable',
          risk: 'high',
          runtimeDefault: 'restricted',
          requiredEvidence: [
            'Capability gate confirmation',
            'Ledger denied/called review',
            'Focused workflow probe',
          ],
        }),
      ],
    }),
    pluginRow({
      id: 'editor-bridge',
      name: 'Editor Bridge',
      recommendation: 'catalog-or-native',
      gateStatus: 'review',
      smokeOutcome: 'skipped',
      policies: [
        policy({
          surface: 'editor',
          label: 'Editor',
          action: 'native-adapter',
          risk: 'high',
          runtimeDefault: 'native-gated',
          requiredEvidence: ['Adapter contract', 'Isolation fixture'],
        }),
      ],
    }),
    pluginRow({
      id: 'blocked-module',
      name: 'Blocked Module',
      recommendation: 'blocked',
      gateStatus: 'blocked',
      smokeOutcome: 'skipped',
      policies: [
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
      id: 'catalog-note',
      name: 'Catalog Note',
      recommendation: 'catalog-or-native',
      gateStatus: 'limited',
      smokeOutcome: 'not-run',
      policies: [
        policy({
          surface: 'views',
          label: 'Views',
          action: 'catalog-only',
          risk: 'medium',
          runtimeDefault: 'catalog',
        }),
      ],
    }),
  ];
  return {
    schemaVersion: 2,
    generatedAt: '2026-06-27T00:00:00.000Z',
    targetSet: 'test-p0',
    sourcePolicy: 'test-source-policy',
    sources: {
      communityPlugins: 'https://example.com/community-plugins.json',
      communityStats: 'https://example.com/community-plugin-stats.json',
      releaseAssets: 'https://github.com/<owner>/<repo>/releases/download/<version>',
    },
    summary: {
      total: plugins.length,
      byCompatibilityLevel: { compatible: 1, partial: 2, blocked: 1 },
      byGateStatus: { ready: 1, limited: 1, review: 1, blocked: 1 },
      bySmokeOutcome: { loaded: 1, skipped: 2, failed: 0, 'not-run': 1 },
      byRecommendation: {
        'runtime-candidate': 1,
        'review-before-enable': 0,
        'catalog-or-native': 2,
        blocked: 1,
        investigate: 0,
      },
      byEditorAdapterPlan: {
        'not-editor-scoped': 3,
        'declarative-adapter-candidate': 0,
        'native-product-feature': 0,
        'full-codemirror-host': 0,
        'native-or-desktop-host': 1,
      },
      bySurfacePolicyAction: {
        'allow-after-load': 1,
        'review-before-enable': 1,
        'catalog-only': 1,
        'native-adapter': 1,
        blocked: 1,
      },
      totalDownloads: 100,
    },
    plugins,
    failures: [{ id: 'missing-plugin', stage: 'preflight', error: 'main.js is too large' }],
  };
}

function pluginRow(options: {
  id: string;
  name: string;
  recommendation: ObsidianRealPluginMatrixRow['recommendation'];
  gateStatus: ObsidianRealPluginMatrixRow['capabilityGate']['status'];
  smokeOutcome: ObsidianRealPluginMatrixRow['smoke']['outcome'];
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
    downloads: 25,
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
      unsupportedModules: blocked ? ['electron'] : [],
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
    },
    recommendation: options.recommendation,
    editorAdapterPlan: {
      status: options.id === 'editor-bridge' ? 'native-or-desktop-host' : 'not-editor-scoped',
      route: options.id === 'editor-bridge' ? 'native-or-desktop-host' : 'none',
      reason: 'Test plan.',
      signals: [],
      blockers: [],
      nextSteps: [],
    },
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
