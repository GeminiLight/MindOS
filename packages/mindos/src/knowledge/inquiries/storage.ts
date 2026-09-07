import {
  privateRecordNames,
  readPrivateRecord,
  writePrivateRecord,
  withPrivateRecordLock,
} from '../private-records.js';
import { LearningError } from '../learning/model.js';
import { learningMethodFingerprint } from '../learning/store.js';
import {
  inquiryId,
  inquirySchema,
  fingerprint,
  hashText,
  type Inquiry,
} from './model.js';
const maxBytes = 8_000_000;
export function fail(
  code: 'invalid' | 'conflict' | 'storage' | 'not-found',
  message: string,
): never {
  throw new LearningError(code, message);
}
export function checkTime(now: Date, prior?: string) {
  if (!Number.isFinite(now.getTime())) fail('invalid', 'Choose a valid time.');
  if (prior && now.getTime() < Date.parse(prior))
    fail('conflict', 'The clock moved behind this saved record.');
}
function consistent(q: Inquiry) {
  const frame = (id: string) => q.frames.find((f) => f.id === id);
  const method = (id: string) => q.methodLinks?.find((l) => l.id === id);
  if (
    q.methodLinks?.some(
      (l, i) =>
        l.id !== 'method-' + (i + 1) ||
        !frame(l.frameId) ||
        l.linkedAt < q.createdAt ||
        l.linkedAt > q.updatedAt ||
        learningMethodFingerprint({ ...l.method, observations: [] }) !==
          l.baseHash ||
        l.asset.assetId !== l.method.review.assetId ||
        l.asset.path !== l.method.review.targetPath,
    )
  )
    return false;
  if (
    q.plans.some(
      (p) => p.methodLinkId && method(p.methodLinkId)?.frameId !== p.frameId,
    ) ||
    q.preparations.some(
      (p) =>
        p.methodLinkId !==
        (p.planId
          ? q.plans.find((plan) => plan.id === p.planId)?.methodLinkId
          : undefined),
    )
  )
    return false;
  if (
    q.decisions.some(
      (d) =>
        d.methodRevision &&
        (!d.methodDraftId ||
          method(d.methodRevision.methodLinkId)?.learningId !==
            d.methodDraftId ||
          method(d.methodRevision.methodLinkId)?.frameId !== d.frameId ||
          (method(d.methodRevision.methodLinkId)?.revisionIndex ?? -2) + 1 !==
            d.methodRevision.revisionIndex),
    )
  )
    return false;
  const plan = (id: string) => q.plans.find((p) => p.id === id);
  if (
    new Set(q.commands.map((c) => c.requestId)).size !== q.commands.length ||
    Date.parse(q.createdAt) > Date.parse(q.updatedAt)
  )
    return false;
  if (q.draftOf && (!q.draft || !frame(q.draftOf))) return false;
  if (
    q.frames.some(
      (f, i) =>
        f.id !== 'frame-' + (i + 1) ||
        f.explanationA === f.explanationB ||
        (f.basedOn && !q.frames.slice(0, i).some((p) => p.id === f.basedOn)),
    )
  )
    return false;
  if (
    q.plans.some(
      (p, i) =>
        p.id !== 'plan-' + (i + 1) ||
        !frame(p.frameId) ||
        p.supportsA === p.supportsB,
    )
  )
    return false;
  if (
    q.preparations.some(
      (p, i) =>
        p.id !== 'preparation-' + (i + 1) ||
        !frame(p.frameId) ||
        hashText(p.prompt) !== p.queryHash ||
        (p.kind === 'test'
          ? !p.planId || plan(p.planId)?.frameId !== p.frameId
          : !!p.planId),
    )
  )
    return false;
  if (
    new Set(q.runs.map((r) => r.runId)).size !== q.runs.length ||
    q.runs.some(
      (r) =>
        !q.preparations.some((p) => p.id === r.preparationId) ||
        hashText(r.output) !== r.outputHash ||
        !['completed', 'failed', 'canceled', 'timed_out'].includes(r.status),
    )
  )
    return false;
  if (
    q.observations.some((o, i) => {
      if (o.id !== 'observation-' + (i + 1) || !plan(o.planId)) return true;
      if (o.kind === 'manual') return !o.sourceLabel || !!o.runId;
      const run = q.runs.find((r) => r.runId === o.runId);
      return (
        !run ||
        run.status !== 'completed' ||
        !run.completedAt ||
        !run.output.includes(o.quote) ||
        !!o.sourceLabel ||
        !q.preparations.some(
          (p) => p.id === run.preparationId && p.planId === o.planId,
        )
      );
    })
  )
    return false;
  if (
    q.decisions.some(
      (d, i) =>
        d.id !== 'decision-' + (i + 1) ||
        !frame(d.frameId) ||
        new Set(d.evidenceIds).size !== d.evidenceIds.length ||
        (d.outcome !== 'open' && !d.evidenceIds.length) ||
        (d.outcome === 'reframe' ? !d.nextQuestion : !!d.nextQuestion) ||
        d.evidenceIds.some((id) => {
          const o = q.observations.find((o) => o.id === id);
          return !o || plan(o.planId)?.frameId !== d.frameId;
        }),
    )
  )
    return false;
  return [
    ...q.frames.map((f) => f.createdAt),
    ...q.plans.map((p) => p.createdAt),
    ...q.preparations.map((p) => p.preparedAt),
    ...q.observations.map((o) => o.recordedAt),
    ...q.decisions.map((d) => d.recordedAt),
  ].every((at) => at >= q.createdAt && at <= q.updatedAt);
}
export function read(root: string, id: string): Inquiry | null {
  if (!inquiryId.safeParse(id).success)
    fail('invalid', 'Choose a valid question.');
  const value = readPrivateRecord(root, id + '.json', maxBytes);
  if (value === null) return null;
  try {
    const { recordHash, ...data } = value as Record<string, unknown>;
    const q = inquirySchema.parse(data);
    if (q.id !== id || fingerprint(q) !== recordHash || !consistent(q))
      throw Error();
    return q;
  } catch {
    return fail(
      'storage',
      'Could not read this question. Existing data was preserved.',
    );
  }
}
export function write(root: string, value: Inquiry) {
  const parsed = inquirySchema.safeParse(value);
  if (!parsed.success || !consistent(parsed.data))
    fail(
      'storage',
      'This question reached its record limit or could not be saved consistently. Existing data was preserved.',
    );
  const q = parsed.data;
  writePrivateRecord(
    root,
    q.id + '.json',
    { ...q, recordHash: fingerprint(q) },
    maxBytes,
  );
}
export function listInquiries(root: string) {
  const inquiries: Array<{
    id: string;
    version: number;
    title: string;
    updatedAt: string;
    archived: boolean;
    stage: 'draft' | 'framed' | 'testing' | 'decided';
  }> = [];
  let unavailableCount = 0;
  for (const name of privateRecordNames(root)) {
    if (!/^inquiry-[a-f0-9]{24}\.json$/.test(name)) continue;
    try {
      const q = read(root, name.slice(0, -5));
      if (q)
        inquiries.push({
          id: q.id,
          version: q.version,
          title:
            q.draft?.question ||
            q.decisions.filter((d) => d.frameId === q.frames.at(-1)?.id).at(-1)
              ?.nextQuestion ||
            q.frames.at(-1)?.question ||
            q.source.question,
          updatedAt: q.updatedAt,
          archived: q.archived,
          stage: q.draft
            ? 'draft'
            : q.decisions.some((d) => d.frameId === q.frames.at(-1)?.id)
              ? 'decided'
              : q.plans.some((p) => p.frameId === q.frames.at(-1)?.id)
                ? 'testing'
                : 'framed',
        });
    } catch {
      unavailableCount++;
    }
  }
  return {
    inquiries: inquiries.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    ),
    unavailableCount,
  };
}
export function mutate<T>(
  root: string,
  id: string,
  command: { requestId: string; version: number },
  now: Date,
  action: (q: Inquiry) => T,
): { inquiry: Inquiry; result?: T } {
  return withPrivateRecordLock(root, () => {
    const q = read(root, id);
    if (!q) return fail('not-found', 'Question not found.');
    checkTime(now, q.updatedAt);
    const prior = q.commands.find((c) => c.requestId === command.requestId);
    const hash = fingerprint(command);
    if (prior) {
      if (prior.hash !== hash)
        fail('conflict', 'This request already contains different content.');
      return { inquiry: q };
    }
    if (q.version !== command.version)
      fail(
        'conflict',
        'This question changed. Reload the saved version before revising.',
      );
    const result = action(q);
    q.commands.push({ requestId: command.requestId, hash });
    q.version++;
    q.updatedAt = now.toISOString();
    write(root, q);
    return { inquiry: q, result };
  });
}
