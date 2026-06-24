import type { ObsidianCapabilityCoverage } from './capability-matrix';
import type { CompatibilityLevel, PluginCompatibilityReport } from './compatibility-report';
import {
  ObsidianCapabilityGateConfirmationRequiredError,
  buildObsidianCapabilityGateReport,
  createObsidianCapabilityGateConfirmation,
  type ObsidianCapabilityGateConfirmation,
  type ObsidianCapabilityGateReport,
} from './capability-gate';
import type { PluginManifest } from './types';
import { ErrorCodes, MindOSError } from '@/lib/errors';

export interface ObsidianCapabilityGateSubject {
  id: string;
  manifest: PluginManifest;
  compatibility: PluginCompatibilityReport;
  compatibilityLevel: CompatibilityLevel;
  coverage: ObsidianCapabilityCoverage[];
}

export interface ObsidianCapabilityGateConfirmationStore {
  capabilityConfirmations?: Record<string, ObsidianCapabilityGateConfirmation>;
}

export interface ObsidianCapabilityGateEnableOptions {
  confirmCapabilityGate?: boolean;
}

export interface ObsidianCapabilityGateEnableResult {
  report: ObsidianCapabilityGateReport;
  confirmationStore: ObsidianCapabilityGateConfirmationStore;
}

export function buildPluginCapabilityGateReport(
  subject: ObsidianCapabilityGateSubject,
  store: ObsidianCapabilityGateConfirmationStore,
): ObsidianCapabilityGateReport {
  return buildObsidianCapabilityGateReport({
    manifest: subject.manifest,
    compatibility: subject.compatibility,
    compatibilityLevel: subject.compatibilityLevel,
    coverage: subject.coverage,
    confirmation: store.capabilityConfirmations?.[subject.id],
  });
}

export function assertPluginCapabilityGateAllowsEnable(
  subject: ObsidianCapabilityGateSubject,
  store: ObsidianCapabilityGateConfirmationStore,
  options: ObsidianCapabilityGateEnableOptions,
): ObsidianCapabilityGateEnableResult {
  const report = buildPluginCapabilityGateReport(subject, store);
  if (report.blocked) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, report.blockedReasons[0] ?? 'Plugin is blocked by capability gate.');
  }

  if (!report.requiresConfirmation || report.confirmed) {
    return { report, confirmationStore: store };
  }

  if (!options.confirmCapabilityGate) {
    throw new ObsidianCapabilityGateConfirmationRequiredError(report);
  }

  const confirmation = createObsidianCapabilityGateConfirmation(report);
  const confirmationStore = {
    ...store,
    capabilityConfirmations: {
      ...(store.capabilityConfirmations ?? {}),
      [subject.id]: confirmation,
    },
  };

  return {
    report: buildPluginCapabilityGateReport(subject, confirmationStore),
    confirmationStore,
  };
}

export function assertPluginCapabilityGateAllowsLoad(
  subject: ObsidianCapabilityGateSubject,
  store: ObsidianCapabilityGateConfirmationStore,
): ObsidianCapabilityGateReport {
  const report = buildPluginCapabilityGateReport(subject, store);
  if (report.blocked) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, report.blockedReasons[0] ?? 'Plugin is blocked by capability gate.');
  }
  if (report.requiresConfirmation && !report.confirmed) {
    throw new ObsidianCapabilityGateConfirmationRequiredError(report);
  }
  return report;
}
