import { createHash, randomBytes } from "node:crypto";
import {
  readPrivateRecord,
  writePrivateRecord,
  withPrivateRecordLock,
} from "../private-records.js";
import { LearningError } from "../learning/model.js";
import {
  longitudinalId,
  recordSchema,
  type LongitudinalRecord,
} from "./model.js";
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const identity = (prefix: string) =>
  prefix + "-" + randomBytes(12).toString("hex");
export const invalid = (message = "Invalid study request."): never => {
  throw new LearningError("invalid", message);
};
export const conflict = (
  message = "Progress changed. Refresh and try again.",
): never => {
  throw new LearningError("conflict", message);
};
export function validate(r: LongitudinalRecord) {
  if (
    hash(r.protocol) !== r.protocolHash ||
    r.allocation.length !== r.protocol.capacity ||
    r.participants.length > r.protocol.capacity
  )
    throw Error("Protocol mismatch");
  const ids = new Set<string>();
  for (const [i, p] of r.participants.entries()) {
    if (
      ids.has(p.id) ||
      p.strategy !== r.allocation[i] ||
      p.rounds.length > r.protocol.rounds.length
    )
      throw Error("Allocation mismatch");
    ids.add(p.id);
    if (p.erasedAt) {
      if (!p.withdrawnAt || p.rounds.length || p.commands.length)
        throw Error("Erasure mismatch");
      continue;
    }
    if (!p.consentAt && p.rounds.length) throw Error("Consent mismatch");
    for (const [n, round] of p.rounds.entries()) {
      let expected = r.protocol.baselineMethod,
        from = -1;
      if (p.strategy === "next-round")
        for (let j = 0; j < n; j++) {
          const rev = p.rounds[j]!.revision;
          if (rev?.decision === "approved") {
            expected = rev.method;
            from = j;
          }
        }
      if (
        round.method !== expected ||
        round.methodHash !== hash(expected) ||
        round.methodFromRound !== from
      )
        throw Error("Method mismatch");
      if (n > 0 && !p.rounds[n - 1]!.dueAt) throw Error("Round mismatch");
      if (
        round.answers.some(
          (a, j) => a.stage !== ["before", "coaching", "after"][j],
        )
      )
        throw Error("Stage mismatch");
      if (
        round.revision &&
        (!r.protocol.rounds[n]!.updateAllowed || round.answers.length !== 3)
      )
        throw Error("Update mismatch");
      for (const run of round.runs) {
        if (
          hash(run.request) !== run.inputHash ||
          hash(run.request.runtime) !== hash(r.protocol.runtime)
        )
          throw Error("Request mismatch");
        if (
          run.status === "succeeded"
            ? !run.output || !!run.failure
            : !!run.output
        )
          throw Error("Result mismatch");
      }
    }
  }
}
export function load(root: string, id: string) {
  if (!longitudinalId.safeParse(id).success) return invalid();
  const raw = readPrivateRecord(root, id + ".json", 8000000);
  if (!raw) throw new LearningError("not-found", "Study not found.");
  try {
    const { recordHash, ...data } = raw as Record<string, unknown>;
    const r = recordSchema.parse(data);
    if (r.id !== id || recordHash !== hash(r)) throw Error();
    validate(r);
    return r;
  } catch {
    throw new LearningError(
      "storage",
      "Study integrity check failed; data preserved.",
    );
  }
}
export function write(root: string, r: LongitudinalRecord) {
  const parsed = recordSchema.safeParse(r);
  if (!parsed.success)
    throw new LearningError("storage", "Invalid study data.");
  validate(parsed.data);
  writePrivateRecord(
    root,
    r.id + ".json",
    { ...parsed.data, recordHash: hash(parsed.data) },
    8000000,
  );
}
export function mutate<T>(
  root: string,
  id: string,
  now: Date,
  fn: (r: LongitudinalRecord) => T,
) {
  return withPrivateRecordLock(root, () => {
    const r = load(root, id);
    if (
      !Number.isFinite(now.getTime()) ||
      now.getTime() < Date.parse(r.updatedAt)
    )
      return conflict("Invalid event time.");
    const value = fn(r);
    r.updatedAt = now.toISOString();
    write(root, r);
    return value;
  });
}
