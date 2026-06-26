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

export type ObsidianSurfacePolicyAction =
  | 'allow-after-load'
  | 'review-before-enable'
  | 'catalog-only'
  | 'native-adapter'
  | 'blocked';

export type ObsidianSurfacePolicyRisk = 'low' | 'medium' | 'high' | 'critical';
export type ObsidianSurfacePolicyRuntimeDefault =
  | 'mounted'
  | 'restricted'
  | 'snapshot'
  | 'request'
  | 'catalog'
  | 'native-gated'
  | 'blocked';

export interface ObsidianSurfacePolicyDecision {
  action: ObsidianSurfacePolicyAction;
  label: string;
  risk: ObsidianSurfacePolicyRisk;
  runtimeDefault: ObsidianSurfacePolicyRuntimeDefault;
  summary: string;
  permissionBoundary: string;
  requiredEvidence: string[];
  nextStep: string;
}

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

export function buildObsidianSurfacePolicyDecision(input: {
  surface: ObsidianCapabilitySurface;
  label: string;
  status: ObsidianSurfaceCatalogStatus;
}): ObsidianSurfacePolicyDecision {
  if (input.status === 'blocked' || input.surface === 'unsupported') {
    return surfacePolicy({
      action: 'blocked',
      label: 'Blocked',
      risk: 'critical',
      runtimeDefault: 'blocked',
      summary: `${input.label} is not exposed through the generic Obsidian compatibility runtime.`,
      permissionBoundary: 'Unsupported Obsidian APIs or Node/Electron modules are not exposed by the generic runtime.',
      requiredEvidence: [
        'Remove or replace blocked APIs/modules, or add an explicit reviewed adapter.',
        'Re-run static analysis and capability gate checks before import or enable.',
      ],
      nextStep: 'Keep this surface disabled and route the workflow to a MindOS-native replacement or explicit adapter.',
    });
  }

  if (input.status === 'native-gated' || input.surface === 'editor') {
    return surfacePolicy({
      action: 'native-adapter',
      label: 'Native adapter',
      risk: 'high',
      runtimeDefault: 'native-gated',
      summary: `${input.label} requires a MindOS-owned adapter before it can become runnable.`,
      permissionBoundary: 'Raw editor and CodeMirror behavior is not mounted directly; use MindOS-owned adapter contracts.',
      requiredEvidence: [
        'Adapter contract covering allowed editor reads, decorations, commands, and cleanup.',
        'Fixture tests proving mount/unmount isolation before changing this surface from native-gated.',
      ],
      nextStep: 'Keep raw community behavior catalog-only and implement a narrow MindOS adapter first.',
    });
  }

  if (input.status === 'catalog-only') {
    return surfacePolicy({
      action: 'catalog-only',
      label: 'Catalog only',
      risk: 'medium',
      runtimeDefault: 'catalog',
      summary: `${input.label} is visible for planning but not mounted as live behavior.`,
      permissionBoundary: 'Catalog-only registrations may be displayed or migrated, but plugin callbacks are not executed.',
      requiredEvidence: [
        'A MindOS adapter or explicit host implementation for the cataloged behavior.',
        'Runtime registered/called ledger evidence after the host exists.',
      ],
      nextStep: 'Use this surface for migration planning until a focused host or native replacement exists.',
    });
  }

  if (input.status === 'request-only') {
    return surfacePolicy({
      action: 'catalog-only',
      label: 'Request only',
      risk: 'medium',
      runtimeDefault: 'request',
      summary: `${input.label} records intent for MindOS handling instead of replaying Obsidian side effects.`,
      permissionBoundary: 'Requests are captured and must be fulfilled by a MindOS-owned surface or workflow.',
      requiredEvidence: [
        'Mapped MindOS handler for the recorded request.',
        'Workflow probe proving the request produced the intended user-visible result.',
      ],
      nextStep: 'Map the request to a MindOS-native action before relying on workflow behavior.',
    });
  }

  if (input.status === 'preview-only') {
    return surfacePolicy({
      action: 'review-before-enable',
      label: 'Preview review',
      risk: riskForSurface(input.surface),
      runtimeDefault: 'snapshot',
      summary: `${input.label} can produce bounded snapshots, but snapshots are not full Obsidian UI equivalence.`,
      permissionBoundary: boundaryForSurface(input.surface),
      requiredEvidence: [
        'Snapshot output review for sensitive content and expected structure.',
        'Focused workflow probe before marking the workflow observed.',
      ],
      nextStep: 'Inspect snapshot evidence and keep user actions explicit until workflow probes pass.',
    });
  }

  if (input.status === 'limited' || requiresReviewSurface(input.surface)) {
    return surfacePolicy({
      action: 'review-before-enable',
      label: 'Review before enable',
      risk: riskForSurface(input.surface),
      runtimeDefault: runtimeDefaultForSurface(input.surface),
      summary: `${input.label} is available only inside MindOS capability and runtime policy boundaries.`,
      permissionBoundary: boundaryForSurface(input.surface),
      requiredEvidence: [
        'Capability gate confirmation for the current fingerprint.',
        'Runtime denied/called ledger review for this surface.',
        'Focused workflow probe before marking behavior observed.',
      ],
      nextStep: 'Keep enable explicit, review ledger evidence, then run a focused workflow probe.',
    });
  }

  return surfacePolicy({
    action: 'allow-after-load',
    label: 'Allow after load',
    risk: riskForSurface(input.surface),
    runtimeDefault: runtimeDefaultForSurface(input.surface),
    summary: `${input.label} can enter the generic compatibility runtime after plugin load checks.`,
    permissionBoundary: boundaryForSurface(input.surface),
    requiredEvidence: [
      input.surface === 'commands'
        ? 'Runtime registered evidence for command ids.'
        : 'Runtime registered evidence for this surface.',
      'Called ledger evidence or workflow probe before claiming user-visible workflow success.',
    ],
    nextStep: 'Load the plugin, compare runtime registered/called evidence, and keep workflow success evidence separate.',
  });
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

function surfacePolicy(input: ObsidianSurfacePolicyDecision): ObsidianSurfacePolicyDecision {
  return input;
}

function requiresReviewSurface(surface: ObsidianCapabilitySurface): boolean {
  return surface === 'network'
    || surface === 'secret'
    || surface === 'vault'
    || surface === 'metadata'
    || surface === 'document'
    || surface === 'views'
    || surface === 'workspace';
}

function riskForSurface(surface: ObsidianCapabilitySurface): ObsidianSurfacePolicyRisk {
  if (surface === 'unsupported') return 'critical';
  if (surface === 'network' || surface === 'secret' || surface === 'vault' || surface === 'editor') return 'high';
  if (surface === 'metadata' || surface === 'workspace' || surface === 'document' || surface === 'views') return 'medium';
  if (surface === 'commands' || surface === 'settings' || surface === 'entries') return 'medium';
  return 'low';
}

function runtimeDefaultForSurface(surface: ObsidianCapabilitySurface): ObsidianSurfacePolicyRuntimeDefault {
  if (surface === 'network' || surface === 'secret' || surface === 'vault' || surface === 'metadata' || surface === 'document' || surface === 'views' || surface === 'workspace') {
    return 'restricted';
  }
  if (surface === 'editor') return 'native-gated';
  if (surface === 'unsupported') return 'blocked';
  return 'mounted';
}

function boundaryForSurface(surface: ObsidianCapabilitySurface): string {
  return {
    commands: 'Commands may register in MindOS Command Center, but execution still inherits downstream surface gates.',
    settings: 'Settings may render through MindOS settings hosts; write actions stay explicit and plugin-scoped.',
    entries: 'Entry surfaces are represented as bounded snapshots or explicit continuations, not arbitrary global DOM control.',
    views: 'Views may mount only through MindOS compatibility view hosts; full Obsidian pane graph behavior is not emulated.',
    document: 'Document rendering uses safe snapshot/renderer paths and must not inject arbitrary script into the main UI.',
    styles: 'Styles are scoped to compatibility hosts and must not mutate global MindOS chrome.',
    editor: 'Raw editor and CodeMirror behavior is not mounted directly; use MindOS-owned adapter contracts.',
    secret: 'Secrets stay plugin-scoped and must use the MindOS secret vault or future native broker.',
    vault: 'Vault access is scoped to public MindOS content; private plugin/system directories stay hidden.',
    metadata: 'Metadata reads come from MindOS parsed markdown/frontmatter/tag/link caches, not arbitrary vault traversal.',
    workspace: 'Workspace side effects are captured as explicit requests or MindOS-routed actions.',
    network: 'Outbound requests stay behind protocol, host, timeout, response-size, and credentials policy.',
    core: 'Core lifecycle runs inside the restricted compatibility wrapper and does not imply broader surface permission.',
    unsupported: 'Unsupported Obsidian APIs or Node/Electron modules are not exposed by the generic runtime.',
  }[surface];
}
