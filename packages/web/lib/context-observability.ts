import type { ContextAsset } from '@geminilight/mindos/knowledge';
import type {
  ContextFeedback,
  ContextFeedbackProfile,
  ContextStaleReview,
} from '@geminilight/mindos/knowledge';
import type { RetrievalReceipt } from '@geminilight/mindos/retrieval';

export type ContextAssetsPayload = {
  schemaVersion: 1;
  assets: ContextAsset[];
  summary: { total: number; active: number; draft: number; deprecated: number };
};

export type RetrievalReceiptsPayload = {
  schemaVersion: 1;
  receipts: RetrievalReceipt[];
  summary: { total: number; selected: number; empty: number; failed: number };
};

export type ContextObservabilityPayload = {
  assets: ContextAssetsPayload;
  receipts: RetrievalReceiptsPayload;
  feedback: ContextFeedbackPayload;
};

export type ContextFeedbackPayload = {
  schemaVersion: 1;
  feedback: ContextFeedback[];
  profiles: ContextFeedbackProfile[];
  staleReviews: ContextStaleReview[];
  summary: { total: number; active: number; missing: number; pendingStaleReviews: number };
};

export async function fetchContextObservability(signal?: AbortSignal): Promise<ContextObservabilityPayload> {
  const [assetResponse, receiptResponse, feedbackResponse] = await Promise.all([
    fetch('/api/context-assets?limit=500', { cache: 'no-store', signal }),
    fetch('/api/retrieval-receipts?limit=500', { cache: 'no-store', signal }),
    fetch('/api/context-feedback?limit=500', { cache: 'no-store', signal }),
  ]);
  if (!assetResponse.ok || !receiptResponse.ok || !feedbackResponse.ok) {
    throw new Error('Could not load context observability data.');
  }
  const [assets, receipts, feedback] = await Promise.all([
    assetResponse.json() as Promise<ContextAssetsPayload>,
    receiptResponse.json() as Promise<RetrievalReceiptsPayload>,
    feedbackResponse.json() as Promise<ContextFeedbackPayload>,
  ]);
  if (!Array.isArray(assets.assets) || !Array.isArray(receipts.receipts) || !Array.isArray(feedback.feedback) || !Array.isArray(feedback.profiles)) {
    throw new Error('Context observability returned an invalid response.');
  }
  return { assets, receipts, feedback };
}

export async function mutateContextFeedback(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/api/context-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Context feedback could not be saved.');
  return payload;
}

export function contextAssetViewHref(path: string): string {
  const segments = path.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  return `/view/${segments.map(encodeURIComponent).join('/')}`;
}
