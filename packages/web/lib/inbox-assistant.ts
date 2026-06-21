import { getAssistantMarkdownPath } from './mind-system-assistant-paths';
import { buildAssistantRunPrompt, loadAssistantMarkdownPrompt } from './assistant-runner';

export const INBOX_ORGANIZER_ASSISTANT_ID = 'inbox-organizer';
export const INBOX_ORGANIZER_ASSISTANT_NAME = 'Inbox Organizer';
export const INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH = getAssistantMarkdownPath(INBOX_ORGANIZER_ASSISTANT_ID);

export const INBOX_ORGANIZER_DEFAULT_PROMPT = `---
name: Inbox Organizer
description: Review staged Inbox material and turn it into safe, source-preserving Mind updates.
version: 1
mode: subagent
runtime: mindos
model: default
permissionMode: ask
hidden: true
color: amber
steps: 12
---

# Inbox Organizer

## Role

Review staged Inbox material and turn it into safe, source-preserving Mind updates.

## Inputs

- Captures saved under Inbox/
- Existing knowledge-base notes when relevant
- User language, source metadata, and prior organize history when available

## Output

Create or update concise Markdown notes with clear titles, preserved sources, and reviewable structure.

## Boundaries

- Do not delete, rename, or overwrite Inbox source files directly.
- Preserve the original language and important source details.
- If the destination is uncertain, create a clearly named review note instead of forcing a merge.
- Avoid broad rewrites; make the smallest useful knowledge-base change.
`;

export function normalizeInboxOrganizerFilePath(nameOrPath: string): string {
  const trimmed = nameOrPath.trim().replace(/^\/+/, '');
  if (!trimmed) return 'Inbox/(unnamed)';
  return trimmed.startsWith('Inbox/') ? trimmed : `Inbox/${trimmed}`;
}

export function buildInboxOrganizerRunPrompt(
  fileNames: string[],
  assistantPrompt?: string,
): string {
  const fileList = fileNames
    .map(normalizeInboxOrganizerFilePath)
    .filter(Boolean);

  return buildAssistantRunPrompt({
    ...(assistantPrompt?.trim() ? { assistantPrompt: assistantPrompt.trim() } : {}),
    runTitle: 'Current Inbox Review Run',
    intro: 'Use the assistant instructions above as the operating prompt for this run.',
    itemsLabel: 'Files in this review run',
    items: fileList.length > 0 ? fileList : ['Inbox/(no files selected)'],
    rules: [
      'Treat the attached file content as the source of truth.',
      'Propose or write only clear, source-preserving changes.',
      'Do not delete, rename, or overwrite Inbox source files directly. MindOS archives source files only after a fully successful run.',
    ],
  });
}

export async function loadInboxOrganizerPrompt(fetcher?: typeof fetch): Promise<string> {
  return loadAssistantMarkdownPrompt({
    assistantId: INBOX_ORGANIZER_ASSISTANT_ID,
    fallbackPrompt: INBOX_ORGANIZER_DEFAULT_PROMPT,
    fetcher,
  });
}
