import type { ContextFeedback, ContextFeedbackProfile } from './types.js';

const MIN_SIGNALS = 3;
const FULL_CONFIDENCE_SIGNALS = 8;
const MAX_ADJUSTMENT = 0.15;

export function calculateContextFeedbackProfile(
  assetId: string,
  assetVersion: number,
  feedback: readonly ContextFeedback[],
): ContextFeedbackProfile {
  const current = feedback.filter((item) => (
    item.status === 'active'
    && item.assetId === assetId
    && item.assetVersion === assetVersion
    && item.signal !== 'missing'
  ));
  const counts = {
    helpful: current.filter((item) => item.signal === 'helpful').length,
    irrelevant: current.filter((item) => item.signal === 'irrelevant').length,
    stale: current.filter((item) => item.signal === 'stale').length,
  };
  const activeCount = current.length;
  const eligible = activeCount >= MIN_SIGNALS;
  const confidence = eligible ? round(Math.min(1, activeCount / FULL_CONFIDENCE_SIGNALS)) : 0;
  const sentiment = activeCount === 0
    ? 0
    : (counts.helpful - counts.irrelevant - (counts.stale * 1.25)) / activeCount;
  const adjustment = eligible
    ? round(Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, MAX_ADJUSTMENT * sentiment * confidence)))
    : 0;
  return {
    assetId,
    assetVersion,
    counts,
    activeCount,
    eligible,
    confidence,
    adjustment,
    staleReviewRecommended: counts.stale > 0,
    explanation: eligible
      ? `${activeCount} current-version signals produced a bounded ${formatSigned(adjustment)} ranking hint.`
      : `${activeCount} current-version signals; ${MIN_SIGNALS} are required before ranking changes.`,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}
