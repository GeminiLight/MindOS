import type { AgentMode, AgentPermissionMode } from '@/lib/types';

/**
 * The composer presents one ladder instead of two controls.
 *
 * Plan used to live in a separate 「模式」control next to 「权限」, but the
 * server coerces a plan run to read-only (`agent-turn-service.ts`), so the
 * permission capsule could read "Auto" while the run was read-only. Plan is a
 * permission level, so it belongs on this ladder; Goal is an objective with a
 * lifecycle, so it moved to the + menu instead.
 *
 * The wire contract is unchanged: `permissionMode` stays `read|ask|auto|full`
 * and `agentMode` stays `default|plan|goal`.
 */
export const COMPOSER_PERMISSION_CHOICES = ['read', 'plan', 'ask', 'auto', 'full'] as const;

export type ComposerPermissionChoice = typeof COMPOSER_PERMISSION_CHOICES[number];

export function isComposerPermissionChoice(value: unknown): value is ComposerPermissionChoice {
  return COMPOSER_PERMISSION_CHOICES.includes(value as ComposerPermissionChoice);
}

export function resolveComposerAgentRequest(input: {
  choice: ComposerPermissionChoice | undefined;
  hasGoal?: boolean;
}): { permissionMode: AgentPermissionMode; agentMode: AgentMode } {
  const choice = isComposerPermissionChoice(input.choice) ? input.choice : 'ask';
  const permissionMode: AgentPermissionMode = choice === 'plan' ? 'read' : choice;
  // An active goal drives the run. Plan still pins the permission to read-only,
  // so choosing both gives a goal that only reads — the stricter reading.
  const agentMode: AgentMode = input.hasGoal ? 'goal' : choice === 'plan' ? 'plan' : 'default';
  return { permissionMode, agentMode };
}

export function toComposerPermissionChoice(stored: {
  permissionMode?: AgentPermissionMode;
  agentMode?: AgentMode;
}): ComposerPermissionChoice {
  if (stored.agentMode === 'plan') return 'plan';
  // `permissionMode` never carries 'plan' on the wire, so it maps straight over.
  return isComposerPermissionChoice(stored.permissionMode) ? stored.permissionMode : 'ask';
}
