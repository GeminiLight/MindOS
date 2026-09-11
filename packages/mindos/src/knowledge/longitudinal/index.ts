import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  privateRecordNames,
  withPrivateRecordLock,
} from "../private-records.js";
import { StudyAccessError } from "../research/access.js";
import {
  hash,
  identity,
  invalid,
  conflict,
  load,
  write,
  mutate,
} from "./storage.js";
import {
  HELP_LIMITS,
  protocolSchema,
  requestId,
  commandSchema,
  participantView,
  type LongitudinalRecord,
  type LongitudinalParticipant,
} from "./model.js";
export type {
  LongitudinalProtocol,
  LongitudinalRecord,
  LongitudinalView,
} from "./model.js";
const at = (now: Date) => now.toISOString();
export function createLongitudinal(
  root: string,
  input: unknown,
  now = new Date(),
) {
  const c = z
    .object({ requestId, protocol: protocolSchema })
    .strict()
    .safeParse(input);
  if (!c.success) return invalid("Complete and review the protocol.");
  return withPrivateRecordLock(root, () => {
    const id = "cohort-" + hash(c.data.requestId).slice(0, 24),
      existing = privateRecordNames(root).includes(id + ".json")
        ? load(root, id)
        : null;
    if (existing) {
      if (existing.creationHash !== hash(c.data)) return conflict();
      return { id };
    }
    const allocation: LongitudinalRecord["allocation"] = [];
    while (allocation.length < c.data.protocol.capacity)
      allocation.push(
        ...(randomInt(2)
          ? (["frozen", "next-round"] as const)
          : (["next-round", "frozen"] as const)),
      );
    const r: LongitudinalRecord = {
      schemaVersion: 2,
      id,
      createdAt: at(now),
      updatedAt: at(now),
      creationHash: hash(c.data),
      salt: randomBytes(32).toString("hex"),
      protocol: c.data.protocol,
      protocolHash: hash(c.data.protocol),
      allocation: allocation.slice(0, c.data.protocol.capacity),
      participants: [],
    };
    write(root, r);
    return { id };
  });
}
export function issueLongitudinalAccess(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const c = z.object({ requestId }).strict().safeParse(input);
  if (!c.success) return invalid();
  return mutate(root, id, now, (r) => {
    const token = createHmac("sha256", r.salt)
        .update(c.data.requestId)
        .digest("hex"),
      issueHash = hash(c.data.requestId);
    let p = r.participants.find((x) => x.issueHash === issueHash);
    if (!p) {
      if (r.participants.length >= r.protocol.capacity)
        return conflict("Study capacity reached.");
      p = {
        id: identity("participant"),
        issueHash,
        tokenHash: hash(token),
        expiresAt: at(new Date(now.getTime() + 90 * 86400000)),
        strategy: r.allocation[r.participants.length]!,
        version: 1,
        rounds: [],
        commands: [],
      };
      r.participants.push(p);
    }
    return { token, participantId: p.id };
  });
}
function authorized(r: LongitudinalRecord, token: unknown, now: Date) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new StudyAccessError();
  const digest = Buffer.from(hash(token));
  const p = r.participants.find((p) =>
    timingSafeEqual(Buffer.from(p.tokenHash), digest),
  );
  if (!p || Date.parse(p.expiresAt) <= now.getTime())
    throw new StudyAccessError();
  return p;
}
function access(root: string, id: string, token: unknown, now: Date) {
  let r: LongitudinalRecord;
  try {
    r = load(root, id);
  } catch {
    throw new StudyAccessError();
  }
  return { r, p: authorized(r, token, now) };
}
export function readLongitudinal(
  root: string,
  id: string,
  token: unknown,
  now = new Date(),
) {
  const { r, p } = access(root, id, token, now);
  return participantView(r, p, now);
}
function nextRound(
  r: LongitudinalRecord,
  p: LongitudinalParticipant,
  now: Date,
) {
  let method = r.protocol.baselineMethod,
    from = -1;
  if (p.strategy === "next-round")
    for (const [i, round] of p.rounds.entries())
      if (round.revision?.decision === "approved") {
        method = round.revision.method;
        from = i;
      }
  p.rounds.push({
    method,
    methodHash: hash(method),
    methodFromRound: from,
    startedAt: at(now),
    answers: [],
    runs: [],
  });
}
export function useLongitudinal(
  root: string,
  id: string,
  token: unknown,
  input: unknown,
  now = new Date(),
) {
  access(root, id, token, now);
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const c = parsed.data;
  return mutate(root, id, now, (r) => {
    const p = authorized(r, token, now),
      old = p.commands.find((x) => x.id === c.requestId);
    if (old) {
      if (old.hash !== hash(c)) return conflict();
      return participantView(r, p, now);
    }
    if (c.version !== p.version || p.withdrawnAt) return conflict();
    const view = participantView(r, p, now),
      round = p.rounds.at(-1);
    if (c.action === "withdraw") {
      p.withdrawnAt = at(now);
      if (c.erase) {
        p.erasedAt = at(now);
        p.rounds = [];
        p.commands = [];
      } else
        for (const rr of p.rounds)
          for (const run of rr.runs)
            if (run.status === "pending") {
              run.status = "failed";
              run.failure = "cancelled";
              run.completedAt = at(now);
            }
    } else if (c.action === "consent") {
      if (view.status !== "consent") return conflict();
      p.consentAt = at(now);
      nextRound(r, p, now);
    } else if (c.action === "answer") {
      if (view.status !== "answering" || !view.stage || !round)
        return conflict();
      if (
        round.runs.some(
          (x) =>
            x.status === "pending" && Date.parse(x.deadline) > now.getTime(),
        )
      )
        return conflict("A help request is running.");
      round.answers.push({ stage: view.stage, answer: c.answer, at: at(now) });
    } else if (c.action === "revise") {
      if (view.status !== "revision" || !view.updateAllowed || !round)
        return conflict();
      round.revision = {
        method: c.method,
        evidence: c.evidence,
        submittedAt: at(now),
        decision: "pending",
      };
    } else if (c.action === "keep") {
      if (view.status !== "revision" || !round) return conflict();
      round.keptAt = at(now);
      round.dueAt = at(
        new Date(now.getTime() + r.protocol.delayHours * 3600000),
      );
    } else if (c.action === "continue") {
      if (view.status !== "ready") return conflict();
      nextRound(r, p, now);
    }
    p.version++;
    if (!p.erasedAt) p.commands.push({ id: c.requestId, hash: hash(c) });
    return participantView(r, p, now);
  });
}
export function reviewLongitudinalMethod(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const c = z
    .object({
      participantId: z.string(),
      round: z.number().int().min(0),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().min(1).max(2000),
      reviewedBy: z.string().trim().min(1).max(80),
    })
    .strict()
    .safeParse(input);
  if (!c.success) return invalid();
  return mutate(root, id, now, (r) => {
    const p = r.participants.find((x) => x.id === c.data.participantId),
      round = p?.rounds[c.data.round],
      rev = round?.revision;
    if (!p || p.withdrawnAt || !rev || !round) return conflict();
    if (rev.decision !== "pending") {
      if (
        rev.decision === c.data.decision &&
        rev.reason === c.data.reason &&
        rev.reviewedBy === c.data.reviewedBy
      )
        return;
      return conflict();
    }
    Object.assign(rev, {
      decision: c.data.decision,
      reason: c.data.reason,
      reviewedBy: c.data.reviewedBy,
      reviewedAt: at(now),
    });
    round.dueAt = at(new Date(now.getTime() + r.protocol.delayHours * 3600000));
    p.version++;
  });
}
export function beginLongitudinalHelp(
  root: string,
  id: string,
  token: unknown,
  input: unknown,
  now = new Date(),
) {
  access(root, id, token, now);
  const c = z
    .object({
      version: z.number().int().positive(),
      requestId,
      question: z.string().trim().min(1).max(2000),
    })
    .strict()
    .safeParse(input);
  if (!c.success) return invalid();
  return mutate(root, id, now, (r) => {
    const p = authorized(r, token, now),
      view = participantView(r, p, now),
      round = p.rounds.at(-1);
    if (p.withdrawnAt || view.stage !== "coaching" || !round) return conflict();
    const existing = round.runs.find((x) => x.commandId === c.data.requestId);
    if (existing) {
      if (existing.requestHash !== hash(c.data)) return conflict();
      return { execute: false, runId: existing.id, request: undefined };
    }
    if (
      p.version !== c.data.version ||
      round.runs.length >= HELP_LIMITS.maxAttempts ||
      round.runs.filter((x) => x.status === "succeeded").length >=
        HELP_LIMITS.maxSucceeded ||
      round.runs.some(
        (x) => x.status === "pending" && Date.parse(x.deadline) > now.getTime(),
      )
    )
      return conflict();
    for (const run of round.runs)
      if (run.status === "pending") {
        run.status = "failed";
        run.failure = "interrupted";
        run.completedAt = at(now);
      }
    const request = {
      runtime: r.protocol.runtime,
      messages: [
        {
          role: "system" as const,
          content:
            "Use only this approved method and current task. No tools or external memory.\n\n" +
            round.method,
        },
        {
          role: "user" as const,
          content:
            r.protocol.rounds[view.round]!.coaching + "\n\n" + c.data.question,
        },
      ],
    };
    const runId = identity("help");
    round.runs.push({
      id: runId,
      commandId: c.data.requestId,
      requestHash: hash(c.data),
      question: c.data.question,
      status: "pending",
      startedAt: at(now),
      deadline: at(new Date(now.getTime() + 120000)),
      request,
      inputHash: hash(request),
    });
    p.version++;
    return { execute: true, runId, request };
  });
}
const resultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("succeeded"),
      output: z.string().trim().min(1).max(8000),
      reportedModel: z.string().trim().min(1).max(200).optional(),
      responseId: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      failure: z.enum([
        "provider",
        "configuration",
        "interrupted",
        "cancelled",
        "invalid-output",
      ]),
    })
    .strict(),
]);
export function finishLongitudinalHelp(
  root: string,
  id: string,
  runId: string,
  input: unknown,
  now = new Date(),
) {
  return mutate(root, id, now, (r) => {
    for (const p of r.participants)
      for (const round of p.rounds) {
        const run = round.runs.find(
          (x) => x.id === runId && x.status === "pending",
        );
        if (!run) continue;
        const result = resultSchema.safeParse(input);
        if (
          p.withdrawnAt ||
          round.answers.length !== 1 ||
          Date.parse(p.expiresAt) <= now.getTime()
        ) {
          run.status = "failed";
          run.failure = "cancelled";
        } else if (Date.parse(run.deadline) <= now.getTime()) {
          run.status = "failed";
          run.failure = "interrupted";
        } else if (!result.success) {
          run.status = "failed";
          run.failure = "invalid-output";
        } else Object.assign(run, result.data);
        run.completedAt = at(now);
        p.version++;
        return;
      }
  });
}
export function exportLongitudinal(root: string, id: string) {
  const r = load(root, id);
  return {
    schemaVersion: r.schemaVersion,
    id: r.id,
    protocol: r.protocol,
    protocolHash: r.protocolHash,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    participants: r.participants.map(
      ({ tokenHash, issueHash, commands, ...p }) => p,
    ),
  };
}
function participantProgress(
  r: LongitudinalRecord,
  p: LongitudinalParticipant,
  now: Date,
) {
  const view = participantView(r, p, now);
  const runs = p.rounds.flatMap((x) => x.runs);
  const moments = [
    p.consentAt,
    p.withdrawnAt,
    ...p.rounds.flatMap((x) => [
      x.startedAt,
      x.keptAt,
      x.revision?.submittedAt,
      x.revision?.reviewedAt,
      ...x.answers.map((a) => a.at),
      ...x.runs.map((run) => run.completedAt ?? run.startedAt),
    ]),
  ].filter((v): v is string => !!v);
  return {
    id: p.id,
    strategy: p.strategy,
    status: view.status,
    round: view.round,
    roundCount: view.roundCount,
    stage: view.stage,
    dueAt: p.rounds.at(-1)?.dueAt,
    expiresAt: p.expiresAt,
    consentAt: p.consentAt,
    withdrawnAt: p.withdrawnAt,
    erased: !!p.erasedAt,
    answers: p.rounds.reduce((n, x) => n + x.answers.length, 0),
    revisionPending:
      !p.withdrawnAt &&
      p.rounds.some((x) => x.revision?.decision === "pending"),
    helpSucceeded: runs.filter((x) => x.status === "succeeded").length,
    helpFailed: runs.filter((x) => x.status === "failed").length,
    helpPending: runs.filter(
      (x) => x.status === "pending" && Date.parse(x.deadline) > now.getTime(),
    ).length,
    lastActivityAt: moments.sort().at(-1),
  };
}
export type LongitudinalProgress = ReturnType<typeof participantProgress>;
function summarize(r: LongitudinalRecord, progress: LongitudinalProgress[]) {
  const count = (fn: (p: LongitudinalProgress) => boolean) =>
    progress.filter(fn).length;
  return {
    invited: r.participants.length,
    capacity: r.protocol.capacity,
    consented: count((p) => !!p.consentAt),
    active: count(
      (p) => !!p.consentAt && !p.withdrawnAt && p.status !== "complete",
    ),
    complete: count((p) => p.status === "complete"),
    withdrawn: count((p) => !!p.withdrawnAt),
    pendingReviews: count((p) => p.revisionPending),
    failedRuns: progress.reduce((n, p) => n + p.helpFailed, 0),
    pendingRuns: progress.reduce((n, p) => n + p.helpPending, 0),
  };
}
/** Researcher projection: the export plus per-participant status. Never served to participants. */
export function adminLongitudinal(root: string, id: string, now = new Date()) {
  const r = load(root, id);
  const progress = r.participants.map((p) => participantProgress(r, p, now));
  return {
    study: exportLongitudinal(root, id),
    progress,
    summary: summarize(r, progress),
  };
}
export type LongitudinalAdminView = ReturnType<typeof adminLongitudinal>;
function packetEntries(r: LongitudinalRecord) {
  const entries = [];
  for (const p of r.participants) {
    if (p.erasedAt) continue;
    for (const [n, round] of p.rounds.entries())
      for (const a of round.answers)
        entries.push({
          // Salted ordering hides enrollment order, which alternates strategies.
          sort: createHmac("sha256", r.salt)
            .update(`review-packet:v1:${p.id}:${n}:${a.stage}`)
            .digest("hex"),
          participantId: p.id,
          strategy: p.strategy,
          round: n + 1,
          stage: a.stage,
          task: r.protocol.rounds[n]![a.stage],
          answer: a.answer,
          reference: r.protocol.rounds[n]!.reference,
          submittedAt: a.at,
          methodFromRound: round.methodFromRound,
          methodHash: round.methodHash,
          withdrawn: !!p.withdrawnAt,
        });
  }
  entries.sort((a, b) => a.sort.localeCompare(b.sort));
  return entries.map((e, i) => ({
    ...e,
    code: "W" + String(i + 1).padStart(3, "0"),
  }));
}
/** Numbered work items for independent scoring: task, answer and reference only. No identity, group or method text. */
export function exportLongitudinalReviewPacket(root: string, id: string) {
  const r = load(root, id);
  return {
    schemaVersion: 2 as const,
    kind: "review-packet" as const,
    studyId: r.id,
    protocolHash: r.protocolHash,
    title: r.protocol.title,
    rubric: r.protocol.rubric,
    roundCount: r.protocol.rounds.length,
    generatedAt: new Date().toISOString(),
    items: packetEntries(r).map((e) => ({
      code: e.code,
      round: e.round,
      stage: e.stage,
      task: e.task,
      answer: e.answer,
      reference: e.reference,
    })),
  };
}
export type LongitudinalReviewPacket = ReturnType<
  typeof exportLongitudinalReviewPacket
>;
/** Researcher-only mapping from packet codes back to participants, groups and method versions. */
export function exportLongitudinalReviewKey(root: string, id: string) {
  const r = load(root, id);
  return {
    schemaVersion: 2 as const,
    kind: "review-key" as const,
    studyId: r.id,
    protocolHash: r.protocolHash,
    generatedAt: new Date().toISOString(),
    items: packetEntries(r).map((e) => ({
      code: e.code,
      participantId: e.participantId,
      strategy: e.strategy,
      round: e.round,
      stage: e.stage,
      submittedAt: e.submittedAt,
      methodFromRound: e.methodFromRound,
      methodHash: e.methodHash,
      withdrawn: e.withdrawn,
    })),
  };
}
export function listLongitudinal(root: string, now = new Date()) {
  const studies: {
    id: string;
    title: string;
    participants: number;
    capacity: number;
    consented: number;
    active: number;
    complete: number;
    withdrawn: number;
    pendingReviews: number;
    rounds: number;
    createdAt: string;
    updatedAt: string;
  }[] = [];
  let unavailableCount = 0;
  for (const n of privateRecordNames(root)) {
    if (!/^cohort-[a-f0-9]{24}\.json$/.test(n)) continue;
    try {
      const r = load(root, n.slice(0, -5));
      const summary = summarize(
        r,
        r.participants.map((p) => participantProgress(r, p, now)),
      );
      studies.push({
        id: r.id,
        title: r.protocol.title,
        participants: summary.invited,
        capacity: summary.capacity,
        consented: summary.consented,
        active: summary.active,
        complete: summary.complete,
        withdrawn: summary.withdrawn,
        pendingReviews: summary.pendingReviews,
        rounds: r.protocol.rounds.length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
    } catch {
      unavailableCount++;
    }
  }
  studies.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
  return { studies, unavailableCount };
}
export type LongitudinalSummary = ReturnType<
  typeof listLongitudinal
>["studies"][number];
