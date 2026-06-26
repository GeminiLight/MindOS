import type {
  ObsidianEditorAdapterPlan,
  ObsidianEditorAdapterPlanStatus,
  ObsidianRealPluginMatrix,
  ObsidianRealPluginMatrixFailure,
  ObsidianRealPluginMatrixRow,
  ObsidianRealPluginPriority,
  ObsidianRealPluginRecommendation,
  ObsidianRealPluginSmokeOutcome,
  ObsidianRealPluginSurfacePolicy,
} from './real-plugin-matrix';
import type { ObsidianCapabilitySurface } from './capability-matrix';
import type { ObsidianSurfacePolicyAction } from './surface-decision';

export type ObsidianAdapterPriorityLaneId =
  | 'browser-editor-sandbox'
  | 'mindos-native-surface'
  | 'full-codemirror-host'
  | 'native-or-desktop-host'
  | 'network-review-gate'
  | 'secret-broker-review'
  | 'settings-schema-adapter'
  | 'command-workflow-probe'
  | 'view-snapshot-adapter'
  | 'vault-workflow-adapter'
  | 'generic-runtime-review'
  | 'blocked-replacement';

export type ObsidianAdapterPriorityPhase = 'now' | 'next' | 'later' | 'future-gate';

export interface ObsidianRealPluginAdapterPriorityReport {
  schemaVersion: 1;
  generatedAt: string;
  targetSet: string;
  sourcePolicy: string;
  summary: ObsidianRealPluginAdapterPrioritySummary;
  lanes: ObsidianAdapterPriorityLane[];
  topCandidates: ObsidianAdapterPriorityCandidate[];
  boundaryNotes: string[];
  failures: ObsidianRealPluginMatrixFailure[];
}

export interface ObsidianRealPluginAdapterPrioritySummary {
  totalPlugins: number;
  totalCandidates: number;
  actionableCandidates: number;
  futureGateCandidates: number;
  failures: number;
  topLaneIds: ObsidianAdapterPriorityLaneId[];
}

export interface ObsidianAdapterPriorityLane {
  id: ObsidianAdapterPriorityLaneId;
  label: string;
  phase: ObsidianAdapterPriorityPhase;
  score: number;
  candidateCount: number;
  pluginCount: number;
  recommendedWork: string;
  permissionBoundary: string;
  candidates: ObsidianAdapterPriorityCandidate[];
}

export interface ObsidianAdapterPriorityCandidate {
  laneId: ObsidianAdapterPriorityLaneId;
  pluginId: string;
  pluginName: string;
  priority: ObsidianRealPluginPriority;
  category: string;
  recommendation: ObsidianRealPluginRecommendation;
  downloads?: number;
  gateStatus: ObsidianRealPluginMatrixRow['capabilityGate']['status'];
  smokeOutcome: ObsidianRealPluginSmokeOutcome;
  workflowProbeSummary: string;
  score: number;
  rankSignals: string[];
  surfaces: ObsidianAdapterPrioritySurface[];
  editorPlan?: Pick<ObsidianEditorAdapterPlan, 'status' | 'route' | 'reason' | 'signals' | 'blockers' | 'nextSteps'>;
  nextSteps: string[];
}

export interface ObsidianAdapterPrioritySurface {
  surface: ObsidianCapabilitySurface;
  label: string;
  apiCount: number;
  action: ObsidianSurfacePolicyAction;
  risk: ObsidianRealPluginSurfacePolicy['risk'];
  runtimeDefault: ObsidianRealPluginSurfacePolicy['runtimeDefault'];
  requiredEvidence: string[];
}

interface LaneDefinition {
  id: ObsidianAdapterPriorityLaneId;
  label: string;
  phase: ObsidianAdapterPriorityPhase;
  baseScore: number;
  recommendedWork: string;
  permissionBoundary: string;
}

const LANE_DEFINITIONS: LaneDefinition[] = [
  {
    id: 'browser-editor-sandbox',
    label: 'Browser editor sandbox adapters',
    phase: 'now',
    baseScore: 900,
    recommendedWork: 'Turn editor intent into MindOS-signed BrowserEditorSandboxContribution adapters instead of mounting raw plugin callbacks.',
    permissionBoundary: 'Only allow MindOS-authored editor.read and editor.decorations contracts with unload cleanup; do not expose raw CodeMirror objects.',
  },
  {
    id: 'settings-schema-adapter',
    label: 'Settings schema adapters',
    phase: 'now',
    baseScore: 760,
    recommendedWork: 'Generalize settings import, profile mapping, and declarative controls for plugins whose value is mainly configuration-driven.',
    permissionBoundary: 'Settings adapters may read/write plugin config files through explicit UI actions only; they do not grant arbitrary vault or native access.',
  },
  {
    id: 'command-workflow-probe',
    label: 'Command workflow probes',
    phase: 'now',
    baseScore: 720,
    recommendedWork: 'Add focused command-level workflow probes so loaded command catalogs become observed user workflows only after evidence passes.',
    permissionBoundary: 'Commands remain user-triggered; workflow success requires runtime called evidence or a named probe, not registration alone.',
  },
  {
    id: 'view-snapshot-adapter',
    label: 'View and snapshot adapters',
    phase: 'next',
    baseScore: 660,
    recommendedWork: 'Serialize plugin views, entries, modals, menus, and document previews into bounded MindOS surfaces with explicit continuations.',
    permissionBoundary: 'Snapshot adapters expose bounded data and user continuations; arbitrary plugin DOM and event graphs stay unmounted.',
  },
  {
    id: 'network-review-gate',
    label: 'Network review gates',
    phase: 'next',
    baseScore: 640,
    recommendedWork: 'Keep network-capable plugins behind review, destination policy, and denied/called ledger inspection before enable.',
    permissionBoundary: 'This lane documents review work only; it does not create a default network allowlist or broaden requestUrl permissions.',
  },
  {
    id: 'vault-workflow-adapter',
    label: 'Vault workflow adapters',
    phase: 'next',
    baseScore: 610,
    recommendedWork: 'Add narrow, workflow-specific adapters for vault reads/writes with before/after file evidence and rollback expectations.',
    permissionBoundary: 'Vault adapters stay inside the public vault boundary and require explicit workflow probes before claiming observed behavior.',
  },
  {
    id: 'mindos-native-surface',
    label: 'MindOS-native product surfaces',
    phase: 'later',
    baseScore: 560,
    recommendedWork: 'Rebuild durable user value as a MindOS-native surface before trying to run editor-heavy community plugin behavior.',
    permissionBoundary: 'Native product surfaces are MindOS-owned replacements; they do not imply community plugin runtime parity.',
  },
  {
    id: 'secret-broker-review',
    label: 'Secret broker review',
    phase: 'later',
    baseScore: 520,
    recommendedWork: 'Route secret-dependent workflows through the existing reviewed secret broker boundary and redacted evidence.',
    permissionBoundary: 'Secrets require explicit broker mediation and must never be exposed to generic community plugin code by default.',
  },
  {
    id: 'generic-runtime-review',
    label: 'Generic runtime review',
    phase: 'later',
    baseScore: 480,
    recommendedWork: 'Review mixed limited/catalog surfaces that do not yet justify a dedicated adapter lane.',
    permissionBoundary: 'Generic review does not change runtime defaults; it only groups evidence that needs a more specific decision later.',
  },
  {
    id: 'full-codemirror-host',
    label: 'Full CodeMirror host',
    phase: 'future-gate',
    baseScore: 420,
    recommendedWork: 'Keep raw CodeMirror packages catalog-only until a fully isolated browser host exists with compartments, policy, and deterministic cleanup.',
    permissionBoundary: 'No raw CodeMirror extension host is exposed in the generic runtime.',
  },
  {
    id: 'native-or-desktop-host',
    label: 'Native or Desktop host',
    phase: 'future-gate',
    baseScore: 380,
    recommendedWork: 'Treat Node, Electron, shell, and Desktop-bound behavior as a separate native broker/product decision.',
    permissionBoundary: 'Native/Desktop hosts are not part of the generic Web runtime and require a separately reviewed broker.',
  },
  {
    id: 'blocked-replacement',
    label: 'Blocked replacement path',
    phase: 'future-gate',
    baseScore: 340,
    recommendedWork: 'Keep blocked plugins disabled and decide whether to remove APIs, build replacements, or design a reviewed adapter.',
    permissionBoundary: 'Blocked surfaces stay disabled until unsupported APIs or native modules are replaced by an explicit MindOS-owned path.',
  },
];

const LANE_ORDER = LANE_DEFINITIONS.map((definition) => definition.id);
const BOUNDARY_NOTES = [
  'Adapter priority is an evidence-planning report; it does not grant network, secret, vault, editor, native, or filesystem permissions.',
  'A high priority lane means MindOS should design or test an adapter next, not that the community plugin is runtime-compatible today.',
  'Workflow success still requires runtime registered/called ledger evidence or focused workflow probes; static surfaces and load smoke are not enough.',
  'Future-gate lanes such as full CodeMirror and native/Desktop host remain blocked from the generic runtime until a separately reviewed host exists.',
];

export function buildObsidianRealPluginAdapterPriorityReport(
  matrix: ObsidianRealPluginMatrix,
): ObsidianRealPluginAdapterPriorityReport {
  const candidates = matrix.plugins.flatMap(adapterCandidatesForPlugin);
  const lanes = LANE_DEFINITIONS
    .map((definition) => laneFromDefinition(definition, candidates))
    .filter((lane) => lane.candidateCount > 0)
    .sort(compareLanes);
  const topCandidates = candidates
    .slice()
    .sort(compareCandidates)
    .slice(0, 12);
  const actionableCandidates = candidates.filter((candidate) => laneDefinition(candidate.laneId).phase !== 'future-gate').length;
  const futureGateCandidates = candidates.length - actionableCandidates;

  return {
    schemaVersion: 1,
    generatedAt: matrix.generatedAt,
    targetSet: matrix.targetSet,
    sourcePolicy: matrix.sourcePolicy,
    summary: {
      totalPlugins: matrix.plugins.length,
      totalCandidates: candidates.length,
      actionableCandidates,
      futureGateCandidates,
      failures: matrix.failures.length,
      topLaneIds: lanes.slice(0, 5).map((lane) => lane.id),
    },
    lanes,
    topCandidates,
    boundaryNotes: BOUNDARY_NOTES,
    failures: matrix.failures,
  };
}

export function renderObsidianRealPluginAdapterPriorityMarkdown(
  report: ObsidianRealPluginAdapterPriorityReport,
): string {
  const lines: string[] = [
    '# Obsidian Real Plugin Adapter Priority Report',
    '',
    `> Generated: ${report.generatedAt}`,
    `> Target set: ${report.targetSet}`,
    `> Source policy: ${report.sourcePolicy}`,
    '',
    '## Boundary',
    '',
    ...report.boundaryNotes.map((note) => `- ${note}`),
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Plugins analyzed | ${report.summary.totalPlugins} |`,
    `| Adapter candidates | ${report.summary.totalCandidates} |`,
    `| Actionable candidates | ${report.summary.actionableCandidates} |`,
    `| Future-gate candidates | ${report.summary.futureGateCandidates} |`,
    `| Harness failures | ${report.summary.failures} |`,
    '',
    '| Lane | Phase | Score | Candidates | Plugins | Work | Boundary |',
    '|---|---|---:|---:|---:|---|---|',
    ...report.lanes.map((lane) => `| ${escapeTable(lane.label)} | ${lane.phase} | ${lane.score} | ${lane.candidateCount} | ${lane.pluginCount} | ${escapeTable(lane.recommendedWork)} | ${escapeTable(lane.permissionBoundary)} |`),
    '',
    '## Top Candidates',
    '',
  ];

  appendCandidateTable(lines, report.topCandidates, 'No adapter candidates were detected.');

  for (const lane of report.lanes) {
    lines.push(`## ${lane.label}`);
    lines.push('');
    lines.push(`- Phase: ${lane.phase}`);
    lines.push(`- Score: ${lane.score}`);
    lines.push(`- Work: ${lane.recommendedWork}`);
    lines.push(`- Boundary: ${lane.permissionBoundary}`);
    lines.push('');
    appendCandidateTable(lines, lane.candidates, 'No candidates in this lane.');
  }

  if (report.failures.length > 0) {
    lines.push('## Harness Failures');
    lines.push('');
    lines.push('| Plugin | Stage | Error |');
    lines.push('|---|---|---|');
    for (const failure of report.failures) {
      lines.push(`| ${inlineCode(failure.id)} | ${failure.stage} | ${escapeTable(failure.error)} |`);
    }
    lines.push('');
  }

  lines.push('## Reading The Result');
  lines.push('');
  lines.push('- `now` lanes are the best near-term adapter investments because they can strengthen existing MindOS-owned hosts without broadening runtime permissions.');
  lines.push('- `next` lanes need review or more workflow evidence before becoming default runtime behavior.');
  lines.push('- `later` lanes usually imply product replacement or broker design rather than direct plugin execution.');
  lines.push('- `future-gate` lanes remain blocked from generic compatibility until an isolated host or native broker is designed and tested.');
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function adapterCandidatesForPlugin(plugin: ObsidianRealPluginMatrixRow): ObsidianAdapterPriorityCandidate[] {
  const candidates: ObsidianAdapterPriorityCandidate[] = [];
  const surfacePolicies = pluginSurfacePolicies(plugin);
  const editorPlan = pluginEditorAdapterPlan(plugin);
  const editorLane = laneForEditorPlan(editorPlan.status);
  if (editorLane) {
    candidates.push(buildCandidate(plugin, editorLane, {
      surfaces: surfacePolicies.filter((policy) => policy.surface === 'editor' || policy.action === 'native-adapter'),
      editorPlan,
      rankSignals: [
        `editor plan: ${editorPlan.status}`,
        ...editorPlan.signals.slice(0, 3),
      ],
      nextSteps: editorPlan.nextSteps,
    }));
  }

  for (const laneId of lanesForSurfacePolicies(surfacePolicies)) {
    candidates.push(buildCandidate(plugin, laneId, {
      surfaces: surfacePolicies.filter((policy) => surfaceBelongsToLane(policy, laneId)),
      rankSignals: surfaceLaneSignals(plugin, laneId),
      nextSteps: surfaceLaneNextSteps(plugin, laneId),
    }));
  }

  if (
    plugin.recommendation === 'runtime-candidate'
    && surfacePolicies.some((policy) => policy.action !== 'allow-after-load')
  ) {
    candidates.push(buildCandidate(plugin, 'generic-runtime-review', {
      surfaces: surfacePolicies.filter((policy) => policy.action !== 'allow-after-load'),
      rankSignals: ['runtime candidate still has non-allow surface policies'],
      nextSteps: [
        'Review non-allow surface policies before expanding enabled-by-default behavior.',
        'Keep workflow success tied to runtime called evidence or focused probes.',
      ],
    }));
  }

  return dedupeCandidates(candidates);
}

function buildCandidate(
  plugin: ObsidianRealPluginMatrixRow,
  laneId: ObsidianAdapterPriorityLaneId,
  options: {
    surfaces: ObsidianRealPluginSurfacePolicy[];
    editorPlan?: ObsidianEditorAdapterPlan;
    rankSignals: string[];
    nextSteps: string[];
  },
): ObsidianAdapterPriorityCandidate {
  const score = candidateScore(plugin, laneId, options.surfaces, options.editorPlan);
  return {
    laneId,
    pluginId: plugin.id,
    pluginName: plugin.name,
    priority: plugin.priority,
    category: plugin.category,
    recommendation: plugin.recommendation,
    ...(typeof plugin.downloads === 'number' ? { downloads: plugin.downloads } : {}),
    gateStatus: plugin.capabilityGate.status,
    smokeOutcome: plugin.smoke.outcome,
    workflowProbeSummary: workflowProbeSummary(plugin),
    score,
    rankSignals: unique([
      ...options.rankSignals,
      `target priority: ${plugin.priority}`,
      `recommendation: ${plugin.recommendation}`,
      `gate: ${plugin.capabilityGate.status}`,
      `smoke: ${plugin.smoke.outcome}`,
    ]).slice(0, 8),
    surfaces: options.surfaces.map((policy) => ({
      surface: policy.surface,
      label: policy.label,
      apiCount: policy.apiCount,
      action: policy.action,
      risk: policy.risk,
      runtimeDefault: policy.runtimeDefault,
      requiredEvidence: policy.requiredEvidence.slice(0, 3),
    })),
    ...(options.editorPlan ? {
      editorPlan: {
        status: options.editorPlan.status,
        route: options.editorPlan.route,
        reason: options.editorPlan.reason,
        signals: options.editorPlan.signals.slice(0, 6),
        blockers: options.editorPlan.blockers.slice(0, 4),
        nextSteps: options.editorPlan.nextSteps.slice(0, 4),
      },
    } : {}),
    nextSteps: unique(options.nextSteps).slice(0, 6),
  };
}

function lanesForSurfacePolicies(policies: ObsidianRealPluginSurfacePolicy[]): ObsidianAdapterPriorityLaneId[] {
  const lanes = new Set<ObsidianAdapterPriorityLaneId>();
  for (const policy of policies) {
    if (policy.action === 'blocked') {
      lanes.add('blocked-replacement');
      continue;
    }
    if (policy.surface === 'network' && policy.action === 'review-before-enable') lanes.add('network-review-gate');
    if (policy.surface === 'secret') lanes.add('secret-broker-review');
    if (policy.surface === 'settings') lanes.add('settings-schema-adapter');
    if (policy.surface === 'commands') lanes.add('command-workflow-probe');
    if (policy.surface === 'views' || policy.surface === 'entries' || policy.surface === 'document' || policy.surface === 'styles') {
      lanes.add('view-snapshot-adapter');
    }
    if (policy.surface === 'vault' || policy.surface === 'metadata' || policy.surface === 'workspace') {
      lanes.add('vault-workflow-adapter');
    }
    if (policy.action === 'native-adapter' && policy.surface !== 'editor') lanes.add('native-or-desktop-host');
    if (policy.action === 'catalog-only' && policy.surface !== 'settings' && policy.surface !== 'commands') {
      lanes.add('generic-runtime-review');
    }
  }
  return Array.from(lanes).sort((a, b) => LANE_ORDER.indexOf(a) - LANE_ORDER.indexOf(b));
}

function surfaceBelongsToLane(
  policy: ObsidianRealPluginSurfacePolicy,
  laneId: ObsidianAdapterPriorityLaneId,
): boolean {
  if (laneId === 'blocked-replacement') return policy.action === 'blocked';
  if (laneId === 'network-review-gate') return policy.surface === 'network' && policy.action === 'review-before-enable';
  if (laneId === 'secret-broker-review') return policy.surface === 'secret';
  if (laneId === 'settings-schema-adapter') return policy.surface === 'settings';
  if (laneId === 'command-workflow-probe') return policy.surface === 'commands';
  if (laneId === 'view-snapshot-adapter') {
    return policy.surface === 'views' || policy.surface === 'entries' || policy.surface === 'document' || policy.surface === 'styles';
  }
  if (laneId === 'vault-workflow-adapter') {
    return policy.surface === 'vault' || policy.surface === 'metadata' || policy.surface === 'workspace';
  }
  if (laneId === 'native-or-desktop-host') return policy.action === 'native-adapter' && policy.surface !== 'editor';
  if (laneId === 'generic-runtime-review') return policy.action === 'catalog-only' || policy.action === 'review-before-enable';
  return false;
}

function surfaceLaneSignals(
  plugin: ObsidianRealPluginMatrixRow,
  laneId: ObsidianAdapterPriorityLaneId,
): string[] {
  const surfaces = pluginSurfacePolicies(plugin).filter((policy) => surfaceBelongsToLane(policy, laneId));
  const surfaceText = surfaces.map((policy) => `${policy.label}: ${policy.action}`).join(', ');
  return [
    surfaceText ? `surface policies: ${surfaceText}` : '',
    plugin.smoke.workflowProbes ? `workflow probes: ${workflowProbeSummary(plugin)}` : '',
  ].filter(Boolean);
}

function surfaceLaneNextSteps(
  plugin: ObsidianRealPluginMatrixRow,
  laneId: ObsidianAdapterPriorityLaneId,
): string[] {
  const surfaces = pluginSurfacePolicies(plugin).filter((policy) => surfaceBelongsToLane(policy, laneId));
  const fromPolicies = surfaces.flatMap((policy) => policy.nextStep ? [policy.nextStep] : []);
  const definition = laneDefinition(laneId);
  return unique([
    definition.recommendedWork,
    ...fromPolicies,
  ]);
}

function laneForEditorPlan(status: ObsidianEditorAdapterPlanStatus): ObsidianAdapterPriorityLaneId | null {
  if (status === 'declarative-adapter-candidate') return 'browser-editor-sandbox';
  if (status === 'native-product-feature') return 'mindos-native-surface';
  if (status === 'full-codemirror-host') return 'full-codemirror-host';
  if (status === 'native-or-desktop-host') return 'native-or-desktop-host';
  return null;
}

function pluginSurfacePolicies(plugin: ObsidianRealPluginMatrixRow): ObsidianRealPluginSurfacePolicy[] {
  return Array.isArray(plugin.surfacePolicies) ? plugin.surfacePolicies : [];
}

function pluginEditorAdapterPlan(plugin: ObsidianRealPluginMatrixRow): ObsidianEditorAdapterPlan {
  if (plugin.editorAdapterPlan) return plugin.editorAdapterPlan;
  return {
    status: 'not-editor-scoped',
    route: 'none',
    reason: 'No editor adapter plan was present in this matrix snapshot.',
    signals: [],
    blockers: [],
    nextSteps: ['Regenerate the real-plugin matrix with current schema to classify editor adapter lanes.'],
  };
}

function laneFromDefinition(
  definition: LaneDefinition,
  allCandidates: ObsidianAdapterPriorityCandidate[],
): ObsidianAdapterPriorityLane {
  const candidates = allCandidates
    .filter((candidate) => candidate.laneId === definition.id)
    .sort(compareCandidates);
  const pluginIds = new Set(candidates.map((candidate) => candidate.pluginId));
  const score = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
  return {
    id: definition.id,
    label: definition.label,
    phase: definition.phase,
    score,
    candidateCount: candidates.length,
    pluginCount: pluginIds.size,
    recommendedWork: definition.recommendedWork,
    permissionBoundary: definition.permissionBoundary,
    candidates,
  };
}

function candidateScore(
  plugin: ObsidianRealPluginMatrixRow,
  laneId: ObsidianAdapterPriorityLaneId,
  surfaces: ObsidianRealPluginSurfacePolicy[],
  editorPlan: ObsidianEditorAdapterPlan | undefined,
): number {
  return laneDefinition(laneId).baseScore
    + priorityScore(plugin.priority)
    + downloadScore(plugin.downloads)
    + smokeScore(plugin.smoke.outcome)
    + workflowScore(plugin)
    + gateScore(plugin.capabilityGate.status)
    + recommendationScore(plugin.recommendation)
    + surfaceScore(surfaces)
    + editorPlanScore(editorPlan);
}

function priorityScore(priority: ObsidianRealPluginPriority): number {
  if (priority === 'P0') return 300;
  if (priority === 'P1') return 180;
  return 90;
}

function downloadScore(downloads: number | undefined): number {
  if (typeof downloads !== 'number' || downloads <= 0) return 0;
  return Math.min(160, Math.round(Math.log10(downloads + 1) * 32));
}

function smokeScore(outcome: ObsidianRealPluginSmokeOutcome): number {
  if (outcome === 'loaded') return 80;
  if (outcome === 'skipped') return 20;
  if (outcome === 'failed') return -40;
  return 0;
}

function workflowScore(plugin: ObsidianRealPluginMatrixRow): number {
  const probes = plugin.smoke.workflowProbes;
  if (!probes) return 0;
  return probes.passed * 80 + probes.failed * -40 + probes.skipped * 5;
}

function gateScore(status: ObsidianRealPluginMatrixRow['capabilityGate']['status']): number {
  if (status === 'ready') return 70;
  if (status === 'limited') return 45;
  if (status === 'review') return 20;
  return -30;
}

function recommendationScore(recommendation: ObsidianRealPluginRecommendation): number {
  if (recommendation === 'runtime-candidate') return 80;
  if (recommendation === 'review-before-enable') return 40;
  if (recommendation === 'catalog-or-native') return 20;
  if (recommendation === 'investigate') return -10;
  return -30;
}

function surfaceScore(surfaces: ObsidianRealPluginSurfacePolicy[]): number {
  return surfaces.reduce((sum, surface) => sum + surface.apiCount * 8 + actionScore(surface.action) + riskScore(surface.risk), 0);
}

function actionScore(action: ObsidianSurfacePolicyAction): number {
  if (action === 'review-before-enable') return 40;
  if (action === 'native-adapter') return 35;
  if (action === 'catalog-only') return 25;
  if (action === 'allow-after-load') return 20;
  return 5;
}

function riskScore(risk: ObsidianRealPluginSurfacePolicy['risk']): number {
  if (risk === 'critical') return 30;
  if (risk === 'high') return 24;
  if (risk === 'medium') return 14;
  return 8;
}

function editorPlanScore(plan: ObsidianEditorAdapterPlan | undefined): number {
  if (!plan) return 0;
  if (plan.status === 'declarative-adapter-candidate') return 90;
  if (plan.status === 'native-product-feature') return 50;
  if (plan.status === 'full-codemirror-host') return 20;
  if (plan.status === 'native-or-desktop-host') return 10;
  return 0;
}

function compareLanes(a: ObsidianAdapterPriorityLane, b: ObsidianAdapterPriorityLane): number {
  return b.score - a.score
    || phaseOrder(a.phase) - phaseOrder(b.phase)
    || LANE_ORDER.indexOf(a.id) - LANE_ORDER.indexOf(b.id);
}

function compareCandidates(a: ObsidianAdapterPriorityCandidate, b: ObsidianAdapterPriorityCandidate): number {
  return b.score - a.score
    || a.pluginName.localeCompare(b.pluginName)
    || a.laneId.localeCompare(b.laneId);
}

function phaseOrder(phase: ObsidianAdapterPriorityPhase): number {
  if (phase === 'now') return 0;
  if (phase === 'next') return 1;
  if (phase === 'later') return 2;
  return 3;
}

function workflowProbeSummary(plugin: ObsidianRealPluginMatrixRow): string {
  const probes = plugin.smoke.workflowProbes;
  if (!probes || probes.total === 0) return 'none';
  return [
    probes.passed ? `${probes.passed} passed` : '',
    probes.failed ? `${probes.failed} failed` : '',
    probes.skipped ? `${probes.skipped} skipped` : '',
  ].filter(Boolean).join(', ');
}

function appendCandidateTable(
  lines: string[],
  candidates: ObsidianAdapterPriorityCandidate[],
  emptyText: string,
): void {
  if (candidates.length === 0) {
    lines.push(emptyText);
    lines.push('');
    return;
  }

  lines.push('| Plugin | Lane | Score | Gate | Smoke | Probes | Surfaces | Signals | Next |');
  lines.push('|---|---|---:|---|---|---|---|---|---|');
  for (const candidate of candidates) {
    lines.push(`| ${escapeTable(candidate.pluginName)} (${inlineCode(candidate.pluginId)}) | ${escapeTable(laneDefinition(candidate.laneId).label)} | ${candidate.score} | ${candidate.gateStatus} | ${candidate.smokeOutcome} | ${escapeTable(candidate.workflowProbeSummary)} | ${surfaceSummary(candidate.surfaces)} | ${escapeTable(candidate.rankSignals.slice(0, 3).join('; ') || '-')} | ${escapeTable(candidate.nextSteps[0] ?? '-')} |`);
  }
  lines.push('');
}

function surfaceSummary(surfaces: ObsidianAdapterPrioritySurface[]): string {
  if (surfaces.length === 0) return '-';
  return surfaces
    .map((surface) => `${escapeTable(surface.label)} (${surface.action}; ${surface.risk}; apis=${surface.apiCount})`)
    .join('<br>');
}

function dedupeCandidates(candidates: ObsidianAdapterPriorityCandidate[]): ObsidianAdapterPriorityCandidate[] {
  const byKey = new Map<string, ObsidianAdapterPriorityCandidate>();
  for (const candidate of candidates) {
    byKey.set(`${candidate.laneId}:${candidate.pluginId}`, candidate);
  }
  return Array.from(byKey.values());
}

function laneDefinition(laneId: ObsidianAdapterPriorityLaneId): LaneDefinition {
  const definition = LANE_DEFINITIONS.find((candidate) => candidate.id === laneId);
  if (!definition) throw new Error(`Unknown adapter priority lane: ${laneId}`);
  return definition;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``;
}

function escapeTable(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}
