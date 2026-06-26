import type {
  ObsidianRuntimeCapabilityLedgerEntry,
  ObsidianRuntimeCapabilityLedgerPhase,
} from '@/lib/obsidian-compat/compatibility-preview';
import { getObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import type { ObsidianWorkflowAudit } from '@/lib/obsidian-compat/workflow-audit';
import {
  surfaceLedgerProjections,
  type ObsidianPluginStatus,
  type SurfaceLedgerProjectionView,
} from './ObsidianPluginHostModel';

export type ObsidianCompatibilityPostureStatus =
  | 'observed'
  | 'ready'
  | 'limited'
  | 'review'
  | 'native'
  | 'blocked';

export type ObsidianCompatibilityEvidenceStatus =
  | ObsidianCompatibilityPostureStatus
  | 'partial'
  | 'registered'
  | 'called'
  | 'missing';

export type ObsidianCompatibilityEvidenceLayer = 'static' | 'runtime' | 'workflow';

export interface ObsidianCompatibilityEvidenceStep {
  layer: ObsidianCompatibilityEvidenceLayer;
  label: string;
  status: ObsidianCompatibilityEvidenceStatus;
  statusLabel: string;
  summary: string;
}

export interface ObsidianCompatibilityPosture {
  status: ObsidianCompatibilityPostureStatus;
  label: string;
  summary: string;
  nextStep: string;
  evidence: ObsidianCompatibilityEvidenceStep[];
  observedWorkflows: number;
  partialWorkflows: number;
  blockedWorkflows: number;
  nativeWorkflows: number;
}

export function compatibilityPosture(plugin: ObsidianPluginStatus): ObsidianCompatibilityPosture {
  const support = getObsidianImportSupport(plugin);
  const surfaces = surfaceLedgerProjections(plugin);
  const mergedLedgerCounts = countLedgerPhases(plugin.capabilityLedger ?? plugin.runtime.capabilityLedger ?? []);
  const runtimeCounts = runtimeEvidenceCounts(plugin);
  const audits = plugin.workflowAudits ?? [];
  const auditCounts = workflowAuditCounts(audits);
  const blockedReasons = [
    ...plugin.compatibility.blockers,
    ...(plugin.capabilityGate?.blockedReasons ?? []),
    support.kind === 'blocked' ? support.reason : '',
  ].filter(Boolean);
  const hasBlocked = blockedReasons.length > 0
    || plugin.capabilityGate?.blocked === true
    || auditCounts.blocked > 0
    || mergedLedgerCounts.blocked > 0
    || runtimeCounts.blocked > 0
    || surfaces.some((surface) => surface.projection.status === 'blocked');
  const nativeSurfaceCount = surfaces.filter((surface) => surface.projection.status === 'native-gated').length;
  const hasNativeEvidence = auditCounts.native > 0 || nativeSurfaceCount > 0;
  const needsReview = support.kind === 'review'
    || (plugin.capabilityGate?.requiresConfirmation === true && plugin.capabilityGate.confirmed !== true);
  const hasLimitedStaticSurface = (plugin.surfaceSummary ?? []).some((summary) => (
    summary.supportSummary.limited > 0
    || summary.supportSummary['snapshot-only'] > 0
    || summary.supportSummary['catalog-only'] > 0
    || summary.supportSummary['request-only'] > 0
  ));
  const hasRuntimeEvidence = runtimeCounts.registered > 0 || runtimeCounts.called > 0;

  const evidence = [
    staticEvidenceStep(plugin, support.kind, surfaces, mergedLedgerCounts, hasLimitedStaticSurface, blockedReasons),
    runtimeEvidenceStep(runtimeCounts, mergedLedgerCounts),
    workflowEvidenceStep(auditCounts, audits.length),
  ];

  if (hasBlocked) {
    return {
      status: 'blocked',
      label: 'Blocked',
      summary: blockedReasons[0] ?? 'Blocked capability or workflow evidence is present.',
      nextStep: 'Resolve blocked APIs, capability gates, or workflow failures before enabling this plugin for user workflows.',
      evidence,
      observedWorkflows: auditCounts.observed,
      partialWorkflows: auditCounts.partial + auditCounts.notObserved,
      blockedWorkflows: auditCounts.blocked,
      nativeWorkflows: auditCounts.native,
    };
  }

  if (auditCounts.observed > 0) {
    const remaining = Math.max(0, audits.length - auditCounts.observed - auditCounts.native);
    return {
      status: 'observed',
      label: 'Workflow observed',
      summary: remaining > 0
        ? `${auditCounts.observed} named workflow${auditCounts.observed === 1 ? '' : 's'} passed probe/audit evidence; ${remaining} still need stronger proof.`
        : `${auditCounts.observed} named workflow${auditCounts.observed === 1 ? '' : 's'} passed probe/audit evidence.`,
      nextStep: remaining > 0
        ? 'Keep compatibility scoped to observed workflows and run probes for the remaining workflow audits.'
        : 'Keep this status scoped to the named workflow evidence; broader Obsidian parity still requires separate probes.',
      evidence,
      observedWorkflows: auditCounts.observed,
      partialWorkflows: auditCounts.partial + auditCounts.notObserved,
      blockedWorkflows: auditCounts.blocked,
      nativeWorkflows: auditCounts.native,
    };
  }

  if (hasNativeEvidence && !hasRuntimeEvidence && auditCounts.partial === 0 && auditCounts.notObserved === 0) {
    return {
      status: 'native',
      label: 'Native route',
      summary: auditCounts.native > 0
        ? `${auditCounts.native} workflow${auditCounts.native === 1 ? '' : 's'} should use a MindOS-native replacement.`
        : `${nativeSurfaceCount} detected surface${nativeSurfaceCount === 1 ? '' : 's'} stay behind a MindOS-native adapter gate.`,
      nextStep: 'Use or build the MindOS-native adapter before treating the community package as runnable.',
      evidence,
      observedWorkflows: auditCounts.observed,
      partialWorkflows: auditCounts.partial + auditCounts.notObserved,
      blockedWorkflows: auditCounts.blocked,
      nativeWorkflows: auditCounts.native,
    };
  }

  if (needsReview) {
    return {
      status: 'review',
      label: 'Needs review',
      summary: support.kind === 'review' ? support.reason : 'Capability confirmation is required before this plugin can be enabled.',
      nextStep: 'Review the requested capabilities, then load the plugin and collect runtime plus workflow evidence.',
      evidence,
      observedWorkflows: auditCounts.observed,
      partialWorkflows: auditCounts.partial + auditCounts.notObserved,
      blockedWorkflows: auditCounts.blocked,
      nativeWorkflows: auditCounts.native,
    };
  }

  if (
    auditCounts.partial > 0
    || auditCounts.notObserved > 0
    || hasRuntimeEvidence
    || hasLimitedStaticSurface
    || support.kind === 'limited'
    || hasNativeEvidence
  ) {
    return {
      status: 'limited',
      label: 'Limited evidence',
      summary: hasRuntimeEvidence
        ? 'Runtime registration or called evidence exists, but no named workflow has passed probe/audit evidence yet.'
        : 'Static analysis found limited or native-gated surfaces that still need runtime and workflow proof.',
      nextStep: 'Run focused workflow probes and keep runtime-called evidence separate from observed workflow compatibility.',
      evidence,
      observedWorkflows: auditCounts.observed,
      partialWorkflows: auditCounts.partial + auditCounts.notObserved,
      blockedWorkflows: auditCounts.blocked,
      nativeWorkflows: auditCounts.native,
    };
  }

  return {
    status: 'ready',
    label: 'Static ready',
    summary: 'Static analysis has not found blockers, but this is not workflow-observed compatibility yet.',
    nextStep: 'Load the plugin, compare runtime ledger evidence with static surfaces, then run focused workflow probes.',
    evidence,
    observedWorkflows: auditCounts.observed,
    partialWorkflows: auditCounts.partial + auditCounts.notObserved,
    blockedWorkflows: auditCounts.blocked,
    nativeWorkflows: auditCounts.native,
  };
}

export function compatibilityEvidenceStatusClass(status: ObsidianCompatibilityEvidenceStatus): string {
  if (status === 'observed' || status === 'ready') {
    return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  }
  if (status === 'blocked') {
    return 'border-error/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-error';
  }
  if (status === 'limited' || status === 'review' || status === 'partial' || status === 'registered' || status === 'called') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  if (status === 'native') return 'border-border bg-background text-foreground';
  return 'border-border bg-background text-muted-foreground';
}

export function compatibilityPostureStatusClass(status: ObsidianCompatibilityPostureStatus): string {
  return compatibilityEvidenceStatusClass(status);
}

function countLedgerPhases(
  entries: ObsidianRuntimeCapabilityLedgerEntry[],
): Record<ObsidianRuntimeCapabilityLedgerPhase, number> {
  return entries.reduce<Record<ObsidianRuntimeCapabilityLedgerPhase, number>>((summary, entry) => {
    summary[entry.phase] += 1;
    return summary;
  }, { predicted: 0, registered: 0, called: 0, blocked: 0 });
}

function runtimeEvidenceCounts(plugin: ObsidianPluginStatus): Record<ObsidianRuntimeCapabilityLedgerPhase, number> {
  const current = countLedgerPhases(plugin.runtime.capabilityLedger ?? []);
  const history = plugin.capabilityLedgerHistory?.summary ?? { predicted: 0, registered: 0, called: 0, blocked: 0 };
  return {
    predicted: current.predicted + history.predicted,
    registered: current.registered + history.registered,
    called: current.called + history.called,
    blocked: current.blocked + history.blocked,
  };
}

function workflowAuditCounts(audits: ObsidianWorkflowAudit[]): {
  observed: number;
  partial: number;
  blocked: number;
  native: number;
  notObserved: number;
} {
  return audits.reduce((summary, audit) => {
    if (audit.status === 'observed') summary.observed += 1;
    else if (audit.status === 'partial') summary.partial += 1;
    else if (audit.status === 'blocked') summary.blocked += 1;
    else if (audit.status === 'native-replacement') summary.native += 1;
    else summary.notObserved += 1;
    return summary;
  }, { observed: 0, partial: 0, blocked: 0, native: 0, notObserved: 0 });
}

function staticEvidenceStep(
  plugin: ObsidianPluginStatus,
  supportKind: ReturnType<typeof getObsidianImportSupport>['kind'],
  surfaces: SurfaceLedgerProjectionView[],
  ledgerCounts: Record<ObsidianRuntimeCapabilityLedgerPhase, number>,
  hasLimitedStaticSurface: boolean,
  blockedReasons: string[],
): ObsidianCompatibilityEvidenceStep {
  const detectedApis = plugin.coverage?.length ?? surfaces.reduce((total, surface) => total + surface.apiCount, 0);
  const nativeSurfaces = surfaces.filter((surface) => surface.projection.status === 'native-gated').length;
  let status: ObsidianCompatibilityEvidenceStatus = 'ready';
  let summary = detectedApis > 0
    ? `${detectedApis} static API surface${detectedApis === 1 ? '' : 's'} mapped before runtime.`
    : 'No static Obsidian API surface was detected.';

  if (blockedReasons.length > 0 || ledgerCounts.blocked > 0 || surfaces.some((surface) => surface.projection.status === 'blocked')) {
    status = 'blocked';
    summary = blockedReasons[0] ?? `${ledgerCounts.blocked} blocked static/runtime ledger item${ledgerCounts.blocked === 1 ? '' : 's'} found.`;
  } else if (nativeSurfaces > 0) {
    status = 'native';
    summary = `${nativeSurfaces} surface${nativeSurfaces === 1 ? '' : 's'} need a MindOS-native adapter gate.`;
  } else if (supportKind === 'review') {
    status = 'review';
    summary = 'Static policy requires explicit capability review.';
  } else if (supportKind === 'limited' || hasLimitedStaticSurface) {
    status = 'limited';
    summary = 'Static analysis found limited, preview-only, catalog-only, or request-only surfaces.';
  }

  return {
    layer: 'static',
    label: 'Static',
    status,
    statusLabel: compatibilityEvidenceStatusLabel(status),
    summary,
  };
}

function runtimeEvidenceStep(
  runtimeCounts: Record<ObsidianRuntimeCapabilityLedgerPhase, number>,
  mergedLedgerCounts: Record<ObsidianRuntimeCapabilityLedgerPhase, number>,
): ObsidianCompatibilityEvidenceStep {
  let status: ObsidianCompatibilityEvidenceStatus = 'missing';
  let summary = mergedLedgerCounts.predicted > 0
    ? `${mergedLedgerCounts.predicted} predicted ledger item${mergedLedgerCounts.predicted === 1 ? '' : 's'}; no actual runtime event yet.`
    : 'No runtime ledger evidence has been recorded yet.';

  if (runtimeCounts.blocked > 0) {
    status = 'blocked';
    summary = `${runtimeCounts.blocked} blocked runtime event${runtimeCounts.blocked === 1 ? '' : 's'} recorded.`;
  } else if (runtimeCounts.called > 0) {
    status = 'called';
    summary = `${runtimeCounts.called} called event${runtimeCounts.called === 1 ? '' : 's'} recorded; this is still below workflow observation.`;
  } else if (runtimeCounts.registered > 0) {
    status = 'registered';
    summary = `${runtimeCounts.registered} registered event${runtimeCounts.registered === 1 ? '' : 's'} recorded; execute workflows to collect called evidence.`;
  }

  return {
    layer: 'runtime',
    label: 'Runtime',
    status,
    statusLabel: compatibilityEvidenceStatusLabel(status),
    summary,
  };
}

function workflowEvidenceStep(
  counts: ReturnType<typeof workflowAuditCounts>,
  total: number,
): ObsidianCompatibilityEvidenceStep {
  let status: ObsidianCompatibilityEvidenceStatus = 'missing';
  let summary = total > 0
    ? `${total} workflow audit${total === 1 ? '' : 's'} exist, but none have passed a probe.`
    : 'No named workflow audit exists yet.';

  if (counts.blocked > 0) {
    status = 'blocked';
    summary = `${counts.blocked} workflow audit${counts.blocked === 1 ? '' : 's'} blocked.`;
  } else if (counts.observed > 0) {
    status = 'observed';
    summary = `${counts.observed} workflow${counts.observed === 1 ? '' : 's'} passed probe/audit evidence.`;
  } else if (counts.native > 0 && counts.partial === 0 && counts.notObserved === 0) {
    status = 'native';
    summary = `${counts.native} workflow${counts.native === 1 ? '' : 's'} should use native MindOS behavior.`;
  } else if (counts.partial > 0) {
    status = 'partial';
    summary = `${counts.partial} workflow audit${counts.partial === 1 ? '' : 's'} have partial evidence only.`;
  }

  return {
    layer: 'workflow',
    label: 'Workflow',
    status,
    statusLabel: compatibilityEvidenceStatusLabel(status),
    summary,
  };
}

function compatibilityEvidenceStatusLabel(status: ObsidianCompatibilityEvidenceStatus): string {
  if (status === 'observed') return 'observed';
  if (status === 'ready') return 'ready';
  if (status === 'limited') return 'limited';
  if (status === 'review') return 'review';
  if (status === 'native') return 'native';
  if (status === 'blocked') return 'blocked';
  if (status === 'partial') return 'partial';
  if (status === 'registered') return 'registered';
  if (status === 'called') return 'called';
  return 'missing';
}
