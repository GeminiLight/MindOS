import { getAssistantMarkdownPath } from './mind-system-assistant-paths';
import { INBOX_ORGANIZER_ASSISTANT_ID, INBOX_ORGANIZER_DEFAULT_PROMPT } from './inbox-assistant';
import { DREAMING_ASSISTANT_DEFAULT_PROMPT, DREAMING_ASSISTANT_ID } from './dreaming-assistant';
import {
  ECHO_ASSISTANT_DEFAULT_PROMPTS,
  getBuiltinEchoAssistantMarkdownFiles,
} from './echo-assistants';

export {
  getAssistantMarkdownPath,
  getAssistantProfilePath,
  getAssistantPromptPath,
  getLegacyAssistantProfilePath,
  getLegacyAssistantPromptPath,
  isSafeAssistantId,
  MINDOS_ASSISTANT_PROMPT_ROOT,
  MINDOS_ASSISTANT_ROOT,
} from './mind-system-assistant-paths';

export const MINDOS_CONTEXT_ASSISTANT_IDS = [] as const;

export type MindosContextAssistantId = never;

export interface MindosContextAssistantTemplate {
  assistantId: MindosContextAssistantId;
  promptPath: string;
}

const DEFAULT_ASSISTANT_PROMPTS: Record<string, string> = {
  [INBOX_ORGANIZER_ASSISTANT_ID]: INBOX_ORGANIZER_DEFAULT_PROMPT,
  [DREAMING_ASSISTANT_ID]: DREAMING_ASSISTANT_DEFAULT_PROMPT,
  ...ECHO_ASSISTANT_DEFAULT_PROMPTS,
};

const REMOVED_BUILTIN_ASSISTANT_IDS = new Set(['echo-practice']);

export function getMindosContextAssistants(): MindosContextAssistantTemplate[] {
  return [];
}

export function getDefaultAssistantPrompt(assistantId: string): string {
  if (REMOVED_BUILTIN_ASSISTANT_IDS.has(assistantId)) {
    throw new Error(`Built-in assistant "${assistantId}" has been removed.`);
  }
  return DEFAULT_ASSISTANT_PROMPTS[assistantId] ?? `---
name: ${titleizeAssistantId(assistantId)}
description: Describe what this assistant should help with.
version: 1
mode: subagent
runtime: mindos
model: default
permissionMode: ask
hidden: false
color: amber
steps: 12
---

# ${titleizeAssistantId(assistantId)}

## Role

Describe what this assistant should help with.

## Inputs

- Add the files, notes, or context this assistant should inspect.

## Output

Return a concise, reviewable result.

## Boundaries

- Prefer proposing changes before applying them.
- Do not read secrets or credentials.
`;
}

export function getBuiltinAssistantMarkdownFiles(): Array<{ assistantId: string; path: string; content: string }> {
  return [
    {
      assistantId: INBOX_ORGANIZER_ASSISTANT_ID,
      path: getAssistantMarkdownPath(INBOX_ORGANIZER_ASSISTANT_ID),
      content: INBOX_ORGANIZER_DEFAULT_PROMPT,
    },
    {
      assistantId: DREAMING_ASSISTANT_ID,
      path: getAssistantMarkdownPath(DREAMING_ASSISTANT_ID),
      content: DREAMING_ASSISTANT_DEFAULT_PROMPT,
    },
    ...getBuiltinEchoAssistantMarkdownFiles(),
  ];
}

function titleizeAssistantId(assistantId: string): string {
  return assistantId
    .split('-')
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || assistantId;
}
