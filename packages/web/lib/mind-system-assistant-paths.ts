export const MINDOS_ASSISTANT_PROMPT_ROOT = '.mindos/assistants';

const ASSISTANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isSafeAssistantId(assistantId: string): boolean {
  return ASSISTANT_ID_PATTERN.test(assistantId);
}

export function getAssistantPromptPath(assistantId: string): string {
  if (!isSafeAssistantId(assistantId)) {
    throw new Error(`Unsafe assistant id: ${assistantId}`);
  }
  return `${MINDOS_ASSISTANT_PROMPT_ROOT}/${assistantId}/prompt.md`;
}

export function getAssistantProfilePath(assistantId: string): string {
  if (!isSafeAssistantId(assistantId)) {
    throw new Error(`Unsafe assistant id: ${assistantId}`);
  }
  return `${MINDOS_ASSISTANT_PROMPT_ROOT}/${assistantId}/profile.json`;
}
