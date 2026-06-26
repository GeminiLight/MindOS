import type { ObsidianCapabilitySurface } from './capability-matrix';
import type { ObsidianImportSupport } from './import-policy';
import type {
  ObsidianRuntimeCapabilityLedgerEntry,
  ObsidianRuntimeCapabilityLedgerPhase,
  ObsidianSurfaceCatalogStatus,
  ObsidianWorkflowOutcome,
} from './compatibility-preview';

export type ObsidianSurfaceLedgerProjectionStatus =
  | 'static-only'
  | 'registered'
  | 'called'
  | 'denied'
  | 'native-gated'
  | 'blocked';

export interface ObsidianSurfaceLedgerProjection {
  status: ObsidianSurfaceLedgerProjectionStatus;
  predicted: number;
  registered: number;
  called: number;
  denied: number;
  blocked: number;
  summary: string;
  nextStep: string;
}

export type ObsidianImportDecisionAction =
  | 'enable-after-review'
  | 'import-package-only'
  | 'use-native-replacement'
  | 'blocked';

export type ObsidianImportDecisionSeverity = 'success' | 'warning' | 'danger' | 'neutral';
export type ObsidianImportDecisionConfidence = 'static-analysis' | 'runtime-ledger';

export interface ObsidianImportDecision {
  action: ObsidianImportDecisionAction;
  label: string;
  severity: ObsidianImportDecisionSeverity;
  importable: boolean;
  defaultSelected: boolean;
  enableAfterImport: false;
  confidence: ObsidianImportDecisionConfidence;
  summary: string;
  reasons: string[];
  requiredEvidence: string[];
  nextStep: string;
}

export interface ObsidianSurfaceDecisionInput {
  surface: ObsidianCapabilitySurface;
  label: string;
  status: ObsidianSurfaceCatalogStatus;
  ledger: ObsidianRuntimeCapabilityLedgerEntry[];
}

export interface ObsidianImportDecisionInput {
  support: ObsidianImportSupport;
  blockedReasons: string[];
  surfaceCatalog: Array<{
    surface: ObsidianCapabilitySurface;
    label: string;
    status: ObsidianSurfaceCatalogStatus;
    ledgerProjection: ObsidianSurfaceLedgerProjection;
  }>;
  workflowOutcomes: ObsidianWorkflowOutcome[];
  runtimeCapabilityLedger: ObsidianRuntimeCapabilityLedgerEntry[];
}

export function buildObsidianSurfaceLedgerProjection(
  input: ObsidianSurfaceDecisionInput,
): ObsidianSurfaceLedgerProjection {
  const counts = input.ledger
    .filter((entry) => entry.surface === input.surface)
    .reduce<Record<ObsidianRuntimeCapabilityLedgerPhase, number>>((summary, entry) => {
      summary[entry.phase] += 1;
      return summary;
    }, { predicted: 0, registered: 0, called: 0, denied: 0, blocked: 0 });

  const status = surfaceLedgerProjectionStatus(input.status, counts);
  return {
    status,
    predicted: counts.predicted,
    registered: counts.registered,
    called: counts.called,
    denied: counts.denied,
    blocked: counts.blocked,
    summary: surfaceLedgerProjectionSummary(input.label, status),
    nextStep: surfaceLedgerProjectionNextStep(status),
  };
}

export function buildObsidianImportDecision(
  input: ObsidianImportDecisionInput,
): ObsidianImportDecision {
  const ledgerCounts = input.runtimeCapabilityLedger.reduce<Record<ObsidianRuntimeCapabilityLedgerPhase, number>>((summary, entry) => {
    summary[entry.phase] += 1;
    return summary;
  }, { predicted: 0, registered: 0, called: 0, denied: 0, blocked: 0 });
  const riskSurfaces = input.surfaceCatalog.filter((entry) => (
    entry.ledgerProjection.status === 'blocked'
    || entry.ledgerProjection.status === 'denied'
  ));
  const hasRiskSurface = riskSurfaces.length > 0;
  const hasNativeGate = input.surfaceCatalog.some((entry) => entry.ledgerProjection.status === 'native-gated')
    || input.workflowOutcomes.some((outcome) => outcome.status === 'native-replacement');
  const hasRunnableStaticWorkflow = input.workflowOutcomes.some((outcome) => (
    outcome.status === 'available'
    || outcome.status === 'limited'
    || outcome.status === 'preview-only'
  ));
  const hasLimitedSurface = input.surfaceCatalog.some((entry) => (
    entry.status === 'limited'
    || entry.status === 'preview-only'
    || entry.status === 'catalog-only'
    || entry.status === 'request-only'
  ));
  const hasRuntimeEvidence = ledgerCounts.registered > 0
    || ledgerCounts.called > 0
    || ledgerCounts.denied > 0
    || ledgerCounts.blocked > 0;

  if (input.support.kind === 'blocked' || input.blockedReasons.length > 0 || hasRiskSurface) {
    const deniedOnly = input.support.kind !== 'blocked'
      && input.blockedReasons.length === 0
      && riskSurfaces.every((entry) => entry.ledgerProjection.status === 'denied');
    return {
      action: 'blocked',
      label: deniedOnly ? 'Policy denied' : 'Blocked',
      severity: 'danger',
      importable: false,
      defaultSelected: false,
      enableAfterImport: false,
      confidence: hasRuntimeEvidence ? 'runtime-ledger' : 'static-analysis',
      summary: deniedOnly
        ? 'Do not import or enable this plugin until denied runtime policy events are reviewed and explicitly allowed or replaced.'
        : 'Do not import or enable this plugin until blocked APIs, modules, or capability gates are replaced or explicitly supported.',
      reasons: unique([
        ...input.blockedReasons,
        ...riskSurfaces.map((entry) => `${entry.label}: ${entry.ledgerProjection.summary}`),
      ]).slice(0, 4),
      requiredEvidence: [
        deniedOnly
          ? 'Review the denied runtime policy event and confirm whether this capability should remain denied, be replaced, or receive explicit permission.'
          : 'Remove or replace blocked Obsidian APIs, Node/Electron modules, or capability-gate failures.',
        'Re-run static analysis and capability gate checks before import.',
      ],
      nextStep: deniedOnly
        ? 'Keep this plugin unchecked until the denied capability has an explicit MindOS policy decision.'
        : 'Keep this plugin unchecked and route the workflow to a MindOS-native replacement or explicit adapter work.',
    };
  }

  if (hasNativeGate && !hasRunnableStaticWorkflow) {
    return {
      action: 'use-native-replacement',
      label: 'Use native replacement',
      severity: 'neutral',
      importable: input.support.importable,
      defaultSelected: input.support.defaultSelected,
      enableAfterImport: false,
      confidence: hasRuntimeEvidence ? 'runtime-ledger' : 'static-analysis',
      summary: 'Static analysis points mainly to native-gated editor, CodeMirror, or product-owned behavior rather than a generic runnable plugin surface.',
      reasons: nativeReasons(input.surfaceCatalog, input.workflowOutcomes),
      requiredEvidence: [
        'Design or use a MindOS-native adapter for the gated workflow.',
        'Only treat the community package as reference/config material until native behavior is proven.',
      ],
      nextStep: 'Prefer a MindOS-native workflow and keep generic plugin execution disabled unless a narrow adapter is added.',
    };
  }

  if (hasNativeGate || input.support.kind === 'review') {
    return {
      action: 'import-package-only',
      label: 'Import package only',
      severity: 'warning',
      importable: input.support.importable,
      defaultSelected: input.support.defaultSelected,
      enableAfterImport: false,
      confidence: hasRuntimeEvidence ? 'runtime-ledger' : 'static-analysis',
      summary: 'Import can preserve the package and settings, but enabling should wait for native-gated surfaces or review-only decisions to be resolved.',
      reasons: unique([
        ...nativeReasons(input.surfaceCatalog, input.workflowOutcomes),
        input.support.kind === 'review' ? input.support.reason : '',
      ].filter(Boolean)).slice(0, 4),
      requiredEvidence: [
        'Review native-gated or review-only surfaces before enabling.',
        'Load from Installed and compare registered/called ledger entries with predicted surfaces.',
        'Run focused workflow probes before marking workflows observed.',
      ],
      nextStep: 'Copy the package for review, keep it disabled, and route gated surfaces through native adapters.',
    };
  }

  return {
    action: 'enable-after-review',
    label: input.support.kind === 'ready' ? 'Ready for import review' : 'Limited import review',
    severity: input.support.kind === 'ready' && !hasLimitedSurface ? 'success' : 'warning',
    importable: input.support.importable,
    defaultSelected: input.support.defaultSelected,
    enableAfterImport: false,
    confidence: hasRuntimeEvidence ? 'runtime-ledger' : 'static-analysis',
    summary: input.support.kind === 'ready' && !hasLimitedSurface
      ? 'The package is importable, but runtime registration and workflow proof are still required before claiming observed compatibility.'
      : 'The package is importable with limited surfaces; capability review, runtime ledger evidence, and workflow probes are required before relying on it.',
    reasons: decisionReasons(input.surfaceCatalog, ledgerCounts, hasLimitedSurface),
    requiredEvidence: [
      'Load from Installed and confirm runtime ledger registration for predicted surfaces.',
      'Run focused workflow probes before marking workflows observed.',
      ...(hasLimitedSurface ? ['Review capability prompts and limited surface restrictions before enabling user workflows.'] : []),
    ],
    nextStep: input.support.kind === 'ready' && !hasLimitedSurface
      ? 'Import the package, then enable from Installed after reviewing capability prompts.'
      : 'Import the package, review limited surfaces, then enable only after runtime and workflow evidence is collected.',
  };
}

function surfaceLedgerProjectionStatus(
  catalogStatus: ObsidianSurfaceCatalogStatus,
  counts: Record<ObsidianRuntimeCapabilityLedgerPhase, number>,
): ObsidianSurfaceLedgerProjectionStatus {
  if (catalogStatus === 'native-gated') return 'native-gated';
  if (catalogStatus === 'blocked' || counts.blocked > 0) return 'blocked';
  if (counts.denied > 0) return 'denied';
  if (counts.called > 0) return 'called';
  if (counts.registered > 0) return 'registered';
  return 'static-only';
}

function surfaceLedgerProjectionSummary(
  label: string,
  status: ObsidianSurfaceLedgerProjectionStatus,
): string {
  if (status === 'called') return `${label} has runtime called evidence, but workflow-level behavior still needs focused verification.`;
  if (status === 'registered') return `${label} has runtime registration evidence; execute the workflow before calling it observed.`;
  if (status === 'denied') return `${label} has runtime policy denial evidence; this capability was not granted to the plugin.`;
  if (status === 'native-gated') return `${label} is statically detected but stays behind a MindOS native adapter gate.`;
  if (status === 'blocked') return `${label} contains blocked static or runtime capability evidence.`;
  return `${label} is only predicted by static analysis until the plugin is loaded and checked against the runtime ledger.`;
}

function surfaceLedgerProjectionNextStep(status: ObsidianSurfaceLedgerProjectionStatus): string {
  if (status === 'called') return 'Run or inspect the workflow probe that proves user-visible behavior.';
  if (status === 'registered') return 'Execute the registered action and confirm called ledger evidence.';
  if (status === 'denied') return 'Review the denied runtime policy event before broadening this plugin capability.';
  if (status === 'native-gated') return 'Route this surface through a MindOS native adapter before treating it as runnable.';
  if (status === 'blocked') return 'Replace or explicitly support the blocked capability before import/enable.';
  return 'Load the plugin and compare registered/called ledger events with this prediction.';
}

function nativeReasons(
  surfaceCatalog: ObsidianImportDecisionInput['surfaceCatalog'],
  workflowOutcomes: ObsidianWorkflowOutcome[],
): string[] {
  return unique([
    ...surfaceCatalog
      .filter((entry) => entry.ledgerProjection.status === 'native-gated')
      .map((entry) => `${entry.label}: ${entry.ledgerProjection.summary}`),
    ...workflowOutcomes
      .filter((outcome) => outcome.status === 'native-replacement')
      .map((outcome) => `${outcome.label}: ${outcome.nextStep ?? 'Use a MindOS-native replacement.'}`),
  ]).slice(0, 4);
}

function decisionReasons(
  surfaceCatalog: ObsidianImportDecisionInput['surfaceCatalog'],
  ledgerCounts: Record<ObsidianRuntimeCapabilityLedgerPhase, number>,
  hasLimitedSurface: boolean,
): string[] {
  const leadingSurfaces = surfaceCatalog
    .filter((entry) => entry.surface !== 'core')
    .slice(0, 3)
    .map((entry) => `${entry.label}: ${entry.status}`);
  return unique([
    `${ledgerCounts.predicted} predicted surface API${ledgerCounts.predicted === 1 ? '' : 's'} from static analysis.`,
    hasLimitedSurface ? 'At least one surface is limited, preview-only, catalog-only, or request-only.' : '',
    ...leadingSurfaces,
  ].filter(Boolean));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
