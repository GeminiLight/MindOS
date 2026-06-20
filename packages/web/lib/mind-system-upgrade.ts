import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from '@/lib/core/security';
import { defaultMindSystemSlots, type MindSystemSlot } from './mind-system';
import {
  getBuiltinAssistantMarkdownFiles,
  getDefaultAssistantPrompt,
  getLegacyAssistantPromptPath,
} from './mind-system-assistants';
import {
  getMindSystemScaffoldDescriptor,
  INSTRUCTION_BY_MIND_SYSTEM_SLOT,
  README_BY_MIND_SYSTEM_SLOT,
} from './mind-system-scaffold';

export interface MindSystemUpgradeSkippedPath {
  path: string;
  reason: 'file_conflict' | 'unsafe_path' | 'write_failed';
}

export interface MindSystemUpgradeResult {
  state: 'ready' | 'partial';
  createdPaths: string[];
  existingPaths: string[];
  updatedPaths: string[];
  skippedPaths: MindSystemUpgradeSkippedPath[];
}

export function ensureDefaultMindSystemUpgrade(mindRoot: string): MindSystemUpgradeResult {
  const createdPaths: string[] = [];
  const existingPaths: string[] = [];
  const updatedPaths: string[] = [];
  const skippedPaths: MindSystemUpgradeSkippedPath[] = [];

  for (const assistant of getBuiltinAssistantMarkdownFiles()) {
    const promptResult = ensureAssistantMarkdownFile(mindRoot, assistant.assistantId, assistant.path);
    if (promptResult !== 'ready') {
      skippedPaths.push({
        path: assistant.path,
        reason: promptResult,
      });
    }
  }

  for (const slot of defaultMindSystemSlots().sort((a, b) => a.order - b.order)) {
    const result = ensureSlotDirectory(mindRoot, slot);
    if (result.status === 'skipped') {
      skippedPaths.push({ path: slot.path, reason: result.reason });
      continue;
    }
    if (result.status === 'created') createdPaths.push(slot.path);
    else existingPaths.push(slot.path);
    updatedPaths.push(...result.updatedPaths);
  }

  return {
    state: skippedPaths.length > 0 ? 'partial' : 'ready',
    createdPaths,
    existingPaths,
    updatedPaths,
    skippedPaths,
  };
}

function ensureAssistantMarkdownFile(
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
    fs.writeFileSync(resolvedPromptPath, getAssistantMarkdownContent(mindRoot, assistantId), 'utf-8');
    return 'ready';
  } catch {
    return 'write_failed';
  }
}

function getAssistantMarkdownContent(mindRoot: string, assistantId: string): string {
  const defaultMarkdown = getDefaultAssistantPrompt(assistantId);
  const legacyPrompt = readLegacyAssistantPrompt(mindRoot, assistantId);
  if (!legacyPrompt) return defaultMarkdown;
  return replaceAssistantMarkdownBody(defaultMarkdown, stripLeadingFrontmatter(legacyPrompt));
}

function readLegacyAssistantPrompt(mindRoot: string, assistantId: string): string | null {
  const legacyPath = getLegacyAssistantPromptPath(assistantId);
  let resolvedLegacyPath: string;
  try {
    resolvedLegacyPath = resolveExistingSafe(mindRoot, legacyPath);
  } catch {
    return null;
  }
  try {
    if (!fs.existsSync(resolvedLegacyPath) || !fs.statSync(resolvedLegacyPath).isFile()) return null;
    return fs.readFileSync(resolvedLegacyPath, 'utf-8');
  } catch {
    return null;
  }
}

function replaceAssistantMarkdownBody(defaultMarkdown: string, body: string): string {
  const normalizedBody = body.trim();
  if (!normalizedBody) return defaultMarkdown;
  const normalized = defaultMarkdown.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (!match) return normalizedBody.endsWith('\n') ? normalizedBody : `${normalizedBody}\n`;
  return `${match[0].replace(/\n*$/, '\n\n')}${normalizedBody}\n`;
}

function stripLeadingFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return content.trim();
  const match = normalized.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (!match) return content.trim();
  return normalized.slice(match[0].length).replace(/^\n+/, '').trim();
}

type SlotDirectoryEnsureResult =
  | { status: 'created' | 'existing'; updatedPaths: string[] }
  | { status: 'skipped'; reason: MindSystemUpgradeSkippedPath['reason'] };

function ensureSlotDirectory(mindRoot: string, slot: MindSystemSlot): SlotDirectoryEnsureResult {
  let slotDir: string;
  try {
    slotDir = resolveExistingSafe(mindRoot, slot.path);
  } catch {
    return { status: 'skipped', reason: 'unsafe_path' };
  }

  try {
    if (fs.existsSync(slotDir)) {
      if (!fs.statSync(slotDir).isDirectory()) return { status: 'skipped', reason: 'file_conflict' };
      return { status: 'existing', updatedPaths: ensureScaffoldFiles(slotDir, slot) };
    }

    fs.mkdirSync(slotDir, { recursive: true });
    return { status: 'created', updatedPaths: ensureScaffoldFiles(slotDir, slot) };
  } catch {
    return { status: 'skipped', reason: 'write_failed' };
  }
}

function ensureScaffoldFiles(slotDir: string, slot: MindSystemSlot): string[] {
  const updatedPaths: string[] = [];
  if (ensureScaffoldFile(path.join(slotDir, 'README.md'), `${slot.path}/README.md`, README_BY_MIND_SYSTEM_SLOT[slot.key])) {
    updatedPaths.push(`${slot.path}/README.md`);
  }

  if (ensureScaffoldFile(path.join(slotDir, 'INSTRUCTION.md'), `${slot.path}/INSTRUCTION.md`, INSTRUCTION_BY_MIND_SYSTEM_SLOT[slot.key])) {
    updatedPaths.push(`${slot.path}/INSTRUCTION.md`);
  }

  const draftsPath = path.join(slotDir, 'Drafts');
  if (!fs.existsSync(draftsPath)) {
    fs.mkdirSync(draftsPath);
  }
  return updatedPaths;
}

function ensureScaffoldFile(absPath: string, relativePath: string, currentContent: string): boolean {
  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, currentContent, 'utf-8');
    return false;
  }
  if (!fs.statSync(absPath).isFile()) return false;

  const existingContent = fs.readFileSync(absPath, 'utf-8');
  if (existingContent === currentContent) return false;

  const descriptor = getMindSystemScaffoldDescriptor(relativePath);
  if (!descriptor?.knownDefaultContents.includes(existingContent)) return false;

  fs.writeFileSync(absPath, descriptor.currentContent, 'utf-8');
  return true;
}
