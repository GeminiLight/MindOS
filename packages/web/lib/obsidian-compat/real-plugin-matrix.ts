import type { ObsidianCapabilityGateReport } from './capability-gate';
import type { ObsidianCommunityPluginPreflight } from './community-catalog';
import {
  summarizeObsidianCapabilitySurfaces,
  type ObsidianCapabilitySurface,
} from './capability-matrix';
import type {
  ObsidianCommunityPreflightSupportLevel,
  ObsidianCommunitySurfacePreview,
} from './community-support';
import type { CompatibilityLevel } from './compatibility-report';
import {
  buildObsidianSurfacePolicyDecision,
  type ObsidianSurfacePolicyAction,
  type ObsidianSurfacePolicyRisk,
  type ObsidianSurfacePolicyRuntimeDefault,
} from './surface-decision';
import type { ObsidianSurfaceCatalogStatus } from './compatibility-preview';
import type {
  ObsidianWorkflowProbeResult,
} from './workflow-probes';

export type ObsidianRealPluginPriority = 'P0' | 'P1' | 'P2';
export type ObsidianRealPluginSmokeOutcome = 'loaded' | 'skipped' | 'failed' | 'not-run';
export type ObsidianRealPluginRecommendation =
  | 'runtime-candidate'
  | 'review-before-enable'
  | 'catalog-or-native'
  | 'blocked'
  | 'investigate';

export type ObsidianEditorAdapterPlanStatus =
  | 'not-editor-scoped'
  | 'declarative-adapter-candidate'
  | 'native-product-feature'
  | 'full-codemirror-host'
  | 'native-or-desktop-host';

export type ObsidianEditorAdapterPlanRoute =
  | 'none'
  | 'browser-editor-sandbox'
  | 'mindos-native-surface'
  | 'full-codemirror-host'
  | 'native-or-desktop-host';

export interface ObsidianRealPluginTarget {
  id: string;
  priority: ObsidianRealPluginPriority;
  category: string;
  reason: string;
}

export interface ObsidianRealPluginCatalogInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  repo: string;
  githubUrl?: string;
}

export interface ObsidianRealPluginStats {
  downloads?: number;
  updated?: string;
}

export interface ObsidianRealPluginSmokeResult {
  outcome: ObsidianRealPluginSmokeOutcome;
  stage: 'not-run' | 'capability-gate' | 'enable' | 'load';
  reason?: string;
  loaded?: string[];
  failed?: string[];
  skipped?: string[];
  runtime?: {
    commands: number;
    settingTabs: number;
    views: number;
    markdownPostProcessors: number;
    markdownCodeBlockProcessors: number;
    ribbonIcons: number;
    statusBarItems: number;
    styleSheets: number;
    editorExtensions: number;
  };
  workflowProbes?: ObsidianRealPluginWorkflowProbeSummary;
}

export interface ObsidianRealPluginWorkflowProbeSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: Array<Pick<ObsidianWorkflowProbeResult, 'id' | 'label' | 'status' | 'completedAt' | 'failureReason' | 'evidence'>>;
}

export interface ObsidianRealPluginMatrixInputItem {
  target: ObsidianRealPluginTarget;
  catalog: ObsidianRealPluginCatalogInfo;
  stats?: ObsidianRealPluginStats;
  preflight: ObsidianCommunityPluginPreflight;
  capabilityGate: ObsidianCapabilityGateReport;
  smoke: ObsidianRealPluginSmokeResult;
}

export interface ObsidianRealPluginMatrixFailure {
  id: string;
  stage: 'catalog' | 'fetch' | 'preflight' | 'smoke';
  error: string;
}

export interface ObsidianRealPluginMatrixRow {
  id: string;
  name: string;
  priority: ObsidianRealPluginPriority;
  category: string;
  reason: string;
  author: string;
  repo: string;
  githubUrl?: string;
  description: string;
  downloads?: number;
  updated?: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    minAppVersion?: string;
    isDesktopOnly?: boolean;
  };
  package: {
    resolvedVersion: string;
    latestVersion: string;
    strategy: string;
    digest: string;
    hasStyles: boolean;
  };
  compatibility: {
    level: CompatibilityLevel;
    supportedApis: number;
    partialApis: number;
    unsupportedApis: number;
    blockers: string[];
    unsupportedModules: string[];
  };
  capabilityGate: {
    status: ObsidianCapabilityGateReport['status'];
    requiresConfirmation: boolean;
    confirmed: boolean;
    blocked: boolean;
    fingerprint: string;
    confirmReasons: string[];
    blockedReasons: string[];
  };
  support: {
    kind: ObsidianCommunityPreflightSupportLevel;
    label: string;
    reason: string;
    installable: boolean;
  };
  surfaces: ObsidianCommunitySurfacePreview[];
  surfacePolicies: ObsidianRealPluginSurfacePolicy[];
  smoke: ObsidianRealPluginSmokeResult;
  recommendation: ObsidianRealPluginRecommendation;
  editorAdapterPlan: ObsidianEditorAdapterPlan;
}

export interface ObsidianRealPluginMatrixSummary {
  total: number;
  byCompatibilityLevel: Record<CompatibilityLevel, number>;
  byGateStatus: Record<ObsidianCapabilityGateReport['status'], number>;
  bySmokeOutcome: Record<ObsidianRealPluginSmokeOutcome, number>;
  byRecommendation: Record<ObsidianRealPluginRecommendation, number>;
  byEditorAdapterPlan: Record<ObsidianEditorAdapterPlanStatus, number>;
  bySurfacePolicyAction: Record<ObsidianSurfacePolicyAction, number>;
  totalDownloads: number;
}

export interface ObsidianRealPluginSurfacePolicy {
  surface: ObsidianCapabilitySurface;
  label: string;
  apiCount: number;
  action: ObsidianSurfacePolicyAction;
  risk: ObsidianSurfacePolicyRisk;
  runtimeDefault: ObsidianSurfacePolicyRuntimeDefault;
  permissionBoundary: string;
  requiredEvidence: string[];
  nextStep: string;
}

export interface ObsidianEditorAdapterPlan {
  status: ObsidianEditorAdapterPlanStatus;
  route: ObsidianEditorAdapterPlanRoute;
  reason: string;
  signals: string[];
  blockers: string[];
  nextSteps: string[];
}

export interface ObsidianRealPluginMatrix {
  schemaVersion: 2;
  generatedAt: string;
  targetSet: string;
  sourcePolicy: string;
  sources: {
    communityPlugins: string;
    communityStats: string;
    releaseAssets: string;
  };
  summary: ObsidianRealPluginMatrixSummary;
  plugins: ObsidianRealPluginMatrixRow[];
  failures: ObsidianRealPluginMatrixFailure[];
}

export interface BuildObsidianRealPluginMatrixInput {
  generatedAt: string;
  targetSet: string;
  sourcePolicy: string;
  sources: ObsidianRealPluginMatrix['sources'];
  plugins: ObsidianRealPluginMatrixInputItem[];
  failures?: ObsidianRealPluginMatrixFailure[];
}

export function buildObsidianRealPluginMatrix(
  input: BuildObsidianRealPluginMatrixInput,
): ObsidianRealPluginMatrix {
  const plugins = input.plugins.map(toMatrixRow);
  return {
    schemaVersion: 2,
    generatedAt: input.generatedAt,
    targetSet: input.targetSet,
    sourcePolicy: input.sourcePolicy,
    sources: input.sources,
    summary: summarizeRows(plugins),
    plugins,
    failures: input.failures ?? [],
  };
}

export function renderObsidianRealPluginMatrixMarkdown(matrix: ObsidianRealPluginMatrix): string {
  const lines: string[] = [
    '# Obsidian P0 Real Plugin Compatibility Matrix',
    '',
    `> Generated: ${matrix.generatedAt}`,
    `> Target set: ${matrix.targetSet}`,
    `> Source policy: ${matrix.sourcePolicy}`,
    '',
    '## Sources',
    '',
    `- Community plugin index: ${matrix.sources.communityPlugins}`,
    `- Community plugin stats: ${matrix.sources.communityStats}`,
    `- Plugin package assets: ${matrix.sources.releaseAssets}`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Plugins analyzed | ${matrix.summary.total} |`,
    `| Total downloads represented | ${formatNumber(matrix.summary.totalDownloads)} |`,
    `| Runtime candidates | ${matrix.summary.byRecommendation['runtime-candidate']} |`,
    `| Review before enable | ${matrix.summary.byRecommendation['review-before-enable']} |`,
    `| Catalog or native replacement | ${matrix.summary.byRecommendation['catalog-or-native']} |`,
    `| Blocked | ${matrix.summary.byRecommendation.blocked} |`,
    `| Investigate | ${matrix.summary.byRecommendation.investigate} |`,
    `| Declarative editor adapter candidates | ${matrix.summary.byEditorAdapterPlan['declarative-adapter-candidate']} |`,
    `| Full CodeMirror host required | ${matrix.summary.byEditorAdapterPlan['full-codemirror-host']} |`,
    `| Native product feature preferred | ${matrix.summary.byEditorAdapterPlan['native-product-feature']} |`,
    `| Surfaces requiring review | ${matrix.summary.bySurfacePolicyAction['review-before-enable']} |`,
    `| Catalog-only surfaces | ${matrix.summary.bySurfacePolicyAction['catalog-only']} |`,
    `| Native adapter surfaces | ${matrix.summary.bySurfacePolicyAction['native-adapter']} |`,
    `| Blocked surfaces | ${matrix.summary.bySurfacePolicyAction.blocked} |`,
    '',
    '## Matrix',
    '',
    '| Plugin | Category | Downloads | Compat | Gate | Smoke | Probes | Surfaces | Policy | Editor Plan | Recommendation |',
    '|---|---|---:|---|---|---|---|---|---|---|---|',
    ...matrix.plugins.map((plugin) => `| ${[
      `${markdownLink(plugin.name, plugin.githubUrl)} (${inlineCode(plugin.id)})`,
      plugin.category,
      formatNumber(plugin.downloads ?? 0),
      plugin.compatibility.level,
      gateLabel(plugin),
      smokeLabel(plugin.smoke),
      workflowProbeLabel(plugin.smoke.workflowProbes),
      surfaceLabel(plugin.surfaces),
      surfacePolicyLabel(plugin.surfacePolicies),
      editorAdapterPlanLabel(plugin.editorAdapterPlan),
      recommendationLabel(plugin.recommendation),
    ].join(' | ')} |`),
    '',
    '## Surface Policy Decisions',
    '',
  ];

  for (const plugin of matrix.plugins) {
    const actionablePolicies = plugin.surfacePolicies.filter((policy) => policy.action !== 'allow-after-load');
    if (actionablePolicies.length === 0) continue;
    lines.push(`### ${plugin.name}`);
    lines.push('');
    for (const policy of actionablePolicies.slice(0, 8)) {
      lines.push(`- ${policy.label}: ${surfacePolicyActionLabel(policy.action)} (${policy.risk}; ${policy.runtimeDefault})`);
      lines.push(`  - Boundary: ${policy.permissionBoundary}`);
      for (const evidence of policy.requiredEvidence.slice(0, 2)) {
        lines.push(`  - Evidence: ${evidence}`);
      }
      lines.push(`  - Next: ${policy.nextStep}`);
    }
    lines.push('');
  }

  lines.push(
    '## Editor Adapter Plans',
    '',
  );

  for (const plugin of matrix.plugins) {
    if (plugin.editorAdapterPlan.status === 'not-editor-scoped') continue;
    lines.push(`### ${plugin.name}`);
    lines.push('');
    lines.push(`- Plan: ${editorAdapterPlanLabel(plugin.editorAdapterPlan)}`);
    lines.push(`- Route: ${inlineCode(plugin.editorAdapterPlan.route)}`);
    lines.push(`- Reason: ${plugin.editorAdapterPlan.reason}`);
    for (const signal of plugin.editorAdapterPlan.signals.slice(0, 6)) {
      lines.push(`- Signal: ${signal}`);
    }
    for (const blocker of plugin.editorAdapterPlan.blockers.slice(0, 4)) {
      lines.push(`- Blocker: ${blocker}`);
    }
    for (const nextStep of plugin.editorAdapterPlan.nextSteps.slice(0, 4)) {
      lines.push(`- Next: ${nextStep}`);
    }
    lines.push('');
  }

  lines.push(
    '## Blockers And Review Reasons',
    '',
  );

  for (const plugin of matrix.plugins) {
    const reasons = [
      ...plugin.capabilityGate.blockedReasons,
      ...plugin.capabilityGate.confirmReasons,
      ...(plugin.smoke.reason ? [`Smoke: ${plugin.smoke.reason}`] : []),
      ...(plugin.smoke.workflowProbes?.results ?? [])
        .filter((result) => result.status === 'failed')
        .map((result) => `Workflow probe ${result.id}: ${result.failureReason ?? 'failed'}`),
    ];
    if (reasons.length === 0) continue;
    lines.push(`### ${plugin.name}`);
    lines.push('');
    for (const reason of reasons.slice(0, 8)) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  if (matrix.failures.length > 0) {
    lines.push('## Harness Failures');
    lines.push('');
    lines.push('| Plugin | Stage | Error |');
    lines.push('|---|---|---|');
    for (const failure of matrix.failures) {
      lines.push(`| ${inlineCode(failure.id)} | ${failure.stage} | ${escapeTable(failure.error)} |`);
    }
    lines.push('');
  }

  lines.push('## Reading The Result');
  lines.push('');
  lines.push('- `runtime-candidate` means the plugin reached a loadable MindOS runtime state in the smoke harness.');
  lines.push('- `Probes` are explicit workflow executions with result assertions; a loaded smoke without passed probes is still only load-level evidence.');
  lines.push('- `review-before-enable` means MindOS can install/analyze it, but enable/load requires explicit capability confirmation.');
  lines.push('- `catalog-or-native` means MindOS should expose catalog/surface metadata or build a native MindOS feature instead of running the plugin as-is.');
  lines.push('- `blocked` means the compatibility gate found hard blockers such as unsupported native modules or unsupported Obsidian APIs.');
  lines.push('- `declarative adapter candidate` means the plugin has editor intent that could be translated into MindOS-signed browser editor sandbox contributions without mounting raw CodeMirror objects.');
  lines.push('- `full codemirror host` means the plugin depends on raw CodeMirror packages or unsupported editor APIs and must remain catalog-only until an isolated browser editor host exists.');
  lines.push('- `native product feature` means the durable user value should be rebuilt as a MindOS-native surface first, with editor decorations only as a narrow follow-up.');
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function toMatrixRow(input: ObsidianRealPluginMatrixInputItem): ObsidianRealPluginMatrixRow {
  const report = input.preflight.compatibility.report;
  return {
    id: input.catalog.id,
    name: input.catalog.name,
    priority: input.target.priority,
    category: input.target.category,
    reason: input.target.reason,
    author: input.catalog.author,
    repo: input.catalog.repo,
    ...(input.catalog.githubUrl ? { githubUrl: input.catalog.githubUrl } : {}),
    description: input.catalog.description,
    ...(typeof input.stats?.downloads === 'number' ? { downloads: input.stats.downloads } : {}),
    ...(input.stats?.updated ? { updated: input.stats.updated } : {}),
    manifest: {
      id: input.preflight.package.manifest.id,
      name: input.preflight.package.manifest.name,
      version: input.preflight.package.manifest.version,
      ...(input.preflight.package.manifest.minAppVersion ? { minAppVersion: input.preflight.package.manifest.minAppVersion } : {}),
      ...(input.preflight.package.manifest.isDesktopOnly === true ? { isDesktopOnly: true } : {}),
    },
    package: {
      resolvedVersion: input.preflight.package.source.resolvedVersion,
      latestVersion: input.preflight.package.source.latestVersion,
      strategy: input.preflight.package.source.strategy,
      digest: input.preflight.package.digest.package,
      hasStyles: input.preflight.package.assets.stylesCss,
    },
    compatibility: {
      level: input.preflight.compatibility.level,
      supportedApis: report.supportedApis.length,
      partialApis: report.partialApis.length,
      unsupportedApis: report.unsupportedApis.length,
      blockers: report.blockers,
      unsupportedModules: report.unsupportedModules,
    },
    capabilityGate: {
      status: input.capabilityGate.status,
      requiresConfirmation: input.capabilityGate.requiresConfirmation,
      confirmed: input.capabilityGate.confirmed,
      blocked: input.capabilityGate.blocked,
      fingerprint: input.capabilityGate.fingerprint,
      confirmReasons: input.capabilityGate.confirmReasons,
      blockedReasons: input.capabilityGate.blockedReasons,
    },
    support: input.preflight.support,
    surfaces: input.preflight.surfacePreview,
    surfacePolicies: surfacePoliciesFor(input),
    smoke: input.smoke,
    recommendation: recommendationFor(input),
    editorAdapterPlan: editorAdapterPlanFor(input),
  };
}

function recommendationFor(input: ObsidianRealPluginMatrixInputItem): ObsidianRealPluginRecommendation {
  if (input.preflight.support.kind === 'native') return 'catalog-or-native';
  if (input.capabilityGate.blocked || input.preflight.compatibility.level === 'blocked') return 'blocked';
  if (input.smoke.outcome === 'loaded') return 'runtime-candidate';
  if (input.capabilityGate.requiresConfirmation || input.preflight.support.kind === 'review') return 'review-before-enable';
  if (input.smoke.outcome === 'skipped') return 'catalog-or-native';
  if (input.smoke.outcome === 'failed') return 'investigate';
  if (input.preflight.support.kind === 'ready' || input.preflight.support.kind === 'limited') return 'review-before-enable';
  return 'investigate';
}

function surfacePoliciesFor(input: ObsidianRealPluginMatrixInputItem): ObsidianRealPluginSurfacePolicy[] {
  const coverage = input.preflight.derivedCapabilities.coverage;
  const summaries = summarizeObsidianCapabilitySurfaces(coverage);

  if (input.preflight.compatibility.report.unsupportedModules.length > 0) {
    summaries.push({
      surface: 'unsupported',
      apiCount: input.preflight.compatibility.report.unsupportedModules.length,
      supportSummary: {
        full: 0,
        limited: 0,
        'snapshot-only': 0,
        'catalog-only': 0,
        'request-only': 0,
        unsupported: input.preflight.compatibility.report.unsupportedModules.length,
      },
      apis: input.preflight.compatibility.report.unsupportedModules.map((moduleName) => `module:${moduleName}`),
      hosts: ['Unsupported runtime module'],
      routes: [],
    });
  }

  return summaries.map((summary) => {
    const label = surfacePolicyLabelForSurface(summary.surface);
    const decision = buildObsidianSurfacePolicyDecision({
      surface: summary.surface,
      label,
      status: matrixSurfacePolicyStatus(summary),
    });
    return {
      surface: summary.surface,
      label,
      apiCount: summary.apiCount,
      action: decision.action,
      risk: decision.risk,
      runtimeDefault: decision.runtimeDefault,
      permissionBoundary: decision.permissionBoundary,
      requiredEvidence: decision.requiredEvidence,
      nextStep: decision.nextStep,
    };
  });
}

const CODEMIRROR_MODULE_PREFIXES = ['@codemirror/', '@lezer/'];
const NATIVE_MODULES = new Set(['child_process', 'electron', 'fs', 'fs/promises']);
const EDITOR_API_NAMES = new Set([
  'registerEditorExtension',
  'registerEditorSuggest',
  'Workspace.iterateCodeMirrors',
  'CodeMirror',
  'CodeMirrorAdapter.commands',
  'editorInfoField',
  'editorLivePreviewField',
]);
const NATIVE_PRODUCT_EDITOR_CATEGORIES = new Set([
  'custom-view',
  'document-rendering',
  'metadata',
  'metadata-query',
  'search-navigation',
  'settings-appearance',
]);

function editorAdapterPlanFor(input: ObsidianRealPluginMatrixInputItem): ObsidianEditorAdapterPlan {
  const report = input.preflight.compatibility.report;
  const apiNames = new Set([
    ...report.obsidianApis,
    ...report.supportedApis,
    ...report.partialApis,
    ...report.unsupportedApis,
  ]);
  const editorApis = Array.from(apiNames).filter((api) => EDITOR_API_NAMES.has(api));
  const codeMirrorModules = report.unsupportedModules.filter((moduleName) =>
    CODEMIRROR_MODULE_PREFIXES.some((prefix) => moduleName.startsWith(prefix)),
  );
  const nativeModules = report.unsupportedModules.filter((moduleName) => NATIVE_MODULES.has(moduleName));
  const hasEditorSurface = input.preflight.surfacePreview.some((surface) => surface.id === 'editor');
  const runtimeEditorExtensions = input.smoke.runtime?.editorExtensions ?? 0;
  const hasEditorSignal = editorApis.length > 0
    || codeMirrorModules.length > 0
    || hasEditorSurface
    || runtimeEditorExtensions > 0;

  if (!hasEditorSignal) {
    return {
      status: 'not-editor-scoped',
      route: 'none',
      reason: 'No editor-specific Obsidian API, CodeMirror module, editor surface, or runtime editor extension was detected.',
      signals: [],
      blockers: [],
      nextSteps: ['Keep this plugin on its current non-editor compatibility path.'],
    };
  }

  const signals = [
    ...editorApis.map((api) => `Obsidian API: ${api}`),
    ...codeMirrorModules.map((moduleName) => `unsupported module: ${moduleName}`),
    ...(hasEditorSurface ? ['surface preview: editor'] : []),
    ...(runtimeEditorExtensions > 0 ? [`runtime editor extensions: ${runtimeEditorExtensions}`] : []),
  ];
  const blockers = [
    ...codeMirrorModules.map((moduleName) => `Raw CodeMirror package dependency cannot mount through the declarative browser editor sandbox: ${moduleName}`),
    ...nativeModules.map((moduleName) => `Native module must stay behind a separate Desktop/native gate: ${moduleName}`),
    ...report.unsupportedApis
      .filter((api) => EDITOR_API_NAMES.has(api))
      .map((api) => `Unsupported editor API requires a dedicated browser editor host: ${api}`),
  ];

  if (nativeModules.length > 0 && input.target.category === 'commands-automation') {
    return {
      status: 'native-or-desktop-host',
      route: 'native-or-desktop-host',
      reason: 'This plugin mixes editor-adjacent behavior with native/Desktop execution needs; do not route it through the browser editor sandbox first.',
      signals,
      blockers,
      nextSteps: [
        'Keep raw editor registrations catalog-only.',
        'Design a separate native/Desktop broker or MindOS-native automation path before considering editor decorations.',
        'Only add browser editor contributions for small, explicitly signed visual affordances.',
      ],
    };
  }

  if (codeMirrorModules.length > 0 || report.unsupportedApis.some((api) => EDITOR_API_NAMES.has(api))) {
    if (NATIVE_PRODUCT_EDITOR_CATEGORIES.has(input.target.category)) {
      return {
        status: 'native-product-feature',
        route: 'mindos-native-surface',
        reason: 'The plugin uses editor/CodeMirror hooks, but its durable value belongs in a MindOS-native product surface rather than a generic editor extension bridge.',
        signals,
        blockers,
        nextSteps: [
          'Translate the user workflow into a MindOS-native surface or document renderer first.',
          'Use P3b browser editor contributions only for narrow, declarative highlights or markers.',
          'Keep raw CodeMirror modules blocked until a full browser isolation host exists.',
        ],
      };
    }

    return {
      status: 'full-codemirror-host',
      route: 'full-codemirror-host',
      reason: 'The plugin depends on raw CodeMirror packages or unsupported editor APIs, which cannot be represented by the P3b declarative decoration contract.',
      signals,
      blockers,
      nextSteps: [
        'Keep raw CodeMirror extensions catalog-only.',
        'Require a browser-side isolated CodeMirror host with per-plugin compartments, keymaps/effects policy, explicit permission, and deterministic unload cleanup.',
        'Add fixture coverage before changing this plan from catalog-only to mounted.',
      ],
    };
  }

  return {
    status: 'declarative-adapter-candidate',
    route: 'browser-editor-sandbox',
    reason: 'The plugin exposes editor intent without raw CodeMirror package blockers, so a MindOS-owned declarative adapter can be explored.',
    signals,
    blockers,
    nextSteps: [
      'Map the plugin intent into BrowserEditorSandboxContribution objects instead of passing plugin functions to React.',
      'Require MindOS signature, explicit editor.read/editor.decorations permissions, document bounds validation, and unload cleanup tests.',
      'Keep community plugin raw registrations catalog-only until the adapter is implemented and verified.',
    ],
  };
}

function summarizeRows(rows: ObsidianRealPluginMatrixRow[]): ObsidianRealPluginMatrixSummary {
  const byCompatibilityLevel = emptyCompatibilityCounts();
  const byGateStatus = emptyGateCounts();
  const bySmokeOutcome = emptySmokeCounts();
  const byRecommendation = emptyRecommendationCounts();
  const byEditorAdapterPlan = emptyEditorAdapterPlanCounts();
  const bySurfacePolicyAction = emptySurfacePolicyActionCounts();
  let totalDownloads = 0;

  for (const row of rows) {
    byCompatibilityLevel[row.compatibility.level] += 1;
    byGateStatus[row.capabilityGate.status] += 1;
    bySmokeOutcome[row.smoke.outcome] += 1;
    byRecommendation[row.recommendation] += 1;
    byEditorAdapterPlan[row.editorAdapterPlan.status] += 1;
    for (const policy of row.surfacePolicies) {
      bySurfacePolicyAction[policy.action] += 1;
    }
    totalDownloads += row.downloads ?? 0;
  }

  return {
    total: rows.length,
    byCompatibilityLevel,
    byGateStatus,
    bySmokeOutcome,
    byRecommendation,
    byEditorAdapterPlan,
    bySurfacePolicyAction,
    totalDownloads,
  };
}

function emptyCompatibilityCounts(): Record<CompatibilityLevel, number> {
  return { compatible: 0, partial: 0, blocked: 0 };
}

function emptyGateCounts(): Record<ObsidianCapabilityGateReport['status'], number> {
  return { ready: 0, limited: 0, review: 0, blocked: 0 };
}

function emptySmokeCounts(): Record<ObsidianRealPluginSmokeOutcome, number> {
  return { loaded: 0, skipped: 0, failed: 0, 'not-run': 0 };
}

function emptyRecommendationCounts(): Record<ObsidianRealPluginRecommendation, number> {
  return {
    'runtime-candidate': 0,
    'review-before-enable': 0,
    'catalog-or-native': 0,
    blocked: 0,
    investigate: 0,
  };
}

function emptyEditorAdapterPlanCounts(): Record<ObsidianEditorAdapterPlanStatus, number> {
  return {
    'not-editor-scoped': 0,
    'declarative-adapter-candidate': 0,
    'native-product-feature': 0,
    'full-codemirror-host': 0,
    'native-or-desktop-host': 0,
  };
}

function emptySurfacePolicyActionCounts(): Record<ObsidianSurfacePolicyAction, number> {
  return {
    'allow-after-load': 0,
    'review-before-enable': 0,
    'catalog-only': 0,
    'native-adapter': 0,
    blocked: 0,
  };
}

function gateLabel(plugin: ObsidianRealPluginMatrixRow): string {
  const suffix = plugin.capabilityGate.requiresConfirmation ? ' (confirmation)' : '';
  return `${plugin.capabilityGate.status}${suffix}`;
}

function smokeLabel(smoke: ObsidianRealPluginSmokeResult): string {
  return smoke.outcome === 'not-run' ? 'not run' : `${smoke.outcome} (${smoke.stage})`;
}

export function summarizeObsidianWorkflowProbeResults(results: ObsidianWorkflowProbeResult[]): ObsidianRealPluginWorkflowProbeSummary {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const result of results) {
    counts[result.status] += 1;
  }
  return {
    total: results.length,
    ...counts,
    results: results.map((result) => ({
      id: result.id,
      label: result.label,
      status: result.status,
      completedAt: result.completedAt,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      evidence: result.evidence.slice(0, 3),
    })),
  };
}

function workflowProbeLabel(summary: ObsidianRealPluginWorkflowProbeSummary | undefined): string {
  if (!summary) return '-';
  if (summary.total === 0) return 'none';
  return [
    summary.passed ? `${summary.passed} passed` : '',
    summary.failed ? `${summary.failed} failed` : '',
    summary.skipped ? `${summary.skipped} skipped` : '',
  ].filter(Boolean).join(', ');
}

function surfaceLabel(surfaces: ObsidianCommunitySurfacePreview[]): string {
  if (surfaces.length === 0) return '-';
  return surfaces
    .map((surface) => `${surface.id}:${surface.state}${surface.count > 1 ? `x${surface.count}` : ''}`)
    .join(', ');
}

function surfacePolicyLabel(policies: ObsidianRealPluginSurfacePolicy[]): string {
  if (policies.length === 0) return '-';
  const counts = emptySurfacePolicyActionCounts();
  for (const policy of policies) {
    counts[policy.action] += 1;
  }
  return (Object.keys(counts) as ObsidianSurfacePolicyAction[])
    .filter((action) => counts[action] > 0)
    .map((action) => `${action}${counts[action] > 1 ? `x${counts[action]}` : ''}`)
    .join(', ');
}

function recommendationLabel(recommendation: ObsidianRealPluginRecommendation): string {
  return recommendation.replaceAll('-', ' ');
}

function editorAdapterPlanLabel(plan: ObsidianEditorAdapterPlan): string {
  return plan.status.replaceAll('-', ' ');
}

function surfacePolicyActionLabel(action: ObsidianSurfacePolicyAction): string {
  return action.replaceAll('-', ' ');
}

function matrixSurfacePolicyStatus(
  summary: ReturnType<typeof summarizeObsidianCapabilitySurfaces>[number],
): ObsidianSurfaceCatalogStatus {
  if (summary.surface === 'unsupported' || summary.supportSummary.unsupported > 0) return 'blocked';
  if (summary.surface === 'editor') return 'native-gated';
  if (summary.supportSummary['snapshot-only'] > 0) return 'preview-only';
  if (
    summary.supportSummary['catalog-only'] > 0
    && summary.supportSummary.full === 0
    && summary.supportSummary.limited === 0
    && summary.supportSummary['request-only'] === 0
  ) {
    return 'catalog-only';
  }
  if (
    summary.supportSummary['request-only'] > 0
    && summary.supportSummary.full === 0
    && summary.supportSummary.limited === 0
    && summary.supportSummary['catalog-only'] === 0
  ) {
    return 'request-only';
  }
  if (summary.supportSummary.limited > 0 || summary.supportSummary['catalog-only'] > 0 || summary.supportSummary['request-only'] > 0) {
    return 'limited';
  }
  return 'ready';
}

function surfacePolicyLabelForSurface(surface: ObsidianCapabilitySurface): string {
  return {
    commands: 'Commands',
    settings: 'Settings',
    entries: 'Entries',
    views: 'Views',
    document: 'Document',
    styles: 'Styles',
    editor: 'Editor',
    secret: 'Secrets',
    vault: 'Vault',
    metadata: 'Metadata',
    workspace: 'Workspace',
    network: 'Network',
    core: 'Core runtime',
    unsupported: 'Blocked capability',
  }[surface];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function markdownLink(label: string, url: string | undefined): string {
  return url ? `[${escapeMarkdown(label)}](${url})` : escapeMarkdown(label);
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('|', '\\|');
}

function escapeTable(value: string): string {
  return escapeMarkdown(value).replaceAll('\n', '<br>');
}
