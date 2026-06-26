import type {
  ObsidianRealPluginMatrix,
  ObsidianRealPluginMatrixFailure,
  ObsidianRealPluginMatrixRow,
  ObsidianRealPluginSurfacePolicy,
} from './real-plugin-matrix';
import type { ObsidianSurfacePolicyAction } from './surface-decision';

export interface ObsidianRealPluginPolicyAudit {
  schemaVersion: 1;
  generatedAt: string;
  targetSet: string;
  sourcePolicy: string;
  summary: ObsidianRealPluginPolicyAuditSummary;
  actionGroups: ObsidianRealPluginPolicyAuditActionGroup[];
  runtimeCandidatesRequiringReview: ObsidianRealPluginPolicyAuditPlugin[];
  boundaryNotes: string[];
  failures: ObsidianRealPluginMatrixFailure[];
}

export interface ObsidianRealPluginPolicyAuditSummary {
  totalPlugins: number;
  totalSurfaces: number;
  failures: number;
  byAction: Record<ObsidianSurfacePolicyAction, ObsidianRealPluginPolicyAuditActionCount>;
  runtimeCandidatesRequiringReview: number;
}

export interface ObsidianRealPluginPolicyAuditActionCount {
  surfaces: number;
  plugins: number;
}

export interface ObsidianRealPluginPolicyAuditActionGroup {
  action: ObsidianSurfacePolicyAction;
  label: string;
  surfaceCount: number;
  pluginCount: number;
  plugins: ObsidianRealPluginPolicyAuditPlugin[];
}

export interface ObsidianRealPluginPolicyAuditPlugin {
  pluginId: string;
  pluginName: string;
  recommendation: ObsidianRealPluginMatrixRow['recommendation'];
  gateStatus: ObsidianRealPluginMatrixRow['capabilityGate']['status'];
  smokeOutcome: ObsidianRealPluginMatrixRow['smoke']['outcome'];
  surfaces: ObsidianRealPluginPolicyAuditSurface[];
}

export interface ObsidianRealPluginPolicyAuditSurface {
  surface: ObsidianRealPluginSurfacePolicy['surface'];
  label: string;
  apiCount: number;
  action: ObsidianSurfacePolicyAction;
  risk: ObsidianRealPluginSurfacePolicy['risk'];
  runtimeDefault: ObsidianRealPluginSurfacePolicy['runtimeDefault'];
  permissionBoundary: string;
  requiredEvidence: string[];
  nextStep: string;
}

const ACTION_ORDER: ObsidianSurfacePolicyAction[] = [
  'review-before-enable',
  'native-adapter',
  'blocked',
  'catalog-only',
  'allow-after-load',
];

const BOUNDARY_NOTES = [
  'Surface policy is an evidence and default-handling layer; it does not grant network, secret, vault, editor, native, or filesystem permissions.',
  'allow-after-load still requires runtime registered/called ledger evidence or focused workflow probe evidence before claiming user-visible workflow success.',
  'review-before-enable requires capability gate confirmation, runtime denied/called ledger review, and focused workflow probes before enable.',
  'native-adapter and blocked decisions keep raw community behavior out of the generic runtime until a reviewed MindOS-owned adapter exists.',
];

export function buildObsidianRealPluginPolicyAudit(
  matrix: ObsidianRealPluginMatrix,
): ObsidianRealPluginPolicyAudit {
  const byAction = emptyActionCounts();
  const groupsByAction = new Map<ObsidianSurfacePolicyAction, ObsidianRealPluginPolicyAuditActionGroup>();
  for (const action of ACTION_ORDER) {
    groupsByAction.set(action, {
      action,
      label: actionLabel(action),
      surfaceCount: 0,
      pluginCount: 0,
      plugins: [],
    });
  }

  for (const plugin of matrix.plugins) {
    for (const action of ACTION_ORDER) {
      const policies = plugin.surfacePolicies.filter((policy) => policy.action === action);
      if (policies.length === 0) continue;
      const entry = pluginAuditEntry(plugin, policies);
      const group = groupsByAction.get(action);
      if (!group) continue;
      group.plugins.push(entry);
      group.surfaceCount += policies.length;
      group.pluginCount += 1;
      byAction[action].surfaces += policies.length;
      byAction[action].plugins += 1;
    }
  }

  const runtimeCandidatesRequiringReview = matrix.plugins
    .map((plugin) => pluginAuditEntry(plugin, plugin.surfacePolicies.filter((policy) => policy.action !== 'allow-after-load')))
    .filter((entry) => entry.recommendation === 'runtime-candidate' && entry.surfaces.length > 0);

  return {
    schemaVersion: 1,
    generatedAt: matrix.generatedAt,
    targetSet: matrix.targetSet,
    sourcePolicy: matrix.sourcePolicy,
    summary: {
      totalPlugins: matrix.plugins.length,
      totalSurfaces: matrix.plugins.reduce((sum, plugin) => sum + plugin.surfacePolicies.length, 0),
      failures: matrix.failures.length,
      byAction,
      runtimeCandidatesRequiringReview: runtimeCandidatesRequiringReview.length,
    },
    actionGroups: ACTION_ORDER.map((action) => groupsByAction.get(action)).filter(isAuditGroup),
    runtimeCandidatesRequiringReview,
    boundaryNotes: BOUNDARY_NOTES,
    failures: matrix.failures,
  };
}

export function renderObsidianRealPluginPolicyAuditMarkdown(
  audit: ObsidianRealPluginPolicyAudit,
): string {
  const lines: string[] = [
    '# Obsidian Real Plugin Surface Policy Audit',
    '',
    `> Generated: ${audit.generatedAt}`,
    `> Target set: ${audit.targetSet}`,
    `> Source policy: ${audit.sourcePolicy}`,
    '',
    '## Permission Boundary',
    '',
    ...audit.boundaryNotes.map((note) => `- ${note}`),
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Plugins analyzed | ${audit.summary.totalPlugins} |`,
    `| Surface policies | ${audit.summary.totalSurfaces} |`,
    `| Runtime candidates needing review | ${audit.summary.runtimeCandidatesRequiringReview} |`,
    `| Harness failures | ${audit.summary.failures} |`,
    '',
    '| Policy action | Surfaces | Plugins |',
    '|---|---:|---:|',
    ...ACTION_ORDER.map((action) => {
      const count = audit.summary.byAction[action];
      return `| ${action} | ${count.surfaces} | ${count.plugins} |`;
    }),
    '',
    '## Runtime Candidates Needing Review',
    '',
  ];

  appendPluginSurfaceTable(lines, audit.runtimeCandidatesRequiringReview, {
    emptyText: 'No runtime candidates currently carry review, native-adapter, catalog-only, or blocked surface policies.',
    includeEvidence: false,
  });

  for (const action of ACTION_ORDER) {
    if (action === 'allow-after-load') continue;
    const group = audit.actionGroups.find((candidate) => candidate.action === action);
    lines.push(`## ${group?.label ?? actionLabel(action)}`);
    lines.push('');
    appendPluginSurfaceTable(lines, group?.plugins ?? [], { emptyText: `No ${action} surfaces were detected.`, includeEvidence: true });
  }

  const allowGroup = audit.actionGroups.find((group) => group.action === 'allow-after-load');
  lines.push('## Allow After Load');
  lines.push('');
  appendPluginSurfaceTable(lines, allowGroup?.plugins ?? [], {
    emptyText: 'No allow-after-load surfaces were detected.',
    includeEvidence: false,
  });

  if (audit.failures.length > 0) {
    lines.push('## Harness Failures');
    lines.push('');
    lines.push('| Plugin | Stage | Error |');
    lines.push('|---|---|---|');
    for (const failure of audit.failures) {
      lines.push(`| ${inlineCode(failure.id)} | ${failure.stage} | ${escapeTable(failure.error)} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function appendPluginSurfaceTable(
  lines: string[],
  plugins: ObsidianRealPluginPolicyAuditPlugin[],
  options: {
    emptyText: string;
    includeEvidence: boolean;
  },
): void {
  if (plugins.length === 0) {
    lines.push(options.emptyText);
    lines.push('');
    return;
  }
  lines.push(options.includeEvidence
    ? '| Plugin | Recommendation | Gate | Smoke | Surfaces | Required Evidence |'
    : '| Plugin | Recommendation | Gate | Smoke | Surfaces |');
  lines.push(options.includeEvidence ? '|---|---|---|---|---|---|' : '|---|---|---|---|---|');
  for (const plugin of plugins) {
    const base = [
      `${escapeTable(plugin.pluginName)} (${inlineCode(plugin.pluginId)})`,
      plugin.recommendation,
      plugin.gateStatus,
      plugin.smokeOutcome,
      surfaceSummary(plugin.surfaces, options.includeEvidence),
    ];
    const row = options.includeEvidence
      ? [...base, evidenceSummary(plugin.surfaces)]
      : base;
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
}

function pluginAuditEntry(
  plugin: ObsidianRealPluginMatrixRow,
  policies: ObsidianRealPluginSurfacePolicy[],
): ObsidianRealPluginPolicyAuditPlugin {
  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    recommendation: plugin.recommendation,
    gateStatus: plugin.capabilityGate.status,
    smokeOutcome: plugin.smoke.outcome,
    surfaces: policies.map((policy) => ({
      surface: policy.surface,
      label: policy.label,
      apiCount: policy.apiCount,
      action: policy.action,
      risk: policy.risk,
      runtimeDefault: policy.runtimeDefault,
      permissionBoundary: policy.permissionBoundary,
      requiredEvidence: policy.requiredEvidence,
      nextStep: policy.nextStep,
    })),
  };
}

function emptyActionCounts(): Record<ObsidianSurfacePolicyAction, ObsidianRealPluginPolicyAuditActionCount> {
  return {
    'allow-after-load': { surfaces: 0, plugins: 0 },
    'review-before-enable': { surfaces: 0, plugins: 0 },
    'catalog-only': { surfaces: 0, plugins: 0 },
    'native-adapter': { surfaces: 0, plugins: 0 },
    blocked: { surfaces: 0, plugins: 0 },
  };
}

function surfaceSummary(
  surfaces: ObsidianRealPluginPolicyAuditSurface[],
  includeApiCount: boolean,
): string {
  if (surfaces.length === 0) return '-';
  return surfaces
    .map((surface) => {
      if (includeApiCount) {
        return `${escapeTable(surface.label)} (${surface.risk}; ${surface.runtimeDefault}; apis=${surface.apiCount})`;
      }
      return `${escapeTable(surface.label)} (${surface.action}; ${surface.risk}; ${surface.runtimeDefault})`;
    })
    .join('<br>');
}

function evidenceSummary(surfaces: ObsidianRealPluginPolicyAuditSurface[]): string {
  const evidence = surfaces.flatMap((surface) => surface.requiredEvidence.slice(0, 2));
  if (evidence.length === 0) return '-';
  return evidence.map(escapeTable).join('; ');
}

function actionLabel(action: ObsidianSurfacePolicyAction): string {
  return action
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``;
}

function escapeTable(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function isAuditGroup(
  value: ObsidianRealPluginPolicyAuditActionGroup | undefined,
): value is ObsidianRealPluginPolicyAuditActionGroup {
  return Boolean(value);
}
