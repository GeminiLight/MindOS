import {
  getRetrievalReceipt,
  listRetrievalReceipts,
  type RetrievalReceiptOutcome,
} from '../../retrieval/receipt.js';
import { json, type MindosServerResponse } from '../response.js';

export type RetrievalReceiptsHandlerServices = { mindRoot: string };

export async function handleRetrievalReceiptsGet(
  searchParams: URLSearchParams,
  services: RetrievalReceiptsHandlerServices,
): Promise<MindosServerResponse<unknown>> {
  const id = boundedText(searchParams.get('id'), 120);
  if (id) {
    const receipt = getRetrievalReceipt(services.mindRoot, id);
    return receipt
      ? json({ receipt }, { headers: { 'Cache-Control': 'no-store' } })
      : json({ error: 'Retrieval receipt not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const outcome = parseOutcome(searchParams.get('outcome'));
  const assetId = boundedText(searchParams.get('assetId'), 120);
  const chatSessionId = boundedText(searchParams.get('chatSessionId'), 160);
  const receipts = listRetrievalReceipts(services.mindRoot, {
    ...(outcome ? { outcome } : {}),
    ...(assetId ? { assetId } : {}),
    ...(chatSessionId ? { chatSessionId } : {}),
    limit: parseLimit(searchParams.get('limit')),
  });
  return json({
    schemaVersion: 1,
    receipts,
    summary: {
      total: receipts.length,
      selected: receipts.filter((receipt) => receipt.outcome === 'selected').length,
      empty: receipts.filter((receipt) => receipt.outcome === 'empty' || receipt.outcome === 'skipped').length,
      failed: receipts.filter((receipt) => receipt.outcome === 'timeout' || receipt.outcome === 'error').length,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function parseOutcome(value: string | null): RetrievalReceiptOutcome | undefined {
  return value === 'selected' || value === 'empty' || value === 'timeout' || value === 'error' || value === 'skipped'
    ? value
    : undefined;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : 100;
}

function boundedText(value: string | null, max: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}
