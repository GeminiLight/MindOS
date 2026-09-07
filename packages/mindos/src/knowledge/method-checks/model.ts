import { createHash } from 'node:crypto';
import { z } from 'zod';
import { learningIdSchema } from '../learning/model.js';
const short = z.string().trim().min(1).max(1600);
const text = z.string().trim().min(1).max(4000);
const version = z.number().int().positive();
export const checkId = z.string().regex(/^methodcheck-[a-f0-9]{24}$/);
export const caseKind = z.enum(['use', 'exception']);
export const createCheckSchema = z
  .object({
    learningId: learningIdSchema,
    version,
    attemptIndex: z.number().int().min(-1).max(99),
    revisionIndex: z.number().int().min(0).max(99),
    locale: z.enum(['en', 'zh']),
    useTask: text,
    useExpected: short,
    exceptionTask: text,
    exceptionExpected: short,
  })
  .refine((input) => input.useTask !== input.exceptionTask);
export const handoffIdSchema = z.string().regex(/^handoff-[a-f0-9]{24}$/);
export const handoffTargetSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(['mindos', 'codex', 'claude', 'acp']),
  name: z.string().trim().min(1).max(120),
});
export const createHandoffSchema = z
  .object({
    version,
    sourceRunId: z.string().min(1).max(120),
    target: handoffTargetSchema,
    rationale: short,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    counterexampleIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10),
  })
  .refine(
    (input) =>
      new Set(input.counterexampleIds).size === input.counterexampleIds.length,
  );
export const handoffSchema = z.object({
  id: handoffIdSchema,
  createdAt: z.string().datetime(),
  source: z.object({
    runId: z.string(),
    runtimeId: z.string(),
    outputHash: z.string(),
  }),
  target: handoffTargetSchema,
  rationale: short,
  assetVersion: version,
  methodBody: z.string().min(1).max(16000),
  counterexamples: z
    .array(
      z.object({
        id: z.string(),
        observation: text,
        recordedAt: z.string().datetime(),
      }),
    )
    .max(10),
});
export type MethodHandoff = z.infer<typeof handoffSchema>;
export const prepareCheckSchema = z.object({
  version,
  kind: caseKind,
  handoffId: handoffIdSchema.optional(),
});
export const assessCheckSchema = z.object({
  version,
  kind: caseKind,
  runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
  outcome: z.enum(['met', 'missed', 'uncertain']),
  quote: z.string().trim().min(1).max(1200),
  reason: short,
});
export const capturedRunSchema = z.object({
  handoffId: handoffIdSchema.optional(),
  targetMatches: z.boolean().optional(),
  kind: caseKind,
  runId: z.string(),
  receiptId: z.string(),
  status: z.enum([
    'queued',
    'running',
    'streaming',
    'completed',
    'failed',
    'canceled',
    'timed_out',
  ]),
  output: z.string().max(5000),
  error: z.string().max(5000).optional(),
  runtimeId: z.string(),
  model: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  capturedAt: z.string().datetime(),
  outputHash: z.string(),
});
export type MethodCheckRun = z.infer<typeof capturedRunSchema> & {
  source: 'live' | 'saved';
};
export const methodCheckSchema = z.object({
  schemaVersion: z.literal(1),
  id: checkId,
  version,
  learningId: learningIdSchema,
  attemptIndex: z.number().int().min(-1).max(99),
  revisionIndex: z.number().int().min(0).max(99),
  locale: z.enum(['en', 'zh']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  frozenHash: z.string().regex(/^[a-f0-9]{64}$/),
  method: z.object({
    assetId: z.string(),
    assetVersion: version,
    path: z.string(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string(),
    behavior: short,
    scope: short,
    check: short,
  }),
  cases: z
    .array(z.object({ kind: caseKind, task: text, expected: short }))
    .length(2),
  capturedRuns: z.array(capturedRunSchema).max(40),
  handoffs: z.array(handoffSchema).max(5).optional(),
  preparations: z
    .array(
      z.object({
        kind: caseKind,
        handoffId: handoffIdSchema.optional(),
        preparedAt: z.string().datetime(),
        queryHash: z.string().regex(/^[a-f0-9]{64}$/),
        assetVersion: version,
      }),
    )
    .max(20),
  assessments: z
    .array(
      z.object({
        supersedes: z.number().int().nonnegative().optional(),
        handoffId: handoffIdSchema.optional(),
        kind: caseKind,
        runId: z.string(),
        receiptId: z.string(),
        recordedAt: z.string().datetime(),
        outcome: z.enum(['met', 'missed', 'uncertain']),
        quote: z.string().max(1200),
        reason: short,
        runtimeId: z.string(),
        model: z.string().optional(),
        output: z.string().max(5000),
        outputHash: z.string(),
        startedAt: z.number(),
        completedAt: z.number(),
      }),
    )
    .max(40),
});
export type MethodCheck = z.infer<typeof methodCheckSchema>;
export type MethodCheckKind = z.infer<typeof caseKind>;
export const fingerprint = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const frozenFingerprint = (
  record: Pick<
    MethodCheck,
    | 'learningId'
    | 'attemptIndex'
    | 'revisionIndex'
    | 'locale'
    | 'method'
    | 'cases'
  >,
) =>
  fingerprint(
    JSON.stringify({
      learningId: record.learningId,
      attemptIndex: record.attemptIndex,
      revisionIndex: record.revisionIndex,
      locale: record.locale,
      method: record.method,
      cases: record.cases,
    }),
  );
export function checkPrompt(
  record: MethodCheck,
  kind: MethodCheckKind,
  handoffId?: string,
) {
  const task = record.cases.find((item) => item.kind === kind)!.task;
  const handoff = handoffId
    ? record.handoffs?.find((item) => item.id === handoffId)
    : undefined;
  if (handoffId && !handoff) throw new Error('Unknown handoff');
  const notes = handoff
    ? '\n\n' +
      (record.locale === 'zh'
        ? '交接说明（用户选择的内容）'
        : 'Handoff notes (selected by the user)') +
      '\n' +
      handoff.rationale +
      (handoff.counterexamples.length
        ? '\n' +
          (record.locale === 'zh'
            ? '用户记录的反例，尚未独立评估：'
            : 'User-reported counterexamples, not independently assessed:') +
          '\n' +
          handoff.counterexamples.map((item) => item.observation).join('\n\n')
        : '') +
      '\n[handoff: ' +
      handoff.id +
      ']'
    : '';
  // Bind receipts to this frozen check without disclosing its criteria or other case.
  return (
    (record.locale === 'zh'
      ? '请处理下面的新情境。参考所附方法，说明你的判断与依据；如果方法不适用，请解释原因。'
      : 'Handle the new situation below. Consult the attached method and explain your judgment and evidence. If the method does not apply, explain why.') +
    '\n\n' +
    task +
    '\n\n[case: ' +
    record.id +
    ']' +
    notes
  );
}

export function handoffFingerprint(
  value: Omit<MethodHandoff, 'id' | 'createdAt'>,
) {
  return fingerprint(
    JSON.stringify({
      source: value.source,
      target: value.target,
      rationale: value.rationale,
      assetVersion: value.assetVersion,
      methodBody: value.methodBody,
      counterexamples: value.counterexamples,
    }),
  );
}
