export const MINDOS_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type MindosThinkingLevel = typeof MINDOS_THINKING_LEVELS[number];

export type MindosThinkingConfig = {
  thinkingLevel?: MindosThinkingLevel;
  /** @deprecated Kept for config/request compatibility. Prefer thinkingLevel. */
  enableThinking?: boolean;
  /** @deprecated Provider-specific legacy token budget. */
  thinkingBudget?: number;
};

export function isMindosThinkingLevel(value: unknown): value is MindosThinkingLevel {
  return typeof value === 'string'
    && (MINDOS_THINKING_LEVELS as readonly string[]).includes(value);
}

export function resolveRequestedMindosThinkingLevel(
  config: MindosThinkingConfig | undefined,
): MindosThinkingLevel {
  if (config?.thinkingLevel) return config.thinkingLevel;
  if (config?.enableThinking === true) return 'medium';
  return 'off';
}

export function resolveMindosThinkingLevel(
  config: MindosThinkingConfig | undefined,
  model: unknown,
  clampThinkingLevel: (model: unknown, level: MindosThinkingLevel) => MindosThinkingLevel,
): MindosThinkingLevel {
  return clampThinkingLevel(model, resolveRequestedMindosThinkingLevel(config));
}
