import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';
import { ensureMindSystemConfig, type MindSystemSlot } from './mind-system';
import {
  getDefaultAssistantPrompt,
  getMindSystemAssistants,
} from './mind-system-assistants';
import {
  INBOX_ORGANIZER_ASSISTANT_ID,
  INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
} from './inbox-assistant';
import {
  INSTRUCTION_BY_MIND_SYSTEM_SLOT,
  README_BY_MIND_SYSTEM_SLOT,
} from './mind-system-scaffold';

export interface MindSystemUpgradeSkippedPath {
  path: string;
  reason: 'file_conflict' | 'unsafe_path' | 'write_failed';
}

export interface MindSystemUpgradeResult {
  state: 'ready' | 'partial' | 'hidden';
  createdPaths: string[];
  existingPaths: string[];
  skippedPaths: MindSystemUpgradeSkippedPath[];
}

const CORE_BUILTIN_ASSISTANT_PROMPTS = [
  {
    assistantId: INBOX_ORGANIZER_ASSISTANT_ID,
    promptPath: INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
  },
] as const;

export function ensureDefaultMindSystemUpgrade(mindRoot: string): MindSystemUpgradeResult {
  const config = ensureMindSystemConfig(mindRoot);
  const createdPaths: string[] = [];
  const existingPaths: string[] = [];
  const skippedPaths: MindSystemUpgradeSkippedPath[] = [];

  for (const assistant of CORE_BUILTIN_ASSISTANT_PROMPTS) {
    const promptResult = ensureAssistantPromptFile(mindRoot, assistant.assistantId, assistant.promptPath);
    if (promptResult !== 'ready') {
      skippedPaths.push({
        path: assistant.promptPath,
        reason: promptResult,
      });
    }
  }

  if (!config.enabled) {
    return {
      state: skippedPaths.length > 0 ? 'partial' : 'hidden',
      createdPaths,
      existingPaths,
      skippedPaths,
    };
  }

  for (const slot of Object.values(config.slots).sort((a, b) => a.order - b.order)) {
    if (!slot.enabled) continue;
    const result = ensureSlotDirectory(mindRoot, slot);
    if (result === 'created') createdPaths.push(slot.path);
    else if (result === 'existing') existingPaths.push(slot.path);
    else skippedPaths.push({ path: slot.path, reason: result });

    if (result !== 'created' && result !== 'existing') continue;

    for (const assistant of getMindSystemAssistants(slot)) {
      const promptResult = ensureAssistantPromptFile(mindRoot, assistant.id, assistant.promptPath);
      if (promptResult !== 'ready') {
        skippedPaths.push({
          path: assistant.promptPath ?? `.mindos/assistants/${assistant.id}/prompt.md`,
          reason: promptResult,
        });
      }
    }
  }

  return {
    state: skippedPaths.length > 0 ? 'partial' : 'ready',
    createdPaths,
    existingPaths,
    skippedPaths,
  };
}

function ensureAssistantPromptFile(
  mindRoot: string,
  assistantId: string,
  promptPath: string | undefined,
): 'ready' | MindSystemUpgradeSkippedPath['reason'] {
  if (!promptPath) return 'unsafe_path';

  let resolvedPromptPath: string;
  try {
    resolvedPromptPath = resolveExistingSafe(mindRoot, promptPath);
  } catch {
    return 'unsafe_path';
  }

  try {
    if (fs.existsSync(resolvedPromptPath)) {
      return fs.statSync(resolvedPromptPath).isFile() ? 'ready' : 'file_conflict';
    }
    fs.mkdirSync(path.dirname(resolvedPromptPath), { recursive: true });
    fs.writeFileSync(resolvedPromptPath, getDefaultAssistantPrompt(assistantId), 'utf-8');
    return 'ready';
  } catch {
    return 'write_failed';
  }
}

function ensureSlotDirectory(
  mindRoot: string,
  slot: MindSystemSlot,
): 'created' | 'existing' | MindSystemUpgradeSkippedPath['reason'] {
  let slotDir: string;
  try {
    slotDir = resolveExistingSafe(mindRoot, slot.path);
  } catch {
    return 'unsafe_path';
  }

  try {
    if (fs.existsSync(slotDir)) {
      if (!fs.statSync(slotDir).isDirectory()) return 'file_conflict';
      ensureScaffoldFiles(slotDir, slot);
      return 'existing';
    }

    fs.mkdirSync(slotDir, { recursive: true });
    ensureScaffoldFiles(slotDir, slot);
    return 'created';
  } catch {
    return 'write_failed';
  }
}

function ensureScaffoldFiles(slotDir: string, slot: MindSystemSlot): void {
  const readmePath = path.join(slotDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, README_BY_MIND_SYSTEM_SLOT[slot.key], 'utf-8');
  }

  const instructionPath = path.join(slotDir, 'INSTRUCTION.md');
  if (!fs.existsSync(instructionPath)) {
    fs.writeFileSync(instructionPath, INSTRUCTION_BY_MIND_SYSTEM_SLOT[slot.key], 'utf-8');
  }

  const draftsPath = path.join(slotDir, 'Drafts');
  if (!fs.existsSync(draftsPath)) {
    fs.mkdirSync(draftsPath);
  }
}
