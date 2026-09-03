import {
  buildEchoPromotionCandidateFromCapsule,
  getContextFeedbackProfile,
  listContextFeedback,
  listContextStaleReviews,
  retractContextFeedback,
  reviewStaleContextAsset,
  submitContextFeedback,
  type ContextFeedbackSignal,
  type ContextFeedbackStatus,
} from '../../knowledge/context-feedback/index.js';
import { listContextAssets, reviewEchoPromotionCandidate } from '../../knowledge/context-assets/index.js';
import { json, type MindosServerResponse } from '../response.js';

export type ContextFeedbackHandlerServices = { mindRoot: string };

export async function handleContextFeedbackGet(
  searchParams: URLSearchParams,
  services: ContextFeedbackHandlerServices,
): Promise<MindosServerResponse<unknown>> {
  try {
    const receiptId = boundedText(searchParams.get('receiptId'), 200);
    const assetId = boundedText(searchParams.get('assetId'), 200);
    const runId = boundedText(searchParams.get('runId'), 200);
    const status = parseStatus(searchParams.get('status'));
    const feedback = listContextFeedback(services.mindRoot, {
      ...(receiptId ? { receiptId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(runId ? { runId } : {}),
      ...(status ? { status } : {}),
      limit: parseLimit(searchParams.get('limit')),
    });
    const profileIds = assetId
      ? [assetId]
      : [...new Set([
          ...listContextAssets(services.mindRoot, { limit: 1_000 }).map((asset) => asset.id),
          ...feedback.flatMap((item) => item.assetId ? [item.assetId] : []),
        ])];
    const staleReviews = listContextStaleReviews(services.mindRoot, { limit: 200 });
    return json({
      schemaVersion: 1,
      feedback,
      profiles: profileIds.map((id) => getContextFeedbackProfile(services.mindRoot, id)),
      staleReviews,
      summary: {
        total: feedback.length,
        active: feedback.filter((item) => item.status === 'active').length,
        missing: feedback.filter((item) => item.status === 'active' && item.signal === 'missing').length,
        pendingStaleReviews: staleReviews.filter((item) => item.status === 'pending').length,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ error: messageOf(error, 'Failed to inspect context feedback.') }, { status: 500 });
  }
}

export async function handleContextFeedbackPost(
  body: unknown,
  services: ContextFeedbackHandlerServices,
): Promise<MindosServerResponse<unknown>> {
  if (!isRecord(body)) return json({ error: 'Context feedback action body must be an object.' }, { status: 400 });
  try {
    if (body.action === 'submit') {
      const signal = parseSignal(body.signal);
      if (!signal) return json({ error: 'signal must be helpful, irrelevant, stale, or missing.' }, { status: 400 });
      const feedback = submitContextFeedback(services.mindRoot, {
        receiptId: stringValue(body.receiptId),
        signal,
        ...(typeof body.assetId === 'string' ? { assetId: body.assetId } : {}),
        ...(typeof body.note === 'string' ? { note: body.note } : {}),
        ...(typeof body.expectedPath === 'string' ? { expectedPath: body.expectedPath } : {}),
      });
      return json({ ok: true, feedback }, { status: 201 });
    }
    if (body.action === 'retract') {
      return json({ ok: true, feedback: retractContextFeedback(services.mindRoot, stringValue(body.feedbackId)) });
    }
    if (body.action === 'review-stale') {
      if (body.decision !== 'keep' && body.decision !== 'deprecate') {
        return json({ error: 'decision must be keep or deprecate.' }, { status: 400 });
      }
      const review = reviewStaleContextAsset(services.mindRoot, {
        assetId: stringValue(body.assetId),
        decision: body.decision,
        idempotencyKey: stringValue(body.idempotencyKey),
        ...(typeof body.note === 'string' ? { note: body.note } : {}),
      });
      return json({ ok: true, review });
    }
    if (body.action === 'review-capsule-promotion') {
      if (body.decision !== 'approve' && body.decision !== 'reject') {
        return json({ error: 'decision must be approve or reject.' }, { status: 400 });
      }
      const candidate = buildEchoPromotionCandidateFromCapsule(services.mindRoot, {
        capsuleId: stringValue(body.capsuleId),
        candidateId: stringValue(body.candidateId),
        kind: body.kind === 'practice' ? 'practice' : 'playbook',
        title: stringValue(body.title),
        content: stringValue(body.content),
        evidence: Array.isArray(body.evidence)
          ? body.evidence as Parameters<typeof buildEchoPromotionCandidateFromCapsule>[1]['evidence']
          : [],
      });
      const review = reviewEchoPromotionCandidate(services.mindRoot, {
        decision: body.decision,
        candidate,
        ...(typeof body.note === 'string' ? { note: body.note } : {}),
      });
      return json({ ok: true, candidate, review });
    }
    return json({ error: 'action must be submit, retract, review-stale, or review-capsule-promotion.' }, { status: 400 });
  } catch (error) {
    const message = messageOf(error, 'Context feedback operation failed.');
    const status = /not found/i.test(message) ? 404 : /invalid|required|must|did not select|not grounded/i.test(message) ? 400 : /already|no longer matches|conflict|corrupt|busy/i.test(message) ? 409 : 500;
    return json({ error: message }, { status });
  }
}

function parseSignal(value: unknown): ContextFeedbackSignal | undefined {
  return value === 'helpful' || value === 'irrelevant' || value === 'stale' || value === 'missing' ? value : undefined;
}

function parseStatus(value: string | null): ContextFeedbackStatus | undefined {
  return value === 'active' || value === 'retracted' ? value : undefined;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : 500;
}

function boundedText(value: string | null, max: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
