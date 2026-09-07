import type { LearningLoop, LearningMethod } from '@geminilight/mindos/knowledge';
import type { Messages } from '@/lib/i18n';

export const LEARNING_UPDATED = 'mindos:echo-learning-updated';
export type LearningCopy = Messages['echoLearning'];
export class LearningRequestError extends Error {
  constructor(public code: keyof LearningCopy['errors']) { super(code); }
}
export async function learningRequest(body?: Record<string, unknown>, method = 'GET', signal?: AbortSignal): Promise<{ loop?: LearningLoop; loops?: LearningLoop[] }> {
  const response = await fetch('/api/echo/learning', {
    method, cache: 'no-store',
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok) throw new LearningRequestError(
    ['invalid', 'not-found', 'conflict', 'storage'].includes(data.code) ? data.code : 'storage',
  );
  return data;
}
export function learningErrorMessage(error: unknown, copy: LearningCopy): string {
  return copy.errors[error instanceof LearningRequestError ? error.code : 'storage'];
}
export function announceLearningUpdate(loop: LearningLoop, select = false) {
  window.dispatchEvent(new CustomEvent(LEARNING_UPDATED, { detail: { loop, select } }));
}
export function reviewIsDue(loop: LearningLoop, now = new Date()): boolean {
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return !loop.archived && loop.stage === 'practicing' && (loop.attempts.at(-1)?.plan.reviewOn ?? '') <= today;
}

export function learningMethodStatus(method: LearningMethod | undefined, copy: LearningCopy): string {
  if (!method) return copy.joint.title;
  if (!method.review) return copy.joint.pending;
  if (method.review.decision === 'rejected') return copy.joint.rejected;
  if (method.availability === 'deprecated') return copy.joint.paused;
  if (method.availability === 'unavailable') return copy.joint.unavailable;
  return copy.joint.approved;
}
export function learningRecordStatus(loop: LearningLoop, copy: LearningCopy): string {
  if (reviewIsDue(loop)) return copy.due;
  if (loop.directMethod && !loop.reflection) return learningMethodStatus(loop.directMethod.revisions?.at(-1) ?? loop.directMethod, copy);
  return copy.stages[loop.stage];
}
