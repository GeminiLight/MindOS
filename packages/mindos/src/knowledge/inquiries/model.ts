import { createHash } from 'node:crypto';
import { z } from 'zod';
export const inquiryId = z.string().regex(/^inquiry-[a-f0-9]{24}$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const text = z.string().trim().min(1).max(4000);
export const short = z.string().trim().min(1).max(1600);
export const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/);
const ref = (kind: string) =>
  z.string().regex(new RegExp('^' + kind + '-[1-9][0-9]{0,2}$'));
export const sourceSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    messageIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    messageHash: digest,
    quote: z.string().trim().min(1).max(1000),
    question: text,
    questionHash: digest,
  })
  .strict();
export const draftSchema = z
  .object({
    question: z.string().max(4000),
    explanationA: z.string().max(4000),
    explanationB: z.string().max(4000),
    distinction: z.string().max(4000),
    capability: z.string().max(1600),
  })
  .strict();
export const frameContentSchema = z
  .object({
    question: text,
    explanationA: text,
    explanationB: text,
    distinction: text,
    capability: short,
  })
  .strict();
const frameSchema = frameContentSchema
  .extend({
    id: ref('frame'),
    basedOn: ref('frame').optional(),
    createdAt: z.string().datetime(),
    authorship: z.literal('human'),
  })
  .strict();
export const methodSelectionSchema = z
  .object({
    learningId: z.string().regex(/^learn-[a-f0-9]{24}$/),
    attemptIndex: z.number().int().min(-1).max(99),
    revisionIndex: z.number().int().min(0).max(99),
    baseHash: digest,
  })
  .strict();
export const methodLinkSchema = methodSelectionSchema
  .extend({
    id: ref('method'),
    frameId: ref('frame'),
    linkedAt: z.string().datetime(),
    method: z
      .object({
        behavior: short,
        scope: short,
        check: short,
        proposedAt: z.string().datetime(),
        review: z
          .object({
            cardId: z.string().min(1).max(200),
            decision: z.literal('approved'),
            reviewedAt: z.string().datetime(),
            candidateHash: digest,
            assetId: z.string().min(1).max(200),
            targetPath: text,
          })
          .strict(),
      })
      .strict(),
    asset: z
      .object({
        assetId: z.string().min(1).max(200),
        path: text,
        assetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        contentHash: digest,
      })
      .strict(),
  })
  .strict();
export type InquiryMethodLink = z.infer<typeof methodLinkSchema>;
export const planContentSchema = z
  .object({
    frameId: ref('frame'),
    methodLinkId: ref('method').optional(),
    task: text,
    supportsA: short,
    supportsB: short,
    inconclusive: short,
    scope: short,
    budget: short,
  })
  .strict();
const planSchema = planContentSchema
  .extend({ id: ref('plan'), createdAt: z.string().datetime() })
  .strict();
export const preparationSchema = z
  .object({
    id: ref('preparation'),
    requestId,
    frameId: ref('frame'),
    planId: ref('plan').optional(),
    methodLinkId: ref('method').optional(),
    kind: z.enum(['challenge', 'test']),
    preparedAt: z.string().datetime(),
    prompt: z.string().min(1).max(24000),
    queryHash: digest,
  })
  .strict();
export const runSchema = z
  .object({
    preparationId: ref('preparation'),
    runId: z.string().min(1).max(120),
    receiptId: z.string(),
    status: z.enum([
      'queued',
      'running',
      'streaming',
      'waiting_approval',
      'completed',
      'failed',
      'canceled',
      'timed_out',
    ]),
    output: z.string().max(5000),
    error: z.string().max(5000).optional(),
    runtimeId: z.string().min(1),
    model: z.string().optional(),
    startedAt: z.number().finite(),
    completedAt: z.number().finite().optional(),
    capturedAt: z.string().datetime(),
    outputHash: digest,
  })
  .strict();
const observationSchema = z
  .object({
    id: ref('observation'),
    planId: ref('plan'),
    kind: z.enum(['manual', 'run']),
    runId: z.string().optional(),
    sourceLabel: short.optional(),
    quote: z.string().trim().min(1).max(1200),
    interpretation: short,
    outcome: z.enum(['a', 'b', 'neither', 'uncertain']),
    recordedAt: z.string().datetime(),
  })
  .strict();
const decisionSchema = z
  .object({
    id: ref('decision'),
    frameId: ref('frame'),
    outcome: z.enum(['keep-a', 'keep-b', 'reframe', 'open']),
    evidenceIds: z.array(ref('observation')).max(30),
    reason: short,
    nextQuestion: text.optional(),
    recordedAt: z.string().datetime(),
    methodRevision: z
      .object({
        methodLinkId: ref('method'),
        revisionIndex: z.number().int().positive().max(99),
      })
      .strict()
      .optional(),
    methodDraftId: z
      .string()
      .regex(/^learn-[a-f0-9]{24}$/)
      .optional(),
  })
  .strict();
export const inquirySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: inquiryId,
    version: z.number().int().positive(),
    creationHash: digest,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    locale: z.enum(['en', 'zh']),
    source: sourceSchema,
    archived: z.boolean(),
    draft: draftSchema.nullable(),
    draftOf: ref('frame').optional(),
    frames: z.array(frameSchema).max(40),
    methodLinks: z.array(methodLinkSchema).max(40).optional(),
    plans: z.array(planSchema).max(40),
    preparations: z.array(preparationSchema).max(40),
    runs: z.array(runSchema).max(60),
    observations: z.array(observationSchema).max(60),
    decisions: z.array(decisionSchema).max(60),
    commands: z.array(z.object({ requestId, hash: digest }).strict()).max(300),
  })
  .strict();
export type Inquiry = z.infer<typeof inquirySchema>;
export type InquiryDraft = z.infer<typeof draftSchema>;
export type InquiryRun = z.infer<typeof runSchema> & {
  source: 'live' | 'saved';
};
export const createSchema = z
  .object({ requestId, locale: z.enum(['en', 'zh']), source: sourceSchema })
  .strict();
const base = { requestId, version: z.number().int().positive() };
export const prepareSchema = z
  .object({
    ...base,
    kind: z.enum(['challenge', 'test']),
    planId: ref('plan').optional(),
    frameId: ref('frame').optional(),
  })
  .strict();
export const commandSchema = z.discriminatedUnion('action', [
  methodSelectionSchema
    .extend({
      ...base,
      action: z.literal('link-method'),
      frameId: ref('frame'),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('method-revision'),
      decisionId: ref('decision'),
      methodLinkId: ref('method'),
      reason: short,
      behavior: short,
      scope: short,
      check: short,
    })
    .strict(),
  z
    .object({ ...base, action: z.literal('save-draft'), draft: draftSchema })
    .strict(),
  z.object({ ...base, action: z.literal('commit-frame') }).strict(),
  z
    .object({ ...base, action: z.literal('revise'), frameId: ref('frame') })
    .strict(),
  planContentSchema.extend({ ...base, action: z.literal('plan') }).strict(),
  z.object({ ...base, action: z.literal('capture') }).strict(),
  observationSchema
    .omit({ id: true, recordedAt: true })
    .extend({ ...base, action: z.literal('observe') })
    .strict(),
  decisionSchema
    .omit({
      id: true,
      recordedAt: true,
      methodDraftId: true,
      methodRevision: true,
    })
    .extend({ ...base, action: z.literal('decide') })
    .strict(),
  z
    .object({ ...base, action: z.literal('archive'), archived: z.boolean() })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('method-draft'),
      decisionId: ref('decision'),
      behavior: short,
      scope: short,
      check: short,
    })
    .strict(),
]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const hashText = (value: string) =>
  createHash('sha256').update(value).digest('hex');
