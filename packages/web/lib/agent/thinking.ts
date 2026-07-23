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

export type MindosAgentOptions = {
  enableThinking?: boolean;
  thinkingLevel?: MindosThinkingLevel;
  thinkingBudget?: number;
};

export function isMindosThinkingLevel(value: unknown): value is MindosThinkingLevel {
  return typeof value === 'string'
    && (MINDOS_THINKING_LEVELS as readonly string[]).includes(value);
}

export function clampMindosThinkingLevel(
  requested: MindosThinkingLevel,
  supported: readonly MindosThinkingLevel[],
): MindosThinkingLevel {
  if (supported.includes(requested)) return requested;
  const requestedIndex = MINDOS_THINKING_LEVELS.indexOf(requested);
  for (let index = requestedIndex; index < MINDOS_THINKING_LEVELS.length; index += 1) {
    const candidate = MINDOS_THINKING_LEVELS[index]!;
    if (supported.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = MINDOS_THINKING_LEVELS[index]!;
    if (supported.includes(candidate)) return candidate;
  }
  return 'off';
}
