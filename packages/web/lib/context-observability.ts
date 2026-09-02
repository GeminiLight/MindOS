import type { ContextAsset } from '@geminilight/mindos/knowledge';
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
};

export async function fetchContextObservability(signal?: AbortSignal): Promise<ContextObservabilityPayload> {
  const [assetResponse, receiptResponse] = await Promise.all([
    fetch('/api/context-assets?limit=500', { cache: 'no-store', signal }),
    fetch('/api/retrieval-receipts?limit=500', { cache: 'no-store', signal }),
  ]);
  if (!assetResponse.ok || !receiptResponse.ok) {
    throw new Error('Could not load context observability data.');
  }
  const [assets, receipts] = await Promise.all([
    assetResponse.json() as Promise<ContextAssetsPayload>,
    receiptResponse.json() as Promise<RetrievalReceiptsPayload>,
  ]);
  if (!Array.isArray(assets.assets) || !Array.isArray(receipts.receipts)) {
    throw new Error('Context observability returned an invalid response.');
  }
  return { assets, receipts };
}

export function contextAssetViewHref(path: string): string {
  const segments = path.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  return `/view/${segments.map(encodeURIComponent).join('/')}`;
}
