import path from 'path';
import { getFileContent, getMindRoot, collectAllFiles } from '@/lib/fs';
import { validateFileSize } from '@/lib/api-file-size-validation';
import { truncate } from '@/lib/agent/tools';
import { performActiveRecall } from '@/lib/agent/active-recall';
import {
  dirnameOfMindosPath,
  expandMindosAgentAttachedFiles,
  loadMindosAgentFileContext,
  MINDOS_AGENT_ATTACHMENT_MAX_CHARS,
  type MindosAgentFileContext,
} from '@geminilight/mindos/agent/turn';
import type { AgentRunRecord } from '@geminilight/mindos/agent/ledger/run-ledger';
import type { MindosAgentRecalledKnowledgeItem } from '@geminilight/mindos/agent';

export function loadAttachedFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
): MindosAgentFileContext {
  return loadMindosAgentFileContext(attachedFiles, currentFile, {
    readFile: getFileContent,
    truncate,
    maxContentChars: MINDOS_AGENT_ATTACHMENT_MAX_CHARS,
    validateFileSize: (filePath, cumulativeSize) => validateFileSize(path.join(getMindRoot(), filePath), cumulativeSize),
    warn: (message: string, error?: unknown) => console.warn(message, error instanceof Error ? error.message : error),
  });
}

/** Expand attachedFiles entries: directory paths (trailing /) become individual file paths. */
export function expandAttachedFiles(raw: string[]): string[] {
  return expandMindosAgentAttachedFiles(raw, collectAllFiles) ?? raw;
}

export function shouldInjectSessionContext(input: {
  chatSessionId?: string;
  signature: string | null;
  priorRuns: AgentRunRecord[];
}): boolean {
  if (!input.signature) return false;
  if (!input.chatSessionId) return true;
  return latestSessionContextSignature(input.priorRuns) !== input.signature;
}

export function sessionContextRunMetadata(signature: string | null, injected: boolean): Record<string, unknown> {
  return signature
    ? {
      sessionContextSignature: signature,
      sessionContextInjected: injected,
    }
    : {};
}

export function createMindosFileContextSignature(context: MindosAgentFileContext): string | null {
  const references = context.fileReferences ?? [];
  if (references.length === 0 && context.failedFiles.length === 0) return null;
  return JSON.stringify({
    files: references.map((file) => ({
      label: file.label,
      path: file.path,
      hash: file.contentHash ?? null,
      size: file.size ?? null,
    })),
    failed: [...context.failedFiles].sort(),
  });
}

export function shouldInjectFileContext(input: {
  chatSessionId?: string;
  signature: string | null;
  priorRuns: AgentRunRecord[];
}): boolean {
  if (!input.signature) return false;
  if (!input.chatSessionId) return true;
  return latestFileContextSignature(input.priorRuns) !== input.signature;
}

export function fileContextForPrompt(context: MindosAgentFileContext, injectFull: boolean): MindosAgentFileContext {
  if (injectFull) return { ...context, mode: 'full' };
  return {
    ...context,
    mode: 'reference',
    contextParts: [],
  };
}

export function fileContextRunMetadata(
  signature: string | null,
  injected: boolean,
  context: MindosAgentFileContext,
): Record<string, unknown> {
  return signature
    ? {
      fileContextSignature: signature,
      fileContextInjected: injected,
      fileContextPaths: (context.fileReferences ?? []).map((file) => file.path),
    }
    : {};
}

export async function recallMindosTurnKnowledge(input: {
  mindRoot: string;
  lastUserContent: string;
  currentFile?: string;
  attachedFiles?: string[];
  sessionSpaces: Array<{ path: string }>;
  activeRecall?: {
    enabled?: boolean;
    maxTokens?: number;
    maxFiles?: number;
    minScore?: number;
  };
}): Promise<MindosAgentRecalledKnowledgeItem[]> {
  const activeRecall = input.activeRecall ?? {};
  if (activeRecall.enabled === false || input.lastUserContent.trim().length <= 1) return [];

  try {
    return await performActiveRecall(input.mindRoot, input.lastUserContent, {
      maxTokens: activeRecall.maxTokens,
      maxFiles: activeRecall.maxFiles,
      minScore: activeRecall.minScore,
      excludePaths: [
        ...(input.currentFile ? [input.currentFile] : []),
        ...(Array.isArray(input.attachedFiles) ? input.attachedFiles : []),
      ],
      preferredPaths: input.sessionSpaces.map((space) => space.path),
    });
  } catch (error) {
    console.warn('[agent-turn] Active recall failed, continuing without:', error);
    return [];
  }
}

export function readKnowledgeFile(filePath: string): { ok: boolean; content: string; truncated: boolean; error?: string } {
  try {
    const raw = getFileContent(filePath);
    if (raw.length > 20_000) {
      return {
        ok: true,
        content: truncate(raw),
        truncated: true,
        error: undefined,
      };
    }
    return { ok: true, content: raw, truncated: false };
  } catch (err) {
    return {
      ok: false,
      content: '',
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function dirnameOf(filePath?: string): string | null {
  return dirnameOfMindosPath(filePath);
}

function latestSessionContextSignature(runs: AgentRunRecord[]): string | null {
  for (const run of runs) {
    const signature = run.metadata?.sessionContextSignature;
    if (typeof signature === 'string' && signature) return signature;
  }
  return null;
}

function latestFileContextSignature(runs: AgentRunRecord[]): string | null {
  for (const run of runs) {
    const signature = run.metadata?.fileContextSignature;
    if (typeof signature === 'string' && signature) return signature;
  }
  return null;
}
