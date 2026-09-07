import { z } from 'zod';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const methodMatchInput = z.object({
  attemptIndex: z.number().int().min(-1).max(99),
  revisionIndex: z.number().int().min(0).max(99),
  assetVersion: z.number().int().positive(), contentHash: digest,
  reason: z.string().trim().min(1).max(1600), fitConfirmed: z.literal(true),
});
export const transferMethodSchema = methodMatchInput.extend({
  assetId: z.string().min(1).max(200), path: z.string().min(1).max(2000),
  title: z.string().min(1).max(1600), matchedAt: z.string().datetime(),
});
export const helpPreparationSchema = z.object({ queryHash: digest, preparedAt: z.string().datetime() });
export const helpRunSchema = z.object({
  runId: z.string().min(1).max(120), receiptId: z.string().min(1).max(120),
  runtimeId: z.string().min(1).max(120), model: z.string().max(300).optional(),
  status: z.enum(['queued', 'running', 'streaming', 'completed', 'failed', 'canceled', 'timed_out']),
  output: z.string().max(5000), outputHash: digest, error: z.string().max(5000).optional(),
  startedAt: z.number(), completedAt: z.number().optional(), capturedAt: z.string().datetime(), viewRequestedAt: z.string().datetime().optional(),
});
export type TransferMethod = z.infer<typeof transferMethodSchema>;
export type TransferHelpRun = z.infer<typeof helpRunSchema>;
