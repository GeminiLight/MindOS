import fs from 'node:fs';
import {
  privateRecordNames,
  readPrivateRecord,
  writePrivateRecord,
  withPrivateRecordLock,
} from '../private-records.js';
import {
  LearningError,
  getLearningLoop,
  learningMethodAt,
  prepareLearningMethodTrial,
  learningIdSchema,
} from '../learning/index.js';
import { effectiveMindRoot } from '../../foundation/mind-root/index.js';
import { listKnowledgeAgentRuns } from '../agent-run-data.js';
import { listRetrievalReceipts } from '../../retrieval/receipt.js';
import { methodHandoffPreview, buildMethodHandoff } from './handoff.js';
import {
  assessCheckSchema,
  checkId,
  checkPrompt,
  createCheckSchema,
  fingerprint,
  handoffFingerprint,
  frozenFingerprint,
  methodCheckSchema,
  prepareCheckSchema,
  type MethodCheck,
  type MethodCheckRun,
} from './model.js';
export type {
  MethodCheck,
  MethodCheckKind,
  MethodCheckRun,
  MethodHandoff,
} from './model.js';
function read(root: string, id: string): MethodCheck | null {
  if (!checkId.safeParse(id).success)
    throw new LearningError('invalid', 'Choose a valid method check.');
  const value = readPrivateRecord(root, id + '.json', 2_000_000);
  if (value === null) return null;
  try {
    const record = methodCheckSchema.parse(value);
    if (
      record.id !== id ||
      frozenFingerprint(record) !== record.frozenHash ||
      record.cases[0]!.kind !== 'use' ||
      record.cases[1]!.kind !== 'exception' ||
      record.preparations.some(
        (item) =>
          item.queryHash !==
          fingerprint(checkPrompt(record, item.kind, item.handoffId)),
      ) ||
      record.capturedRuns.some(
        (item) =>
          item.outputHash !== fingerprint(item.output) ||
          (item.handoffId &&
            !record.handoffs?.some(
              (handoff) =>
                handoff.id === item.handoffId &&
                item.targetMatches === (item.runtimeId === handoff.target.id),
            )),
      ) ||
      record.handoffs?.some(
        (item) =>
          item.id !== 'handoff-' + handoffFingerprint(item).slice(0, 24) ||
          fingerprint(item.methodBody) !== record.method.contentHash,
      ) ||
      record.assessments.some(
        (item, index) =>
          item.outputHash !== fingerprint(item.output) ||
          !item.quote.trim() ||
          !item.output.includes(item.quote) ||
          (item.handoffId &&
            !record.handoffs?.some((handoff) => handoff.id === item.handoffId)) ||
          (item.supersedes !== undefined &&
            (item.supersedes >= index ||
              record.assessments[item.supersedes]?.runId !== item.runId)),
      )
    )
      throw new Error('Check integrity mismatch');
    return record;
  } catch {
    throw new LearningError(
      'storage',
      'Could not read this check. Existing data was preserved.',
    );
  }
}
const write = (root: string, record: MethodCheck) =>
  writePrivateRecord(
    root,
    record.id + '.json',
    methodCheckSchema.parse(record),
    2_000_000,
  );
function requireVersion(
  record: MethodCheck | null,
  version: number,
  now: Date,
): asserts record is MethodCheck {
  if (!record) throw new LearningError('not-found', 'Method check not found.');
  if (
    record.version !== version ||
    now.getTime() < Date.parse(record.updatedAt)
  )
    throw new LearningError(
      'conflict',
      'This check changed. Reload before saving.',
    );
}
export function listMethodChecks(
  root: string,
  learningId: string,
  attemptIndex: number,
  revisionIndex: number,
) {
  if (
    !learningIdSchema.safeParse(learningId).success ||
    !Number.isSafeInteger(attemptIndex) ||
    attemptIndex < -1 ||
    !Number.isSafeInteger(revisionIndex) ||
    revisionIndex < 0
  )
    throw new LearningError('invalid', 'Choose a method version.');
  const checks: MethodCheck[] = [];
  let unavailableCount = 0;
  for (const name of privateRecordNames(root)) {
    if (!/^methodcheck-[a-f0-9]{24}\.json$/.test(name)) continue;
    try {
      const record = read(root, name.slice(0, -5));
      if (
        record &&
        record.learningId === learningId &&
        record.attemptIndex === attemptIndex &&
        record.revisionIndex === revisionIndex
      )
        checks.push(record);
    } catch {
      unavailableCount++;
    }
  }
  return {
    checks: checks.sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    ),
    unavailableCount,
  };
}
export function createMethodCheck(
  root: string,
  input: unknown,
  now = new Date(),
): MethodCheck {
  const parsed = createCheckSchema.safeParse(input);
  if (!parsed.success)
    throw new LearningError(
      'invalid',
      'Provide two different situations and the criterion for each.',
    );
  const command = parsed.data;
  return withPrivateRecordLock(root, () => {
    const trial = prepareLearningMethodTrial(
      root,
      command.learningId,
      command.attemptIndex,
      command.version,
      command.revisionIndex,
    );
    const loop = getLearningLoop(root, command.learningId)!;
    const method = learningMethodAt(
      loop,
      command.attemptIndex,
      command.revisionIndex,
    )!;
    const frozen = {
      learningId: loop.id,
      attemptIndex: command.attemptIndex,
      revisionIndex: command.revisionIndex,
      locale: command.locale,
      method: {
        ...trial,
        behavior: method.behavior,
        scope: method.scope,
        check: method.check,
      },
      cases: [
        {
          kind: 'use' as const,
          task: command.useTask,
          expected: command.useExpected,
        },
        {
          kind: 'exception' as const,
          task: command.exceptionTask,
          expected: command.exceptionExpected,
        },
      ],
    };
    // Normalize key order before hashing, including data loaded through the schema on later reads.
    const normalized = methodCheckSchema
      .pick({ method: true, cases: true })
      .parse(frozen);
    const frozenHash = frozenFingerprint({ ...frozen, ...normalized });
    const id = 'methodcheck-' + frozenHash.slice(0, 24);
    const existing = read(root, id);
    if (existing) return existing;
    if (
      listMethodChecks(
        root,
        loop.id,
        command.attemptIndex,
        command.revisionIndex,
      ).checks.length >= 50
    )
      throw new LearningError(
        'conflict',
        'This method already has fifty checks.',
      );
    const record: MethodCheck = {
      ...frozen,
      ...normalized,
      id,
      schemaVersion: 1,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      frozenHash,
      preparations: [],
      assessments: [],
      capturedRuns: [],
    };
    write(root, record);
    return record;
  });
}
export function prepareMethodCheck(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = prepareCheckSchema.safeParse(input);
  if (!parsed.success) throw new LearningError('invalid', 'Choose a case.');
  return withPrivateRecordLock(root, () => {
    const record = read(root, id);
    requireVersion(record, parsed.data.version, now);
    const loop = getLearningLoop(root, record.learningId);
    if (!loop)
      throw new LearningError('not-found', 'The source method is unavailable.');
    const trial = prepareLearningMethodTrial(
      root,
      loop.id,
      record.attemptIndex,
      loop.version,
      record.revisionIndex,
    );
    if (
      trial.assetId !== record.method.assetId ||
      trial.contentHash !== record.method.contentHash ||
      record.preparations.length >= 20
    )
      throw new LearningError(
        'conflict',
        'This frozen method is unavailable or the preparation limit was reached.',
      );
    const handoff = parsed.data.handoffId
      ? record.handoffs?.find((item) => item.id === parsed.data.handoffId)
      : undefined;
    if (
      parsed.data.handoffId &&
      (!handoff || handoff.assetVersion !== trial.assetVersion)
    )
      throw new LearningError(
        'conflict',
        'This handoff is unavailable or its method version changed.',
      );
    const prompt = checkPrompt(record, parsed.data.kind, handoff?.id);
    const previous = [...record.preparations]
      .reverse()
      .find(
        (item) =>
          item.kind === parsed.data.kind &&
          item.handoffId === handoff?.id &&
          item.assetVersion === trial.assetVersion,
      );
    const runs = methodCheckRuns(root, record).filter(
      (run) => run.kind === parsed.data.kind && run.handoffId === handoff?.id,
    );
    if (
      runs.some(
        (run) =>
          run.source === 'live' &&
          ['queued', 'running', 'streaming'].includes(run.status),
      )
    )
      throw new LearningError('conflict', 'This case still has an active run.');
    if (
      previous &&
      !runs.some((run) => run.startedAt >= Date.parse(previous.preparedAt))
    )
      return {
        check: record,
        draft: {
          prompt,
          path: trial.path,
          title: trial.title,
          assetVersion: trial.assetVersion,
          ...(handoff ? { runtime: handoff.target } : {}),
        },
      };
    record.preparations.push({
      kind: parsed.data.kind,
      ...(handoff ? { handoffId: handoff.id } : {}),
      preparedAt: now.toISOString(),
      queryHash: fingerprint(prompt),
      assetVersion: trial.assetVersion,
    });
    record.version++;
    record.updatedAt = now.toISOString();
    write(root, record);
    return {
      check: record,
      draft: {
        prompt,
        path: trial.path,
        title: trial.title,
        assetVersion: trial.assetVersion,
        ...(handoff ? { runtime: handoff.target } : {}),
      },
    };
  });
}
export function methodCheckRuns(
  root: string,
  record: MethodCheck,
): MethodCheckRun[] {
  if (fs.realpathSync(root) !== fs.realpathSync(effectiveMindRoot()))
    throw new LearningError(
      'conflict',
      'Open the corresponding knowledge base before inspecting runs.',
    );
  const receipts = listRetrievalReceipts(root, {
    outcome: 'selected',
    assetId: record.method.assetId,
    limit: 500,
  });
  const live: MethodCheckRun[] = listKnowledgeAgentRuns({ limit: 1000 }).flatMap(
    (run) => {
      const ids = [
        run.metadata?.retrievalReceiptId,
        ...(Array.isArray(run.metadata?.retrievalReceiptIds)
          ? run.metadata.retrievalReceiptIds
          : []),
      ];
      const receipt = receipts.find(
        (item) =>
          ids.includes(item.id) &&
          record.preparations.some(
            (prep) =>
              prep.queryHash === item.queryHash &&
              prep.preparedAt <= item.startedAt &&
              item.selections.some(
                (selection) =>
                  selection.assetId === record.method.assetId &&
                  selection.contentHash === record.method.contentHash &&
                  selection.assetVersion === prep.assetVersion &&
                  !selection.truncated,
              ),
          ),
      );
      if (!receipt) return [];
      const prep = [...record.preparations]
        .reverse()
        .find(
          (item) =>
            item.queryHash === receipt.queryHash &&
            item.preparedAt <= receipt.startedAt,
        )!;
      return [
        {
          kind: prep.kind,
          ...(prep.handoffId
            ? {
                handoffId: prep.handoffId,
                targetMatches:
                  run.runtimeId ===
                  record.handoffs!.find((item) => item.id === prep.handoffId)!
                    .target.id,
              }
            : {}),
          runId: run.id,
          receiptId: receipt.id,
          status: run.status,
          output: run.outputSummary ?? '',
          error: run.error,
          runtimeId: run.runtimeId,
          model:
            typeof run.metadata?.model === 'string'
              ? run.metadata.model
              : undefined,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          capturedAt: new Date().toISOString(),
          outputHash: fingerprint(run.outputSummary ?? ''),
          source: 'live' as const,
        },
      ];
    },
  );
  const merged = new Map<string, MethodCheckRun>(
    record.capturedRuns.map((run) => [run.runId, { ...run, source: 'saved' }]),
  );
  // An assessment already commits an output snapshot; it must remain usable
  // even when the user did not separately capture the recent run list.
  for (const item of record.assessments) {
    if ((merged.get(item.runId)?.capturedAt ?? '') > item.recordedAt) continue;
    const handoff = record.handoffs?.find((handoff) => handoff.id === item.handoffId);
    merged.set(item.runId, {
      kind: item.kind,
      runId: item.runId,
      receiptId: item.receiptId,
      status: 'completed',
      output: item.output,
      runtimeId: item.runtimeId,
      model: item.model,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      capturedAt: item.recordedAt,
      outputHash: item.outputHash,
      source: 'saved',
      ...(handoff
        ? { handoffId: handoff.id, targetMatches: item.runtimeId === handoff.target.id }
        : {}),
    });
  }
  for (const run of live) merged.set(run.runId, run);
  return [...merged.values()].sort(
    (a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId),
  );
}
export function captureMethodCheck(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
): MethodCheck {
  const version = (input as { version?: unknown })?.version;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new LearningError('invalid', 'Reload this check before saving runs.');
  return withPrivateRecordLock(root, () => {
    const record = read(root, id);
    requireVersion(record, version, now);
    const runs = methodCheckRuns(root, record);
    if (runs.length > 40)
      throw new LearningError(
        'conflict',
        'This check has too many runs to capture. Existing records were preserved.',
      );
    record.capturedRuns = runs.map(({ source, ...run }) => run);
    record.version++;
    record.updatedAt = now.toISOString();
    write(root, record);
    return record;
  });
}
export function getMethodCheck(root: string, id: string) {
  const check = read(root, id);
  return check ? { check, runs: methodCheckRuns(root, check) } : null;
}
export function assessMethodCheck(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
): MethodCheck {
  const parsed = assessCheckSchema.safeParse(input);
  if (!parsed.success)
    throw new LearningError(
      'invalid',
      'Choose an outcome, quote its output and explain your judgment.',
    );
  return withPrivateRecordLock(root, () => {
    const record = read(root, id);
    requireVersion(record, parsed.data.version, now);
    const command = parsed.data;
    const run = methodCheckRuns(root, record).find(
      (item) => item.runId === command.runId && item.kind === command.kind,
    );
    if (
      !run ||
      run.status !== 'completed' ||
      run.error ||
      !run.completedAt ||
      !run.output.includes(command.quote) ||
      record.assessments.length >= 40
    )
      throw new LearningError(
        'invalid',
        'Choose a completed run and quote text from its saved output.',
      );
    const priorIndex = record.assessments
      .map((item) => item.runId)
      .lastIndexOf(command.runId);
    const prior = record.assessments[priorIndex];
    if (
      prior &&
      prior.outcome === command.outcome &&
      prior.quote === command.quote &&
      prior.reason === command.reason
    )
      throw new LearningError('conflict', 'This assessment is already saved.');
    record.assessments.push({
      ...(priorIndex >= 0 ? { supersedes: priorIndex } : {}),
      kind: command.kind,
      ...(run.handoffId ? { handoffId: run.handoffId } : {}),
      runId: run.runId,
      receiptId: run.receiptId,
      runtimeId: run.runtimeId,
      model: run.model,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      output: run.output,
      outputHash: fingerprint(run.output),
      outcome: command.outcome,
      quote: command.quote,
      reason: command.reason,
      recordedAt: now.toISOString(),
    });
    record.version++;
    record.updatedAt = now.toISOString();
    write(root, record);
    return record;
  });
}

export function previewMethodHandoff(root: string, id: string) {
  const record = read(root, id);
  if (!record) throw new LearningError('not-found', 'Method check not found.');
  return methodHandoffPreview(root, record);
}

export function createMethodHandoff(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  const version = (input as { version?: unknown })?.version;
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new LearningError('invalid', 'Reload before saving a handoff.');
  return withPrivateRecordLock(root, () => {
    const record = read(root, id);
    requireVersion(record, version, now);
    const handoff = buildMethodHandoff(
      root,
      record,
      methodCheckRuns(root, record),
      input,
      now,
    );
    if (record.handoffs?.some((item) => item.id === handoff.id)) return record;
    if ((record.handoffs?.length ?? 0) >= 5)
      throw new LearningError(
        'conflict',
        'This check has reached its handoff limit. Existing records remain available.',
      );
    (record.handoffs ??= []).push(handoff);
    record.version++;
    record.updatedAt = now.toISOString();
    write(root, record);
    return record;
  });
}
