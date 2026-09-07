import { createHash, randomUUID } from 'node:crypto';
import { readContextAssetRegistry } from '@geminilight/mindos/knowledge';
import { writeRetrievalReceipt, type RetrievalReceiptSelection } from '@geminilight/mindos/retrieval';
import type { MindosAgentFileContext } from '@geminilight/mindos/agent/turn';
import { estimateStringTokens } from './context';

/** Evidence of prepared context only; a linked run and its output establish later stages. */
export function recordAttachedMethodReceipt(root: string, query: string, context: MindosAgentFileContext, chatSessionId?: string) {
  if (context.mode !== 'full' || !context.contextParts.length) return null;
  try {
    const assets = readContextAssetRegistry(root).assets;
    const selections: RetrievalReceiptSelection[] = [];
    const seen = new Set<string>();
    for (const reference of context.fileReferences ?? []) {
      if (seen.has(reference.path) || context.failedFiles.includes(reference.path)) continue;
      seen.add(reference.path);
      const label = reference.label === 'attached' ? 'Attached' : 'Current';
      const prefix = `### ${label} file from the MindOS knowledge base: ${reference.path}\n\n`;
      const part = context.contextParts.find((item) => item.startsWith(prefix));
      if (!part) continue;
      // Hash the actual prepared body, not a second disk read or the weak cache signature.
      // A truncated body cannot match a full approved method and is not attributed to it.
      const body = part.slice(prefix.length);
      const hash = createHash('sha256').update(body).digest('hex');
      const asset = assets.find((item) => item.path === reference.path && item.source.kind === 'echo-card' && item.status === 'active' && item.contentHash === hash);
      if (!asset) continue;
      selections.push({ assetId: asset.id, path: asset.path, score: 1, estimatedTokens: estimateStringTokens(body), truncated: false,
        reason: 'Explicitly attached approved method; context prepared, behavior not yet evaluated.',
        contentHash: hash, sourceContentHash: hash, assetVersion: asset.version });
    }
    if (!selections.length) return null;
    const now = new Date().toISOString();
    const tokens = selections.reduce((sum, item) => sum + item.estimatedTokens, 0);
    return writeRetrievalReceipt(root, {
      id: 'method-context-' + randomUUID(), query, strategy: 'explicit-approved-method-context-v1', outcome: 'selected', startedAt: now, completedAt: now,
      budget: { maxFiles: selections.length, maxTokens: tokens, minScore: 0, timeoutMs: 0 },
      scope: { preferredPaths: selections.map(item => item.path), excludePaths: [] }, candidates: selections.map(({ assetId, path, score, reason }) => ({ assetId, path, score, reason, selected: true })), selections,
      totals: { candidateCount: selections.length, selectedCount: selections.length, usedTokens: tokens },
      metadata: { ...(chatSessionId ? { chatSessionId } : {}), trigger: 'explicit-method-context' },
    });
  } catch { return null; } // Missing observability must not destroy the user's prepared task.
}
