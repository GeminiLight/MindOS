import { createHmac } from 'node:crypto';
import { load, hash } from './storage.js';
import type { LongitudinalRecord } from './model.js';

function exportRecord(r: LongitudinalRecord) {
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
  return entries.map((e) => ({
    ...e,
    code: "W-" + e.sort.slice(0, 24),
  }));
}

/** A single read binds all downloads to the same immutable source state.
 * No server-side answer copies are retained, so erasure has one storage owner.
 */
export function exportLongitudinalBundle(root: string, id: string) {
  const r = load(root, id);
  const record = exportRecord(r);
  const entries = packetEntries(r);
  const packetId = 'packet-' + hash(record);
  const common = {
    schemaVersion: 2 as const, exportFormatVersion: 3 as const,
    packetId, studyId: r.id, protocolHash: r.protocolHash,
    generatedAt: new Date().toISOString(),
  };
  return {
    packetId,
    record: { ...record, exportFormatVersion: 3 as const, packetId },
    review: {
      ...common, kind: 'review-packet' as const, title: r.protocol.title,
      rubric: r.protocol.rubric, roundCount: r.protocol.rounds.length,
      items: entries.map(e => ({ code: e.code, round: e.round, stage: e.stage,
        task: e.task, answer: e.answer, reference: e.reference })),
    },
    key: {
      ...common, kind: 'review-key' as const,
      items: entries.map(e => ({ code: e.code, participantId: e.participantId,
        strategy: e.strategy, round: e.round, stage: e.stage, submittedAt: e.submittedAt,
        methodFromRound: e.methodFromRound, methodHash: e.methodHash, withdrawn: e.withdrawn })),
    },
  };
}
export type LongitudinalExportBundle = ReturnType<typeof exportLongitudinalBundle>;
export function exportLongitudinal(root: string, id: string) { return exportRecord(load(root, id)); }
export function exportLongitudinalReviewPacket(root: string, id: string) { return exportLongitudinalBundle(root, id).review; }
export function exportLongitudinalReviewKey(root: string, id: string) { return exportLongitudinalBundle(root, id).key; }
export type LongitudinalReviewPacket = ReturnType<typeof exportLongitudinalReviewPacket>;
