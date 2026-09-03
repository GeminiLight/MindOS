export const CONTEXT_FEEDBACK_SIGNALS = ['helpful', 'irrelevant', 'stale', 'missing'] as const;

export type ContextFeedbackSignal = (typeof CONTEXT_FEEDBACK_SIGNALS)[number];
export type ContextFeedbackStatus = 'active' | 'retracted';

export type ContextFeedbackRevision = {
  revision: number;
  signal: ContextFeedbackSignal;
  status: ContextFeedbackStatus;
  changedAt: string;
  note?: string;
  expectedPath?: string;
};

export type ContextFeedback = {
  id: string;
  receiptId: string;
  runId?: string;
  assetId?: string;
  assetVersion?: number;
  signal: ContextFeedbackSignal;
  status: ContextFeedbackStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  note?: string;
  expectedPath?: string;
  history: ContextFeedbackRevision[];
};

export type ContextStaleReview = {
  id: string;
  assetId: string;
  assetVersion: number;
  decision: 'keep' | 'deprecate';
  status: 'pending' | 'applied';
  reviewedAt: string;
  appliedAt?: string;
  note?: string;
};

export type ContextFeedbackLedger = {
  schemaVersion: 1;
  updatedAt: string;
  feedback: ContextFeedback[];
  staleReviews: ContextStaleReview[];
};

export type ContextFeedbackProfile = {
  assetId: string;
  assetVersion: number;
  counts: { helpful: number; irrelevant: number; stale: number };
  activeCount: number;
  eligible: boolean;
  confidence: number;
  adjustment: number;
  staleReviewRecommended: boolean;
  explanation: string;
};

export type SubmitContextFeedbackInput = {
  receiptId: string;
  signal: ContextFeedbackSignal;
  assetId?: string;
  note?: string;
  expectedPath?: string;
};

export type ReviewStaleContextAssetInput = {
  assetId: string;
  decision: 'keep' | 'deprecate';
  idempotencyKey: string;
  note?: string;
};

export type ListContextFeedbackOptions = {
  receiptId?: string;
  assetId?: string;
  runId?: string;
  status?: ContextFeedbackStatus;
  limit?: number;
};

export type CapsuleEchoPromotionInput = {
  capsuleId: string;
  candidateId: string;
  kind: 'playbook' | 'practice';
  title: string;
  content: string;
  evidence: Array<
    | { source?: 'message'; messageIndex: number; role: string; quote: string }
    | { source: 'output'; quote: string }
  >;
};
