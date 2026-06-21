import { getAssistantMarkdownPath } from './mind-system-assistant-paths';
import { buildAssistantRunPrompt } from './assistant-runner';

export const DREAMING_ASSISTANT_ID = 'dreaming';
export const DREAMING_ASSISTANT_NAME = 'Dreaming';
export const DREAMING_ASSISTANT_PROMPT_PATH = getAssistantMarkdownPath(DREAMING_ASSISTANT_ID);

export const DREAMING_ASSISTANT_DEFAULT_PROMPT = `---
name: Dreaming
description: Review knowledge-base health and write review-first Dreaming artifacts.
version: 1
mode: subagent
runtime: mindos
model: default
permissionMode: ask
hidden: true
color: teal
steps: 16
---

# Dreaming

## Role

Review the local knowledge base for maintenance signals and turn them into review-first Dreaming proposals.

## Inputs

- Markdown and CSV notes in the selected Mind space
- Link, stale-file, orphan-file, and empty-file signals from the local lint pass
- Existing Dreaming artifacts under .mindos/dreaming when present

## Output

Write Dreaming run artifacts under .mindos/dreaming: a run JSON file, latest.json, pending.json, and a Markdown report.

## Boundaries

- Do not mutate user-authored notes directly.
- Treat every proposal as requiring user review.
- Call the local \`dreaming\` tool for the actual maintenance pass.
- After the tool returns, summarize the run and point the user to the generated review artifacts.
`;

export function buildDreamingAssistantRunPrompt({
  assistantPrompt,
  space,
  dryRun,
}: {
  assistantPrompt?: string;
  space?: string;
  dryRun?: boolean;
} = {}): string {
  return buildAssistantRunPrompt({
    ...(assistantPrompt?.trim() ? { assistantPrompt: assistantPrompt.trim() } : {}),
    runTitle: 'Current Dreaming Run',
    intro: 'Use the assistant instructions above as the operating prompt for this run.',
    itemsLabel: 'Dreaming scope',
    items: [
      `space: ${space ?? 'all'}`,
      `writeArtifacts: ${dryRun ? 'false' : 'true'}`,
    ],
    rules: [
      `First call the local \`dreaming\` tool exactly once with ${space ? `space "${space}"` : 'no space filter'} and dryRun ${dryRun ? 'true' : 'false'}.`,
      'Do not edit knowledge-base notes directly during this run.',
      'After the tool returns, report the health score, proposal count, and artifact paths from the tool output.',
    ],
  });
}
