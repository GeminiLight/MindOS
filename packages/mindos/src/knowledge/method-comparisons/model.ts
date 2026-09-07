import { createHash } from 'node:crypto';
import { z } from 'zod';
import { learningIdSchema } from '../learning/model.js';
const text = (max: number) => z.string().trim().min(1).max(max);
const version = z.number().int().positive();
export const comparisonId = z.string().regex(/^comparison-[a-f0-9]{24}$/);
export const comparisonRequestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/);
export const comparisonKind = z.enum(['use', 'exception', 'retention']);
export const comparisonRuntime = z.object({
  adapter: z.literal('isolated-chat-v1'), provider: text(100), model: text(200),
  endpoint: z.string().url().max(2000).refine(value => {
    const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
  }),
  temperature: z.number().finite().min(0).max(2), maxOutputTokens: z.number().int().min(1024).max(4096), tools: z.array(z.never()).length(0),
}).strict();
const casesSchema = z.array(z.object({ kind: comparisonKind, task: text(4000), expected: text(1600) })).length(3)
  .refine(cases => cases.map(c => c.kind).join(',') === 'use,exception,retention' && new Set(cases.map(c => c.task)).size === 3);
export const createComparisonSchema = z.object({
  learningId: learningIdSchema, version, attemptIndex: z.number().int().min(-1).max(99),
  revisions: z.tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)]).refine(([a, b]) => a < b),
  repetitions: z.number().int().min(1).max(3), requestId: comparisonRequestId, cases: casesSchema, runtime: comparisonRuntime,
});
const methodSchema = z.object({
  revisionIndex: z.number().int().nonnegative(), assetId: text(200), assetVersion: version, path: text(2000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), body: z.string().min(1).max(16000), behavior: text(1600), scope: text(1600), check: text(1600),
});
export const comparisonExecutionRequest = z.object({
  runtime: comparisonRuntime,
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1).max(20000) })).length(2),
});
export const comparisonResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('succeeded'), output: text(8000), reportedModel: text(200).optional(), responseId: text(200).optional() }).strict(),
  z.object({ status: z.literal('failed'), failure: z.enum(['provider', 'configuration', 'interrupted', 'invalid-output']) }).strict(),
]);
export const comparisonSchema = z.object({
  schemaVersion: z.literal(1), id: comparisonId, version, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  learningId: learningIdSchema, title: text(500), attemptIndex: z.number().int().min(-1).max(99),
  requestId: comparisonRequestId, inputHash: text(64), frozenHash: text(64), repetitions: z.number().int().min(1).max(3),
  methods: z.tuple([methodSchema, methodSchema]), cases: casesSchema, runtime: comparisonRuntime,
  slots: z.array(z.object({ kind: comparisonKind, repetition: z.number().int().min(0).max(2), side: z.union([z.literal(0), z.literal(1)]) })).min(6).max(18),
  runs: z.array(z.object({
    id: comparisonRequestId, slot: z.number().int().min(0).max(17), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional(),
    request: comparisonExecutionRequest, requestHash: text(64),
    status: z.enum(['running', 'unknown', 'succeeded', 'failed']), output: text(8000).optional(), outputHash: text(64).optional(),
    failure: z.enum(['provider', 'configuration', 'interrupted', 'invalid-output']).optional(), reportedModel: text(200).optional(), responseId: text(200).optional(),
  })).max(36),
  assessments: z.array(z.object({ requestId: comparisonRequestId, runId: comparisonRequestId, outcome: z.enum(['met', 'missed', 'uncertain']), quote: text(1200), reason: text(1600), recordedAt: z.string().datetime(), supersedes: z.number().int().nonnegative().optional() })).max(100),
});
export type MethodComparison = z.infer<typeof comparisonSchema>;
export type MethodComparisonRequest = z.infer<typeof comparisonExecutionRequest>;
export type MethodComparisonResult = z.infer<typeof comparisonResultSchema>;
export const comparisonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const comparisonBodyHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function comparisonFrozenHash(c: MethodComparison) {
  return comparisonHash([c.learningId, c.title, c.attemptIndex, c.requestId, c.inputHash, c.repetitions, c.methods, c.cases, c.runtime, c.slots]);
}
export function comparisonRunRequest(c: MethodComparison, index: number): MethodComparisonRequest {
  const slot = c.slots[index]!;
  const method = c.methods[slot.side];
  return { runtime: c.runtime, messages: [
    // Use the reviewed method fields. Publication metadata and quoted source conversations
    // remain in the audit snapshot, but must not become additional task evidence.
    { role: 'system', content: 'Evaluate this task using the supplied method. Explain your judgment and evidence, including when the method does not apply. No tools, external memory or other context are provided. Do not claim to have executed tools.\n\nBehavior:\n' + method.behavior + '\n\nScope and exceptions:\n' + method.scope + '\n\nObservable check:\n' + method.check },
    { role: 'user', content: c.cases.find(item => item.kind === slot.kind)!.task },
  ] };
}
