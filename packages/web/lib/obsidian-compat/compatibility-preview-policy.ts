import type { ScannedObsidianPlugin } from './obsidian-import';
import type { ObsidianImportSupport } from './import-policy';
import type { ObsidianCompatibilityPreview } from './compatibility-preview';
import { planObsidianExecution } from './runtime-plan';

type ImportPreview = Pick<ObsidianCompatibilityPreview, 'blockedReasons' | 'workflowOutcomes' | 'importDecision' | 'warnings' | 'nextSteps'>;

/** Installation guidance follows the selected host; server diagnostics remain visible as warnings. */
export function buildDesktopImportPreview(plugin: ScannedObsidianPlugin, support: ObsidianImportSupport, targetPath: string): ImportPreview | undefined {
  if (plugin.compatibilityLevel !== 'blocked' || !support.importable || !planObsidianExecution(plugin.compatibility).desktopCandidate) return;
  const nextStep = 'Leave server execution disabled and request the Desktop experimental editor, then verify the plugin workflow.';
  return {
    blockedReasons: [],
    workflowOutcomes: [{
      id: 'desktop-isolated-editor', label: 'Verify in the isolated Desktop editor', status: 'limited',
      evidence: ['Required static modules are provided; this is not observed plugin execution.'], nextStep,
    }],
    importDecision: {
      action: 'import-package-only', label: 'Desktop editor review', severity: 'warning',
      importable: true, defaultSelected: false, enableAfterImport: false, confidence: 'static-analysis',
      summary: support.reason, reasons: [support.reason],
      requiredEvidence: ['Verify the exact plugin version and workflow in the approved Desktop editor.'], nextStep,
    },
    warnings: ['Server runtime capability predictions below do not describe Desktop execution.',
      ...plugin.compatibility.blockers.map(reason => `Server runtime: ${reason}`)],
    nextSteps: [`Import package into ${targetPath}.`, nextStep],
  };
}

export function buildBlockedReasons(plugin: ScannedObsidianPlugin, support: ObsidianImportSupport): string[] {
  const reasons = [
    ...(support.kind === 'blocked' ? [support.reason] : []),
    ...plugin.compatibility.blockers,
    ...(plugin.compatibility.unsupportedApis.length > 0
      ? [`Unsupported Obsidian APIs: ${plugin.compatibility.unsupportedApis.join(', ')}`]
      : []),
    ...(plugin.compatibility.unsupportedModules.length > 0
      ? [`Unsupported runtime modules: ${plugin.compatibility.unsupportedModules.join(', ')}`]
      : []),
  ];
  return [...new Set(reasons.filter(value => value.trim().length > 0))];
}
