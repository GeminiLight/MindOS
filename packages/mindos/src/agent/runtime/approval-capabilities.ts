import type { AgentRuntimeCompatibilityRequirement } from './registry.js';

/** Product facts shared by compatibility and UI projections; persistence does not resurrect an external process. */
export const RUNTIME_APPROVAL_CAPABILITIES = {
  scope: 'cross-process-run' as const,
  summary: 'Approval requests and decisions are persisted and can be resolved across host processes while the owning runtime is alive.',
  recoverySummary: 'Restarting a lost runtime and resuming its pending tool approval is not supported.',
  blockers: ['approval-owner-recovery', 'approval-timeout-recovery'],
};

export function runtimeApprovalRequirements(): AgentRuntimeCompatibilityRequirement[] {
  return [
    { id: 'durable-approval-queue', status: 'satisfied', owner: 'mindos', summary: RUNTIME_APPROVAL_CAPABILITIES.summary },
    { id: 'cross-process-approval', status: 'satisfied', owner: 'mindos', summary: 'Another host process can submit the decision to the original owner.' },
    { id: 'approval-timeout-recovery', status: 'missing', owner: 'mindos', summary: 'Expired approvals require an explicit retry instead of automatically resuming the action.' },
    { id: 'approval-owner-recovery', status: 'missing', owner: 'mindos', summary: RUNTIME_APPROVAL_CAPABILITIES.recoverySummary },
  ];
}
