import { z } from "zod";
import { comparisonRuntime } from "../method-comparisons/model.js";
const text = (max: number) => z.string().trim().min(1).max(max);
export const longitudinalId = z.string().regex(/^cohort-[a-f0-9]{24}$/);
export const requestId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/);
export const protocolSchema = z
  .object({
    title: text(200),
    hypothesis: text(4000),
    consent: text(6000),
    withdrawal: text(4000),
    reviewedBy: text(80),
    reviewNote: text(2000),
    capacity: z.number().int().min(2).max(100),
    delayHours: z.number().int().min(0).max(2160),
    baselineMethod: text(4000),
    runtime: comparisonRuntime,
    rounds: z
      .array(
        z
          .object({
            before: text(4000),
            coaching: text(4000),
            after: text(4000),
            reference: text(4000),
            updateAllowed: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    rubric: text(4000),
  })
  .strict()
  .refine(
    (p) => !p.rounds.at(-1)!.updateAllowed,
    "The final round has no subsequent method update.",
  );
export type LongitudinalProtocol = z.infer<typeof protocolSchema>;
/** Frozen per-round help budget: successful replies and total attempts, including failures. */
export const HELP_LIMITS = { maxAttempts: 4, maxSucceeded: 2 } as const;
export const helpRequestSchema = z
  .object({
    runtime: comparisonRuntime,
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: text(12000),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();
const runSchema = z
  .object({
    id: requestId,
    commandId: requestId,
    requestHash: text(64),
    question: text(2000),
    status: z.enum(["pending", "succeeded", "failed"]),
    startedAt: text(30),
    deadline: text(30),
    completedAt: text(30).optional(),
    request: helpRequestSchema,
    inputHash: text(64),
    output: text(8000).optional(),
    reportedModel: text(200).optional(),
    responseId: text(200).optional(),
    failure: z
      .enum([
        "provider",
        "configuration",
        "interrupted",
        "cancelled",
        "invalid-output",
      ])
      .optional(),
  })
  .strict();
const revision = z
  .object({
    method: text(4000),
    evidence: text(4000),
    submittedAt: text(30),
    decision: z.enum(["pending", "approved", "rejected"]),
    reviewedBy: text(80).optional(),
    reason: text(2000).optional(),
    reviewedAt: text(30).optional(),
  })
  .strict();
export const roundSchema = z
  .object({
    method: text(4000),
    methodHash: text(64),
    methodFromRound: z.number().int().min(-1),
    startedAt: text(30),
    answers: z
      .array(
        z
          .object({
            stage: z.enum(["before", "coaching", "after"]),
            answer: text(4000),
            at: text(30),
          })
          .strict(),
      )
      .max(3),
    runs: z.array(runSchema).max(4),
    revision: revision.optional(),
    keptAt: text(30).optional(),
    dueAt: text(30).optional(),
  })
  .strict();
const participant = z
  .object({
    id: z.string().regex(/^participant-[a-f0-9]{24}$/),
    tokenHash: text(64),
    issueHash: text(64),
    expiresAt: text(30),
    strategy: z.enum(["next-round", "frozen"]),
    version: z.number().int().positive(),
    consentAt: text(30).optional(),
    withdrawnAt: text(30).optional(),
    erasedAt: text(30).optional(),
    rounds: z.array(roundSchema).max(6),
    commands: z
      .array(z.object({ id: requestId, hash: text(64) }).strict())
      .max(300),
  })
  .strict();
export const recordSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: longitudinalId,
    createdAt: text(30),
    updatedAt: text(30),
    creationHash: text(64),
    salt: text(64),
    protocol: protocolSchema,
    protocolHash: text(64),
    allocation: z.array(z.enum(["next-round", "frozen"])).max(100),
    participants: z.array(participant).max(100),
  })
  .strict();
export type LongitudinalRecord = z.infer<typeof recordSchema>;
export type LongitudinalParticipant =
  LongitudinalRecord["participants"][number];
export const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("consent"),
      version: z.number().int().positive(),
      requestId,
    })
    .strict(),
  z
    .object({
      action: z.literal("answer"),
      version: z.number().int().positive(),
      requestId,
      answer: text(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("revise"),
      version: z.number().int().positive(),
      requestId,
      method: text(4000),
      evidence: text(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("keep"),
      version: z.number().int().positive(),
      requestId,
    })
    .strict(),
  z
    .object({
      action: z.literal("continue"),
      version: z.number().int().positive(),
      requestId,
    })
    .strict(),
  z
    .object({
      action: z.literal("withdraw"),
      version: z.number().int().positive(),
      requestId,
      erase: z.boolean(),
    })
    .strict(),
]);
export type ParticipantStatus =
  | "consent"
  | "answering"
  | "revision"
  | "review"
  | "waiting"
  | "ready"
  | "complete"
  | "withdrawn";
export function participantView(
  r: LongitudinalRecord,
  p: LongitudinalParticipant,
  now: Date,
) {
  const index = Math.max(0, p.rounds.length - 1),
    round = p.rounds[index],
    task = r.protocol.rounds[index];
  const complete =
    !!round &&
    round.answers.length === 3 &&
    index === r.protocol.rounds.length - 1;
  const stage = round
    ? (["before", "coaching", "after"] as const)[round.answers.length]
    : undefined;
  const status: ParticipantStatus = p.withdrawnAt
    ? "withdrawn"
    : !p.consentAt
      ? "consent"
      : complete
        ? "complete"
        : stage
          ? "answering"
          : round?.revision?.decision === "pending"
            ? "review"
            : round?.dueAt
              ? Date.parse(round.dueAt) > now.getTime()
                ? "waiting"
                : "ready"
              : "revision";
  const assisted = status === "answering" && stage === "coaching" && !!round;
  return {
    id: p.id,
    studyId: r.id,
    version: p.version,
    title: r.protocol.title,
    consent: r.protocol.consent,
    withdrawal: r.protocol.withdrawal,
    status,
    round: index,
    roundCount: r.protocol.rounds.length,
    stage: status === "answering" ? stage : undefined,
    stageIndex: status === "answering" && round ? round.answers.length : undefined,
    task: status === "answering" && stage ? task?.[stage] : undefined,
    // The participant's own locked judgment from this round; never another person's text.
    previousAnswer: assisted ? round!.answers[0]?.answer : undefined,
    help: assisted
      ? {
          attempts: round!.runs.length,
          maxAttempts: HELP_LIMITS.maxAttempts,
          succeeded: round!.runs.filter((x) => x.status === "succeeded").length,
          maxSucceeded: HELP_LIMITS.maxSucceeded,
        }
      : undefined,
    updateAllowed: status === "revision" ? task?.updateAllowed : undefined,
    dueAt: status === "waiting" ? round?.dueAt : undefined,
    // Shown while working with help and again when deciding whether to revise it.
    method: assisted || status === "revision" ? round?.method : undefined,
    revision:
      status === "review" || status === "ready" || status === "waiting"
        ? round?.revision
        : undefined,
    runs: assisted
      ? round!.runs.map((x) => ({
          id: x.id,
          question: x.question,
          status:
            x.status === "pending" && Date.parse(x.deadline) <= now.getTime()
              ? "interrupted"
              : x.status,
          output: x.output,
          failure: x.failure,
        }))
      : [],
  };
}
export type LongitudinalView = ReturnType<typeof participantView>;
