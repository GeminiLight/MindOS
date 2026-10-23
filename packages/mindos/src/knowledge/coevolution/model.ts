import { createHash } from 'node:crypto';
import { z } from 'zod';

const field = (max = 1600) => z.string().trim().min(1).max(max);
const date = z.string().datetime();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const coevolutionIdSchema = z
  .string()
  .regex(/^coevolution-[a-f0-9]{24}$/);
export const coevolutionRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/);
export const coevolutionModeSchema = z.enum(['guide', 'together', 'try']);
export type CoevolutionMode = z.infer<typeof coevolutionModeSchema>;
export const coevolutionIntentSchema = z.enum(['decision', 'handoff', 'correction', 'disagreement', 'transfer', 'experiment', 'continue']);
export type CoevolutionIntent = z.infer<typeof coevolutionIntentSchema>;
export const coevolutionSourceSchema = z
  .object({
    kind: z.enum(['session', 'replay']).optional(),
    storyId: field(200).optional(),
    runtime: field(100).optional(),
    sessionId: field(200),
    messageIndex: index,
    messageHash: digest,
    title: field(300),
    quote: field(4000),
    question: field(4000).optional(),
    excerpts: z.array(z.object({ messageId: field(200), role: z.enum(['user', 'assistant']), quote: field(1200) }).strict()).max(20).optional(),
  })
  .strict();
export const coevolutionEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('manual'),
      sourceLabel: field(300),
      quote: field(4000),
    })
    .strict(),
  z
    .object({ kind: z.literal('run'), runId: field(120), quote: field(4000) })
    .strict(),
]);
export type CoevolutionEvidence = z.infer<typeof coevolutionEvidenceSchema>;
const methodFields = { behavior: field(), scope: field(), check: field() };
export const coevolutionMethodSelectionSchema = z
  .object({
    learningId: z.string().regex(/^learn-[a-f0-9]{24}$/),
    attemptIndex: z.number().int().min(-1).max(99),
    revisionIndex: z.number().int().min(0).max(99),
    baseHash: digest,
  })
  .strict();
export const coevolutionMethodSchema = coevolutionMethodSelectionSchema
  .extend({
    ...methodFields,
    assetId: field(200),
    assetVersion: z.number().int().positive(),
    contentHash: digest,
    path: field(2000),
  })
  .strict();
export type CoevolutionMethod = z.infer<typeof coevolutionMethodSchema>;
const actor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human') }).strict(),
  z
    .object({
      kind: z.literal('agent'),
      runId: field(120),
      chatSessionId: field(200),
    })
    .strict(),
]);
const options = z
  .array(
    z
      .object({
        id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
        label: field(200),
        tradeoff: field(),
      })
      .strict(),
  )
  .min(2)
  .max(5)
  .refine(
    (items) =>
      new Set(items.map((item) => item.id)).size === items.length &&
      new Set(items.map((item) => item.label)).size === items.length,
  );
export const coevolutionDecisionSchema = z
  .object({
    id: field(100),
    question: field(2000),
    options,
    actor,
    createdAt: date,
    choice: z
      .object({
        optionId: field(40),
        prediction: field(),
        confidence: z.number().int().min(0).max(100),
        reason: field().optional(),
        recordedAt: date,
      })
      .strict()
      .optional(),
    outcome: z
      .object({
        observation: field(4000),
        evidence: coevolutionEvidenceSchema,
        recordedAt: date,
      })
      .strict()
      .optional(),
  })
  .strict();
export const coevolutionCorrectionSchema = z
  .object({
    id: field(100),
    before: field(4000),
    after: field(4000),
    ...methodFields,
    actor,
    status: z.enum(['draft', 'confirmed', 'rejected']),
    createdAt: date,
    learningId: z
      .string()
      .regex(/^learn-[a-f0-9]{24}$/)
      .optional(),
    resolvedAt: date.optional(),
    editedAt: date.optional(),
    edits: z
      .array(
        z
          .object({
            before: field(4000),
            after: field(4000),
            ...methodFields,
            editedAt: date,
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();
export const coevolutionApplicationSchema = z
  .object({
    id: field(100),
    method: coevolutionMethodSchema,
    disposition: z.enum(['adopt', 'adjust', 'reject']),
    reason: field(),
    adjustment: z.object(methodFields).strict().optional(),
    createdAt: date,
  })
  .strict();
export const coevolutionAgreementSchema = z
  .object({
    id: field(100),
    ...methodFields,
    actor,
    status: z.enum(['proposed', 'trying', 'kept', 'revised', 'withdrawn']),
    createdAt: date,
    trialStartedAt: date.optional(),
    revisionOf: field(100).optional(),
    learningId: z
      .string()
      .regex(/^learn-[a-f0-9]{24}$/)
      .optional(),
    observations: z
      .array(
        z
          .object({
            id: field(100),
            observation: field(4000),
            outcome: z.enum(['helped', 'mixed', 'unhelpful', 'uncertain']),
            evidence: coevolutionEvidenceSchema,
            recordedAt: date,
          })
          .strict(),
      )
      .max(50),
    resolution: z
      .object({ reason: field(), recordedAt: date })
      .strict()
      .optional(),
  })
  .strict();
export const coevolutionPreparationSchema = z
  .object({
    id: z.string().uuid(),
    requestId: coevolutionRequestIdSchema,
    prompt: field(24000),
    queryHash: digest,
    preparedAt: date,
    chatSessionId: field(200).optional(),
    consumedAt: date.optional(),
    intent: coevolutionIntentSchema.optional(),
  })
  .strict();
export const coevolutionReceiptSchema = z.object({
  taskId: coevolutionIdSchema, taskVersion: z.number().int().positive(), mode: coevolutionModeSchema,
  context: field(24000), contextHash: digest,
}).strict();
export const coevolutionRunSchema = z
  .object({
    runId: field(120),
    chatSessionId: field(200),
    runtimeId: field(120),
    model: field(300).optional(),
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
    output: z.string().max(64 * 1024),
    error: z.string().max(5000).optional(),
    startedAt: z.number().finite(),
    completedAt: z.number().finite().optional(),
    capturedAt: date,
    outputHash: digest,
    collaboration: coevolutionReceiptSchema.optional(),
  })
  .strict();
export const coevolutionTaskSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: coevolutionIdSchema,
    version: z.number().int().positive(),
    creationHash: digest,
    title: field(200),
    goal: field(4000),
    mode: coevolutionModeSchema,
    source: coevolutionSourceSchema.optional(),
    chatSessionId: field(200).optional(),
    createdAt: date,
    updatedAt: date,
    archived: z.boolean(),
    decisions: z.array(coevolutionDecisionSchema).max(50),
    corrections: z.array(coevolutionCorrectionSchema).max(50),
    inquiryId: z
      .string()
      .regex(/^inquiry-[a-f0-9]{24}$/)
      .optional(),
    applications: z.array(coevolutionApplicationSchema).max(100),
    agreements: z.array(coevolutionAgreementSchema).max(50),
    preparations: z.array(coevolutionPreparationSchema).max(100),
    runs: z.array(coevolutionRunSchema).max(100),
    modeHistory: z
      .array(
        z.object({ mode: coevolutionModeSchema, recordedAt: date }).strict(),
      )
      .max(100),
    commands: z
      .array(
        z
          .object({ requestId: coevolutionRequestIdSchema, hash: digest })
          .strict(),
      )
      .max(600),
  })
  .strict();
export type CoevolutionTask = z.infer<typeof coevolutionTaskSchema>;
export type CoevolutionRun = z.infer<typeof coevolutionRunSchema>;
export const createCoevolutionTaskSchema = z
  .object({
    requestId: coevolutionRequestIdSchema,
    title: field(200),
    goal: field(4000),
    mode: coevolutionModeSchema,
    source: coevolutionSourceSchema.optional(),
  })
  .strict();
const base = {
  version: z.number().int().positive(),
  requestId: coevolutionRequestIdSchema,
};
export const coevolutionCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...base,
      action: z.literal('set-mode'),
      mode: coevolutionModeSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('add-decision'),
      question: field(2000),
      options,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('choose-decision'),
      decisionId: field(100),
      optionId: field(40),
      prediction: field(),
      confidence: z.number().int().min(0).max(100),
      reason: field().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('observe-decision'),
      decisionId: field(100),
      observation: field(4000),
      evidence: coevolutionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('draft-correction'),
      before: field(4000),
      after: field(4000),
      ...methodFields,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('edit-correction'),
      correctionId: field(100),
      before: field(4000),
      after: field(4000),
      ...methodFields,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('confirm-correction'),
      correctionId: field(100),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('reject-correction'),
      correctionId: field(100),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('link-inquiry'),
      inquiryId: z.string().regex(/^inquiry-[a-f0-9]{24}$/),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('apply-method'),
      method: coevolutionMethodSelectionSchema,
      disposition: z.enum(['adopt', 'adjust', 'reject']),
      reason: field(),
      adjustment: z.object(methodFields).strict().optional(),
    })
    .strict(),
  z
    .object({ ...base, action: z.literal('start-agreement'), ...methodFields })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('propose-agreement'),
      ...methodFields,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('try-agreement'),
      agreementId: field(100),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('observe-agreement'),
      agreementId: field(100),
      observation: field(4000),
      outcome: z.enum(['helped', 'mixed', 'unhelpful', 'uncertain']),
      evidence: coevolutionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('resolve-agreement'),
      agreementId: field(100),
      resolution: z.enum(['keep', 'revise', 'withdraw']),
      reason: field(),
      revision: z.object(methodFields).strict().optional(),
    })
    .strict(),
  z
    .object({ ...base, action: z.literal('archive'), archived: z.boolean() })
    .strict(),
  z.object({ ...base, action: z.literal('capture-runs') }).strict(),
]);
export type CoevolutionCommand = z.infer<typeof coevolutionCommandSchema>;
export const coevolutionPrepareSchema = z.object({ ...base, intent: coevolutionIntentSchema.optional() }).strict();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const coevolutionHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const coevolutionTextHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
