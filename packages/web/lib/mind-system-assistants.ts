import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';
import type { MindSystemSlot, MindSystemSlotKey } from './mind-system';
import { getAssistantProfilePath, getAssistantPromptPath } from './mind-system-assistant-paths';
import { INBOX_ORGANIZER_ASSISTANT_ID, INBOX_ORGANIZER_DEFAULT_PROMPT } from './inbox-assistant';

export {
  getAssistantProfilePath,
  getAssistantPromptPath,
  isSafeAssistantId,
  MINDOS_ASSISTANT_PROMPT_ROOT,
} from './mind-system-assistant-paths';

export type AssistantScheduleMode = 'manual' | 'daily' | 'weekly';
const ASSISTANT_SCHEDULE_MODES: AssistantScheduleMode[] = ['manual', 'daily', 'weekly'];

export interface AssistantSchedule {
  mode: AssistantScheduleMode;
}

export interface MindSystemSpaceAssistant {
  id: string;
  schedule: AssistantSchedule;
  name?: string;
  desc?: string;
  promptPath?: string;
  profilePath?: string;
  promptReady?: boolean;
}

export interface MindSystemSpaceAssistantConfig {
  assistants: Array<Pick<MindSystemSpaceAssistant, 'id' | 'schedule'>>;
}

export interface MindSystemAssistantSummary {
  assistants: MindSystemSpaceAssistant[];
  draftCount: number;
  instructionReady: boolean;
}

export interface MindSystemAssistantProfile {
  name?: string;
  desc?: string;
  schedule?: AssistantSchedule;
}

export const MIND_SYSTEM_ASSISTANT_CONFIGS: Record<MindSystemSlotKey, MindSystemSpaceAssistantConfig> = {
  dao: {
    assistants: [
      {
        id: 'daily-signal',
        schedule: { mode: 'daily' },
      },
      {
        id: 'decision-synthesizer',
        schedule: { mode: 'manual' },
      },
    ],
  },
  fa: {
    assistants: [
      {
        id: 'rule-keeper',
        schedule: { mode: 'manual' },
      },
      {
        id: 'boundary-reviewer',
        schedule: { mode: 'manual' },
      },
    ],
  },
  shu: {
    assistants: [
      {
        id: 'method-organizer',
        schedule: { mode: 'manual' },
      },
      {
        id: 'checklist-builder',
        schedule: { mode: 'manual' },
      },
    ],
  },
  qi: {
    assistants: [
      {
        id: 'tool-inventory',
        schedule: { mode: 'manual' },
      },
      {
        id: 'resource-auditor',
        schedule: { mode: 'manual' },
      },
    ],
  },
};

const DEFAULT_ASSISTANT_PROMPTS: Record<string, string> = {
  [INBOX_ORGANIZER_ASSISTANT_ID]: INBOX_ORGANIZER_DEFAULT_PROMPT,
  'daily-signal': `---
assistantId: daily-signal
version: 1
---

# Daily Signal

## Role

Collect weak signals, recurring patterns, opportunities, and risks from the user's Mind System notes.

## Inputs

- Recent notes in the employed space
- Drafts and review notes
- Existing decisions, principles, and linked references

## Output

Write a concise signal brief with links back to source notes.

## Boundaries

- Do not overwrite canonical notes unless explicitly asked.
- Mark uncertainty clearly.
- Prefer short, source-aware synthesis over broad speculation.
`,
  'decision-synthesizer': `---
assistantId: decision-synthesizer
version: 1
---

# Decision Synthesizer

## Role

Turn repeated choices, tradeoffs, and unresolved tensions into durable judgments the user can reuse.

## Inputs

- Decision notes
- Strategic drafts
- Relevant prior principles and constraints

## Output

Produce a decision draft with context, recommendation, tradeoffs, and follow-up checks.

## Boundaries

- Separate observed facts from interpretation.
- Preserve alternatives when the evidence is incomplete.
- Do not promote a draft into canonical notes without user confirmation.
`,
  'rule-keeper': `---
assistantId: rule-keeper
version: 1
---

# Rule Keeper

## Role

Collect confirmed rules, boundaries, standards, and protocols from the employed space.

## Inputs

- Existing rules and commitments
- New notes that imply a durable rule
- Exceptions and conflict examples

## Output

Write clear rule candidates with do / do-not wording and source links.

## Boundaries

- Avoid turning one-off preferences into permanent rules.
- Keep the rule itself concise.
- Flag conflicts with existing rules instead of silently rewriting them.
`,
  'boundary-reviewer': `---
assistantId: boundary-reviewer
version: 1
---

# Boundary Reviewer

## Role

Review new ideas, requests, and notes against the user's existing commitments, limits, and operating boundaries.

## Inputs

- Rules and protocols in the employed space
- Proposed changes or plans
- Prior exceptions and constraints

## Output

Produce a short boundary review: aligned, risky, conflicting, or needs clarification.

## Boundaries

- Do not block work only because it is new.
- Cite the boundary that creates the concern.
- Suggest the smallest clarification or revision when possible.
`,
  'method-organizer': `---
assistantId: method-organizer
version: 1
---

# Method Organizer

## Role

Turn repeated work, debugging lessons, and execution patterns into reusable methods.

## Inputs

- Workflow notes
- Debugging records
- Repeated task transcripts
- Existing SOPs and checklists

## Output

Create a method draft with steps, preconditions, failure modes, and verification.

## Boundaries

- Keep methods practical and repeatable.
- Do not hide important caveats.
- Prefer small reusable procedures over broad manifestos.
`,
  'checklist-builder': `---
assistantId: checklist-builder
version: 1
---

# Checklist Builder

## Role

Convert loose methods and recurring review criteria into compact execution checklists.

## Inputs

- Methods and SOPs
- Known pitfalls
- Acceptance criteria and review notes

## Output

Write a checklist that can be run by a future human or agent.

## Boundaries

- Keep items objectively checkable.
- Avoid vague reminders that cannot pass or fail.
- Include edge cases only when they change behavior.
`,
  'tool-inventory': `---
assistantId: tool-inventory
version: 1
---

# Tool Inventory Curator

## Role

Keep tools, templates, assets, and reusable resources discoverable and up to date.

## Inputs

- Tool notes
- Links, credentials notes, and setup guides
- Templates and asset references

## Output

Produce tidy inventory entries with name, purpose, access path, owner, and usage constraints when known.

## Boundaries

- Do not store secrets in plain text.
- Mark stale or unverified resources.
- Prefer links to authoritative source files.
`,
  'resource-auditor': `---
assistantId: resource-auditor
version: 1
---

# Resource Auditor

## Role

Review resource notes for staleness, duplication, missing access instructions, and unclear ownership.

## Inputs

- Tool and asset inventories
- Templates and datasets
- External references and setup notes

## Output

Write an audit draft listing healthy resources, stale resources, duplicates, and follow-up actions.

## Boundaries

- Do not delete resources directly.
- Flag uncertainty instead of guessing access details.
- Keep the audit actionable and source-linked.
`,
};

export function getMindSystemAssistants(slot: Pick<MindSystemSlot, 'key'>, mindRoot?: string): MindSystemSpaceAssistant[] {
  return MIND_SYSTEM_ASSISTANT_CONFIGS[slot.key].assistants.map(assistant => {
    const profile = mindRoot ? readAssistantProfile(mindRoot, assistant.id) : null;
    return {
      ...assistant,
      ...profile,
      schedule: profile?.schedule ?? assistant.schedule,
      promptPath: getAssistantPromptPath(assistant.id),
      profilePath: getAssistantProfilePath(assistant.id),
    };
  });
}

export function getDefaultAssistantPrompt(assistantId: string): string {
  return DEFAULT_ASSISTANT_PROMPTS[assistantId] ?? `---
assistantId: ${assistantId}
version: 1
---

# ${assistantId}

## Role

Describe what this assistant should do.

## Inputs

- Relevant notes and context

## Output

Describe the expected result.

## Boundaries

- Do not overwrite source notes unless explicitly asked.
`;
}

export function getMindSystemAssistantSummary(
  mindRoot: string,
  slot: Pick<MindSystemSlot, 'key' | 'path'>,
): MindSystemAssistantSummary {
  const assistants = getMindSystemAssistants(slot, mindRoot).map(assistant => ({
    ...assistant,
    promptReady: assistantPromptFileExists(mindRoot, assistant.promptPath ?? getAssistantPromptPath(assistant.id)),
  }));
  return {
    assistants,
    draftCount: countDraftFiles(mindRoot, slot.path),
    instructionReady: instructionFileExists(mindRoot, slot.path),
  };
}

export function listMindSystemAssistantSummaries(
  mindRoot: string,
  slots: Array<Pick<MindSystemSlot, 'key' | 'path'>>,
): Partial<Record<MindSystemSlotKey, MindSystemAssistantSummary>> {
  return Object.fromEntries(
    slots.map(slot => [slot.key, getMindSystemAssistantSummary(mindRoot, slot)]),
  ) as Partial<Record<MindSystemSlotKey, MindSystemAssistantSummary>>;
}

function instructionFileExists(mindRoot: string, spacePath: string): boolean {
  try {
    const instructionPath = resolveExistingSafe(mindRoot, path.join(spacePath, 'INSTRUCTION.md'));
    return fs.statSync(instructionPath).isFile();
  } catch {
    return false;
  }
}

function assistantPromptFileExists(mindRoot: string, promptPath: string): boolean {
  try {
    const resolvedPromptPath = resolveExistingSafe(mindRoot, promptPath);
    return fs.statSync(resolvedPromptPath).isFile();
  } catch {
    return false;
  }
}

function readAssistantProfile(mindRoot: string, assistantId: string): MindSystemAssistantProfile | null {
  let profilePath: string;
  try {
    profilePath = resolveExistingSafe(mindRoot, getAssistantProfilePath(assistantId));
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as unknown;
    return sanitizeAssistantProfile(parsed);
  } catch {
    return null;
  }
}

function sanitizeAssistantProfile(value: unknown): MindSystemAssistantProfile | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    name?: unknown;
    desc?: unknown;
    schedule?: unknown;
  };
  const profile: MindSystemAssistantProfile = {};
  if (typeof record.name === 'string' && record.name.trim()) {
    profile.name = record.name.trim().slice(0, 80);
  }
  if (typeof record.desc === 'string') {
    profile.desc = record.desc.trim().slice(0, 240);
  }
  if (record.schedule && typeof record.schedule === 'object') {
    const scheduleRecord = record.schedule as { mode?: unknown };
    if (typeof scheduleRecord.mode === 'string' && ASSISTANT_SCHEDULE_MODES.includes(scheduleRecord.mode as AssistantScheduleMode)) {
      profile.schedule = { mode: scheduleRecord.mode as AssistantScheduleMode };
    }
  }
  return Object.keys(profile).length > 0 ? profile : null;
}

function countDraftFiles(mindRoot: string, spacePath: string): number {
  let draftsDir: string;
  try {
    draftsDir = resolveExistingSafe(mindRoot, path.join(spacePath, 'Drafts'));
  } catch {
    return 0;
  }

  try {
    const stat = fs.statSync(draftsDir);
    if (!stat.isDirectory()) return 0;
    return countFilesRecursive(draftsDir);
  } catch {
    return 0;
  }
}

function countFilesRecursive(dir: string): number {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFilesRecursive(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count += 1;
      }
    }
  } catch {
    return 0;
  }
  return count;
}
