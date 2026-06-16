import type { MindosAskMode } from '@geminilight/mindos/session';
import type { MindosAgentPermissionPolicyMode } from '@geminilight/mindos/agent/tool/permission-policy';

export type HeadlessAgentEntryPoint = 'headless' | 'im' | 'schedule';

export interface HeadlessAgentModeGuardInput {
  requestedMode?: unknown;
  entrypoint?: HeadlessAgentEntryPoint;
  allowAgentMode?: boolean;
  env?: Pick<NodeJS.ProcessEnv, 'MINDOS_HEADLESS_ALLOW_AGENT_MODE' | 'MINDOS_IM_ALLOW_AGENT_MODE'>;
}

export interface HeadlessAgentModeGuardDecision {
  requestedMode: MindosAskMode;
  effectiveMode: MindosAskMode;
  permissionPolicyMode: MindosAgentPermissionPolicyMode;
  entrypoint: HeadlessAgentEntryPoint;
  downgraded: boolean;
  reason?: 'headless_agent_mode_requires_explicit_opt_in';
}

export function resolveHeadlessAgentMode(input: HeadlessAgentModeGuardInput = {}): HeadlessAgentModeGuardDecision {
  const requestedMode = normalizeHeadlessAskMode(input.requestedMode);
  const entrypoint = input.entrypoint ?? 'headless';
  const env = input.env ?? process.env;
  const explicitAllow =
    input.allowAgentMode === true ||
    env.MINDOS_HEADLESS_ALLOW_AGENT_MODE === '1' ||
    (entrypoint === 'im' && env.MINDOS_IM_ALLOW_AGENT_MODE === '1');

  if (requestedMode !== 'agent') {
    return {
      requestedMode,
      effectiveMode: requestedMode,
      permissionPolicyMode: requestedMode,
      entrypoint,
      downgraded: false,
    };
  }

  if (explicitAllow) {
    return {
      requestedMode,
      effectiveMode: 'agent',
      permissionPolicyMode: 'agent',
      entrypoint,
      downgraded: false,
    };
  }

  return {
    requestedMode,
    effectiveMode: 'agent',
    permissionPolicyMode: 'readonly',
    entrypoint,
    downgraded: true,
    reason: 'headless_agent_mode_requires_explicit_opt_in',
  };
}

function normalizeHeadlessAskMode(mode: unknown): MindosAskMode {
  if (mode === 'organize' || mode === 'agent') return mode;
  return 'agent';
}
