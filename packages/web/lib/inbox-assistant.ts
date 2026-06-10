import { getAssistantPromptPath } from './mind-system-assistant-paths';

export const INBOX_ORGANIZER_ASSISTANT_ID = 'inbox-organizer';
export const INBOX_ORGANIZER_ASSISTANT_NAME = 'Inbox Organizer';
export const INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH = getAssistantPromptPath(INBOX_ORGANIZER_ASSISTANT_ID);

export const INBOX_ORGANIZER_DEFAULT_PROMPT = `---
assistantId: inbox-organizer
version: 1
surface: inbox
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
  assistantPrompt = INBOX_ORGANIZER_DEFAULT_PROMPT,
): string {
  const basePrompt = assistantPrompt.trim() || INBOX_ORGANIZER_DEFAULT_PROMPT.trim();
  const fileList = fileNames
    .map(normalizeInboxOrganizerFilePath)
    .map(filePath => `- ${filePath}`)
    .join('\n') || '- Inbox/(no files selected)';

  return `${basePrompt}

---

# Current Inbox Review Run

Use the assistant instructions above as the operating prompt for this run.

Files in this review run:
${fileList}

Run rules:

- Treat the attached file content as the source of truth.
- Propose or write only clear, source-preserving changes.
- Do not delete, rename, or overwrite Inbox source files directly. MindOS archives source files only after a fully successful run.
`;
}

export async function loadInboxOrganizerPrompt(fetcher?: typeof fetch): Promise<string> {
  try {
    const read = fetcher ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (!read) return INBOX_ORGANIZER_DEFAULT_PROMPT;
    const res = await read(`/api/file?path=${encodeURIComponent(INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH)}&op=read_file`);
    if (!res.ok) return INBOX_ORGANIZER_DEFAULT_PROMPT;
    const data = await res.json() as { content?: unknown };
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    return content.length > 0 ? content : INBOX_ORGANIZER_DEFAULT_PROMPT;
  } catch {
    return INBOX_ORGANIZER_DEFAULT_PROMPT;
  }
}
