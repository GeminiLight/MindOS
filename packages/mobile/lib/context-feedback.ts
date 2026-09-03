export type MobileContextFeedbackSignal = 'helpful' | 'irrelevant' | 'stale' | 'missing';

export type MobileRetrievalSelection = {
  assetId: string;
  path: string;
  score: number;
  reason: string;
};

export type MobileRetrievalReceipt = {
  id: string;
  queryPreview: string;
  outcome: string;
  startedAt: string;
  selections: MobileRetrievalSelection[];
};

export type MobileContextFeedbackTarget = {
  receiptId: string;
  signal: MobileContextFeedbackSignal;
  assetId?: string;
  assetPath?: string;
};

export type MobileContextFeedback = {
  id: string;
  receiptId: string;
  assetId?: string;
  signal: MobileContextFeedbackSignal;
  status: 'active' | 'retracted';
};

export function normalizeMobileRetrievalReceipts(value: unknown): MobileRetrievalReceipt[] {
  if (!isRecord(value) || !Array.isArray(value.receipts)) return [];
  return value.receipts
    .map(normalizeReceipt)
    .filter((item): item is MobileRetrievalReceipt => item !== null)
    .slice(0, 20);
}

export function buildMobileContextFeedbackTargets(receipt: MobileRetrievalReceipt): MobileContextFeedbackTarget[] {
  const targets = receipt.selections.flatMap((selection) => ([
    { receiptId: receipt.id, assetId: selection.assetId, assetPath: selection.path, signal: 'helpful' as const },
    { receiptId: receipt.id, assetId: selection.assetId, assetPath: selection.path, signal: 'irrelevant' as const },
    { receiptId: receipt.id, assetId: selection.assetId, assetPath: selection.path, signal: 'stale' as const },
  ]));
  return [...targets, { receiptId: receipt.id, signal: 'missing' }];
}

export function normalizeMobileContextFeedback(value: unknown): MobileContextFeedback[] {
  if (!isRecord(value) || !Array.isArray(value.feedback)) return [];
  return value.feedback.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.receiptId !== 'string') return [];
    const signal: MobileContextFeedbackSignal | null = item.signal === 'helpful' || item.signal === 'irrelevant' || item.signal === 'stale' || item.signal === 'missing'
      ? item.signal
      : null;
    if (!signal) return [];
    if (signal !== 'missing' && typeof item.assetId !== 'string') return [];
    return [{
      id: item.id.slice(0, 200),
      receiptId: item.receiptId.slice(0, 200),
      ...(typeof item.assetId === 'string' ? { assetId: item.assetId.slice(0, 200) } : {}),
      signal,
      status: item.status === 'retracted' ? 'retracted' as const : 'active' as const,
    }];
  }).slice(0, 500);
}

function normalizeReceipt(value: unknown): MobileRetrievalReceipt | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
  const seen = new Set<string>();
  const selections = (Array.isArray(value.selections) ? value.selections : [])
    .map(normalizeSelection)
    .filter((item): item is MobileRetrievalSelection => {
      if (!item || seen.has(item.assetId)) return false;
      seen.add(item.assetId);
      return true;
    })
    .slice(0, 20);
  return {
    id: value.id.slice(0, 200),
    queryPreview: typeof value.queryPreview === 'string' ? value.queryPreview.slice(0, 500) : '',
    outcome: typeof value.outcome === 'string' ? value.outcome.slice(0, 40) : 'unknown',
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    selections,
  };
}

function normalizeSelection(value: unknown): MobileRetrievalSelection | null {
  if (!isRecord(value) || typeof value.assetId !== 'string' || !value.assetId.trim() || typeof value.path !== 'string' || !value.path.trim()) return null;
  return {
    assetId: value.assetId.slice(0, 200),
    path: value.path.slice(0, 500),
    score: typeof value.score === 'number' && Number.isFinite(value.score) ? value.score : 0,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
