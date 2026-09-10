import path from 'path';
import { recordAttachedMethodReceipt } from '@/lib/agent/attached-method-receipt';
import { getFileContent, getMindRoot, collectAllFiles } from '@/lib/fs';
import { validateFileSize } from '@/lib/api-file-size-validation';
import { truncate } from '@/lib/agent/tools';
import {
  performActiveRecallWithReceipt,
  type ActiveRecallWithReceiptResult,
} from '@/lib/agent/active-recall';
import {
  dirnameOfMindosPath,
  expandMindosAgentAttachedFiles,
  loadMindosAgentFileContext,
  MINDOS_AGENT_ATTACHMENT_MAX_CHARS,
  type MindosAgentFileContext,
} from '@geminilight/mindos/agent/turn';
import type { MindosAgentRecalledKnowledgeItem } from '@geminilight/mindos/agent';

/**
 * Web host context loading (files, active recall, receipts). The
 * context-omission signature logic moved to core `agent/turn/context.ts` so
 * both hosts share one implementation; it is re-exported here unchanged
 * (spec-runtime-lane-contract).
 */
export {
  createMindosFileContextSignature,
  fileContextForPrompt,
  fileContextRunMetadata,
  sessionContextRunMetadata,
  shouldInjectFileContext,
  shouldInjectSessionContext,
  type ContextSignatureTarget,
} from '@geminilight/mindos/agent/turn';

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
  return (await recallMindosTurnKnowledgeWithReceipt(input)).items;
}

export async function recallMindosTurnKnowledgeWithReceipt(input: Parameters<typeof recallAutomaticKnowledgeWithReceipt>[0] & { fileContext?: MindosAgentFileContext }): Promise<Pick<ActiveRecallWithReceiptResult, 'items' | 'metadata'>> {
  const recalled = await recallAutomaticKnowledgeWithReceipt(input);
  const attached = input.fileContext ? recordAttachedMethodReceipt(input.mindRoot, input.lastUserContent, input.fileContext, input.chatSessionId) : null;
  if (!attached) return recalled;
  return { items: recalled.items, metadata: {
    ...recalled.metadata,
    retrievalReceiptIds: [...(recalled.metadata.retrievalReceiptId ? [recalled.metadata.retrievalReceiptId] : []), attached.id],
    retrievalSelectedAssetIds: [...new Set([...recalled.metadata.retrievalSelectedAssetIds, ...attached.selections.map(item => item.assetId)])],
  } };
}

async function recallAutomaticKnowledgeWithReceipt(input: {
  mindRoot: string;
  chatSessionId?: string;
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
}): Promise<Pick<ActiveRecallWithReceiptResult, 'items' | 'metadata'>> {
  const activeRecall = input.activeRecall ?? {};
  if (activeRecall.enabled === false) {
    const skipped = await performActiveRecallWithReceipt(input.mindRoot, input.lastUserContent, {
      maxTokens: activeRecall.maxTokens,
      maxFiles: activeRecall.maxFiles,
      minScore: activeRecall.minScore,
      excludePaths: [
        ...(input.currentFile ? [input.currentFile] : []),
        ...(Array.isArray(input.attachedFiles) ? input.attachedFiles : []),
      ],
      preferredPaths: input.sessionSpaces.map((space) => space.path),
    }, {
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
      trigger: 'disabled',
      skip: true,
    });
    return { items: skipped.items, metadata: skipped.metadata };
  }

  try {
    const result = await performActiveRecallWithReceipt(input.mindRoot, input.lastUserContent, {
      maxTokens: activeRecall.maxTokens,
      maxFiles: activeRecall.maxFiles,
      minScore: activeRecall.minScore,
      excludePaths: [
        ...(input.currentFile ? [input.currentFile] : []),
        ...(Array.isArray(input.attachedFiles) ? input.attachedFiles : []),
      ],
      preferredPaths: input.sessionSpaces.map((space) => space.path),
    }, {
      ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
    });
    return { items: result.items, metadata: result.metadata };
  } catch (error) {
    console.warn('[agent-turn] Active recall failed, continuing without:', error);
    return {
      items: [],
      metadata: {
        retrievalSelectedAssetIds: [],
        retrievalOutcome: 'error',
      },
    };
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
