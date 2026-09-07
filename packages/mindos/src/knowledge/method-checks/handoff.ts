import fs from 'node:fs';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  getLearningLoop,
  learningMethodAt,
  prepareLearningMethodTrial,
  LearningError,
} from '../learning/index.js';
import {
  createHandoffSchema,
  handoffSchema,
  handoffFingerprint,
  fingerprint,
  type MethodCheck,
  type MethodCheckRun,
  type MethodHandoff,
} from './model.js';

export function methodHandoffPreview(root: string, record: MethodCheck) {
  const loop = getLearningLoop(root, record.learningId);
  if (!loop)
    throw new LearningError('not-found', 'The original method is unavailable.');
  const trial = prepareLearningMethodTrial(
    root,
    loop.id,
    record.attemptIndex,
    loop.version,
    record.revisionIndex,
  );
  if (
    trial.assetId !== record.method.assetId ||
    trial.contentHash !== record.method.contentHash
  )
    throw new LearningError('conflict', 'The approved method changed.');
  const file = resolveExistingSafe(root, trial.path);
  if (fs.statSync(file).size > 64_000)
    throw new LearningError(
      'invalid',
      'This method is too large to preview for handoff.',
    );
  const methodBody = fs.readFileSync(file, 'utf8');
  if (
    methodBody.length > 16000 ||
    fingerprint(methodBody) !== trial.contentHash
  )
    throw new LearningError(
      'conflict',
      'The approved method changed or is too large.',
    );
  const method = learningMethodAt(
    loop,
    record.attemptIndex,
    record.revisionIndex,
  )!;
  const counterexamples = (method.counterexamples ?? []).map((item) => ({
    id: fingerprint(
      JSON.stringify({
        observation: item.observation,
        recordedAt: item.recordedAt,
      }),
    ),
    observation: item.observation,
    recordedAt: item.recordedAt,
  }));
  const preview = {
    methodBody,
    counterexamples,
    assetVersion: trial.assetVersion,
  };
  return { ...preview, previewHash: fingerprint(JSON.stringify(preview)) };
}

export function buildMethodHandoff(
  root: string,
  record: MethodCheck,
  runs: MethodCheckRun[],
  input: unknown,
  now: Date,
): MethodHandoff {
  const parsed = createHandoffSchema.safeParse(input);
  if (!parsed.success)
    throw new LearningError(
      'invalid',
      'Choose the receiving Agent and the material to hand over.',
    );
  const command = parsed.data;
  const source = runs.find((item) => item.runId === command.sourceRunId);
  if (
    !source ||
    source.status !== 'completed' ||
    source.error ||
    !source.output.trim() ||
    source.runtimeId === command.target.id
  )
    throw new LearningError(
      'invalid',
      'Choose a completed source run and a different receiving Agent.',
    );
  const preview = methodHandoffPreview(root, record);
  if (preview.previewHash !== command.previewHash)
    throw new LearningError(
      'conflict',
      'The preview changed. Review the material again.',
    );
  const counterexamples = command.counterexampleIds.map((id) =>
    preview.counterexamples.find((item) => item.id === id),
  );
  if (counterexamples.some((item) => !item))
    throw new LearningError(
      'invalid',
      'Choose a counterexample from the current preview.',
    );
  const normalized = handoffSchema
    .omit({ id: true, createdAt: true })
    .parse({
      source: {
        runId: source.runId,
        runtimeId: source.runtimeId,
        outputHash: source.outputHash,
      },
      target: command.target,
      rationale: command.rationale,
      assetVersion: preview.assetVersion,
      methodBody: preview.methodBody,
      counterexamples,
    });
  return {
    ...normalized,
    id: 'handoff-' + handoffFingerprint(normalized).slice(0, 24),
    createdAt: now.toISOString(),
  };
}
