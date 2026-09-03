import crypto from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { redactSensitiveText } from '../redaction.js';
import type {
  AgentRunCapsule,
  AgentRunCapsuleProjection,
  AgentRunCapsuleRecoveryClaim,
  AgentRunCapsuleRecoveryPlan,
  CreateAgentRunCapsuleInput,
  CreateAgentRunCapsuleRecoveryPlanInput,
} from './types.js';

const CAPSULES_DIR = '.mindos/agent-run-capsules';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_CAPSULES = 500;
const MAX_INPUT_SUMMARY = 500;
const MAX_IDEMPOTENCY_KEY = 200;
const MAX_CAPSULE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_TEXT = 64 * 1024;

export function createAgentRunCapsule(
  mindRoot: string,
  input: CreateAgentRunCapsuleInput,
): AgentRunCapsule {
  const id = requireSafeId(input.id, 'capsule id');
  requireSafeId(input.runId, 'run id');
  requireSafeId(input.rootRunId, 'root run id');
  if (input.chatSessionId !== undefined) requireSafeId(input.chatSessionId, 'chat session id');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Capsule timestamp must be a valid date.');

  const capsule: AgentRunCapsule = {
    schemaVersion: 1,
    id,
    runId: input.runId,
    rootRunId: input.rootRunId,
    ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
    source: input.source,
    status: input.status ?? 'running',
    request: structuredClone(input.request),
    provenance: structuredClone(input.provenance ?? {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  assertCapsuleShape(capsule);

  const file = capsuleFile(mindRoot, capsule);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!writeJsonExclusive(file, capsule)) {
    throw new Error(`Agent run capsule already exists: ${id}`);
  }
  return capsule;
}

export function getAgentRunCapsule(mindRoot: string, id: string): AgentRunCapsule | null {
  requireSafeId(id, 'capsule id');
  const file = listCapsuleFiles(mindRoot).find((candidate) => path.basename(candidate) === `${id}.json`);
  return file ? readCapsule(file) : null;
}

export function listAgentRunCapsules(mindRoot: string): AgentRunCapsule[] {
  return listCapsuleFiles(mindRoot)
    .map(readCapsule)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_CAPSULES);
}

export function finalizeAgentRunCapsule(
  mindRoot: string,
  id: string,
  input: {
    status: AgentRunCapsule['status'];
    runtimeBinding?: AgentRunCapsule['request']['runtimeBinding'];
    checkpointArtifactId?: string;
    outputText?: string;
    now?: Date;
  },
): AgentRunCapsule {
  requireSafeId(id, 'capsule id');
  const file = findCapsuleFile(mindRoot, id);
  if (!file) throw new Error(`Agent run capsule not found: ${id}`);
  const current = readCapsule(file);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Capsule timestamp must be a valid date.');
  const next: AgentRunCapsule = {
    ...current,
    status: input.status,
    request: input.runtimeBinding !== undefined
      ? { ...current.request, runtimeBinding: structuredClone(input.runtimeBinding) }
      : current.request,
    provenance: input.checkpointArtifactId
      ? { ...current.provenance, checkpointArtifactId: requireSafeId(input.checkpointArtifactId, 'checkpoint artifact id') }
      : current.provenance,
    ...(input.outputText !== undefined
      ? { result: { ...current.result, outputText: input.outputText.slice(0, MAX_OUTPUT_TEXT) } }
      : current.result ? { result: current.result } : {}),
    updatedAt: now.toISOString(),
  };
  writeJsonAtomic(file, next);
  return next;
}

export function createAgentRunCapsuleRecoveryPlan(
  mindRoot: string,
  id: string,
  input: CreateAgentRunCapsuleRecoveryPlanInput,
): AgentRunCapsuleRecoveryPlan {
  const capsule = getAgentRunCapsule(mindRoot, id);
  if (!capsule) throw new Error(`Agent run capsule not found: ${id}`);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new Error(`Recovery idempotency key must contain 1-${MAX_IDEMPOTENCY_KEY} characters.`);
  }
  const planId = recoveryPlanId(idempotencyKey);
  const planFile = recoveryPlanFile(mindRoot, planId);
  if (existsSync(planFile)) {
    const existing = readRecoveryPlan(planFile);
    if (existing.sourceCapsuleId !== capsule.id || existing.action !== input.action) {
      throw new Error('Recovery idempotency key was already used for a different action.');
    }
    return existing;
  }

  const projection = projectAgentRunCapsule(capsule);
  const readiness = projection.recovery[input.action];
  if (!readiness.supported) {
    throw new Error(readiness.reason ?? `Recovery action is not supported: ${input.action}`);
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Recovery timestamp must be a valid date.');
  const request = structuredClone(capsule.request);
  if (input.action === 'retry' || input.action === 'fork') request.runtimeBinding = null;
  const plan: AgentRunCapsuleRecoveryPlan = {
    schemaVersion: 1,
    id: planId,
    sourceCapsuleId: capsule.id,
    action: input.action,
    request,
    ...(input.action !== 'fork' && capsule.chatSessionId
      ? { targetChatSessionId: capsule.chatSessionId }
      : {}),
    ...(input.action === 'rollback' && capsule.provenance.checkpointArtifactId
      ? { checkpointArtifactId: capsule.provenance.checkpointArtifactId }
      : {}),
    createdAt: now.toISOString(),
  };
  mkdirSync(path.dirname(planFile), { recursive: true, mode: 0o700 });
  if (writeJsonExclusive(planFile, plan)) return plan;
  const winner = readRecoveryPlan(planFile);
  if (winner.sourceCapsuleId !== capsule.id || winner.action !== input.action) {
    throw new Error('Recovery idempotency key was already used for a different action.');
  }
  return winner;
}

export function getAgentRunCapsuleRecoveryPlan(
  mindRoot: string,
  planId: string,
): AgentRunCapsuleRecoveryPlan | null {
  requireSafeId(planId, 'recovery plan id');
  const file = recoveryPlanFile(mindRoot, planId);
  return existsSync(file) ? readRecoveryPlan(file) : null;
}

export function claimAgentRunCapsuleRecoveryPlan(
  mindRoot: string,
  planId: string,
  runId: string,
  now = new Date(),
): AgentRunCapsuleRecoveryClaim {
  const plan = getAgentRunCapsuleRecoveryPlan(mindRoot, planId);
  if (!plan) throw new Error(`Agent run recovery plan not found: ${planId}`);
  requireSafeId(runId, 'recovery run id');
  if (Number.isNaN(now.getTime())) throw new Error('Recovery claim timestamp must be a valid date.');
  const claim: AgentRunCapsuleRecoveryClaim = {
    schemaVersion: 1,
    planId: plan.id,
    runId,
    claimedAt: now.toISOString(),
  };
  const file = recoveryClaimFile(mindRoot, plan.id);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (writeJsonExclusive(file, claim)) return claim;
  const existing = readRecoveryClaim(file);
  throw new Error(`Recovery plan was already claimed by run ${existing.runId}.`);
}

export function projectAgentRunCapsule(capsule: AgentRunCapsule): AgentRunCapsuleProjection {
  const resumeSessionId = capsule.request.runtimeBinding?.externalSessionId?.trim();
  const checkpointArtifactId = capsule.provenance.checkpointArtifactId?.trim();
  return {
    schemaVersion: 1,
    id: capsule.id,
    runId: capsule.runId,
    rootRunId: capsule.rootRunId,
    ...(capsule.chatSessionId ? { chatSessionId: capsule.chatSessionId } : {}),
    source: capsule.source,
    status: capsule.status,
    inputSummary: redactForProjection(firstUserMessage(capsule)).slice(0, MAX_INPUT_SUMMARY),
    runtime: { ...capsule.request.runtime },
    ...(capsule.request.model ? { model: capsule.request.model } : {}),
    ...(capsule.request.thinkingEffort ? { thinkingEffort: capsule.request.thinkingEffort } : {}),
    context: {
      ...(capsule.request.context.currentFile
        ? { currentFile: capsule.request.context.currentFile }
        : {}),
      attachedFileCount: capsule.request.context.attachedFiles.length,
      uploadedFileCount: capsule.request.context.uploadedFiles.length,
      receiptIds: [...capsule.request.context.receiptIds],
      assetIds: [...capsule.request.context.assetIds],
    },
    recovery: {
      retry: { supported: true, mode: 'from-start' },
      fork: { supported: true, mode: 'new-session' },
      resume: resumeSessionId
        ? { supported: true, sessionId: resumeSessionId }
        : { supported: false, reason: 'This run has no reusable runtime session.' },
      rollback: checkpointArtifactId
        ? {
            supported: false,
            checkpointArtifactId,
            reason: 'A checkpoint was recorded, but no verified rollback executor is available.',
          }
        : { supported: false, reason: 'This run has no checkpoint artifact.' },
    },
    createdAt: capsule.createdAt,
    updatedAt: capsule.updatedAt,
  };
}

function capsuleFile(mindRoot: string, capsule: AgentRunCapsule): string {
  const createdAt = new Date(capsule.createdAt);
  const relative = path.posix.join(
    CAPSULES_DIR,
    String(createdAt.getUTCFullYear()),
    String(createdAt.getUTCMonth() + 1).padStart(2, '0'),
    `${capsule.id}.json`,
  );
  return resolveExistingSafe(mindRoot, relative);
}

function recoveryPlanId(idempotencyKey: string): string {
  const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  return `recovery-${digest.slice(0, 48)}`;
}

function recoveryPlanFile(mindRoot: string, planId: string): string {
  return resolveExistingSafe(
    mindRoot,
    path.posix.join(CAPSULES_DIR, 'recoveries', `${planId}.json`),
  );
}

function recoveryClaimFile(mindRoot: string, planId: string): string {
  return resolveExistingSafe(
    mindRoot,
    path.posix.join(CAPSULES_DIR, 'claims', `${planId}.json`),
  );
}

function findCapsuleFile(mindRoot: string, id: string): string | undefined {
  return listCapsuleFiles(mindRoot).find((candidate) => path.basename(candidate) === `${id}.json`);
}

function listCapsuleFiles(mindRoot: string): string[] {
  const root = resolveExistingSafe(mindRoot, CAPSULES_DIR);
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const year of safeDirectories(root)) {
    for (const month of safeDirectories(year)) {
      for (const entry of readdirSync(month, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const candidate = path.join(month, entry.name);
        const relative = path.relative(mindRoot, candidate).split(path.sep).join('/');
        files.push(resolveExistingSafe(mindRoot, relative));
      }
    }
  }
  return files;
}

function safeDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2,4}$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

function readCapsule(file: string): AgentRunCapsule {
  try {
    const value = readBoundedJson(file);
    assertCapsuleShape(value);
    return value;
  } catch {
    throw new Error(`Agent run capsule is corrupt; the original file was preserved: ${path.basename(file)}`);
  }
}

function assertCapsuleShape(value: unknown): asserts value is AgentRunCapsule {
  if (!isRecord(value)) throw new Error('invalid capsule shape');
  const request = value.request;
  const provenance = value.provenance;
  if (
    value.schemaVersion !== 1
    || !isSafeId(value.id)
    || !isSafeId(value.runId)
    || !isSafeId(value.rootRunId)
    || (value.chatSessionId !== undefined && !isSafeId(value.chatSessionId))
    || !['interactive', 'automation', 'event', 'recovery'].includes(String(value.source))
    || !['queued', 'running', 'streaming', 'completed', 'failed', 'canceled', 'timed_out'].includes(String(value.status))
    || !isIsoTimestamp(value.createdAt)
    || !isIsoTimestamp(value.updatedAt)
    || !isCapsuleRequest(request)
    || !isRecord(provenance)
    || !isOptionalString(provenance.cwd)
    || !isOptionalString(provenance.gitRevision)
    || !isOptionalString(provenance.checkpointArtifactId)
    || !isOptionalString(provenance.parentCapsuleId)
    || (provenance.recoveryAction !== undefined && !['retry', 'fork', 'resume', 'rollback'].includes(String(provenance.recoveryAction)))
    || (value.result !== undefined && (!isRecord(value.result) || !isOptionalString(value.result.outputText)))
  ) {
    throw new Error('invalid capsule shape');
  }
}

function isCapsuleRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Array.isArray(value.messages)
    && value.messages.every(isRecord)
    && isRuntime(value.runtime)
    && isCapsuleContext(value.context)
    && (value.runtimeBinding === undefined || value.runtimeBinding === null || isRuntimeBinding(value.runtimeBinding))
    && (value.options === undefined || isRecord(value.options))
    && isOptionalString(value.agentMode)
    && isOptionalString(value.permissionMode)
    && isOptionalString(value.model)
    && isOptionalString(value.thinkingEffort);
}

function isRuntime(value: unknown): boolean {
  return isRecord(value)
    && ['mindos', 'acp', 'codex', 'claude'].includes(String(value.kind))
    && typeof value.id === 'string'
    && typeof value.name === 'string';
}

function isRuntimeBinding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['mindos-pi-session', 'codex-thread', 'claude-session', 'acp-session'].includes(String(value.type))
    && ['mindos', 'acp', 'codex', 'claude'].includes(String(value.runtime))
    && typeof value.runtimeId === 'string'
    && isOptionalString(value.externalSessionId)
    && isOptionalString(value.cwd)
    && (value.status === undefined || ['active', 'missing', 'signed-out', 'archived', 'failed'].includes(String(value.status)))
    && (value.updatedAt === undefined || (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)));
}

function isCapsuleContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isOptionalString(value.currentFile)
    && isStringArray(value.attachedFiles)
    && isStringArray(value.receiptIds)
    && isStringArray(value.assetIds)
    && Array.isArray(value.uploadedFiles)
    && value.uploadedFiles.every((file) => (
      isRecord(file)
      && typeof file.name === 'string'
      && typeof file.content === 'string'
      && isOptionalString(file.mimeType)
      && isOptionalString(file.dataBase64)
      && (file.size === undefined || (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0))
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function readRecoveryPlan(file: string): AgentRunCapsuleRecoveryPlan {
  try {
    const value = readBoundedJson(file);
    if (
      !isRecord(value)
      || value.schemaVersion !== 1
      || !isSafeId(value.id)
      || !isSafeId(value.sourceCapsuleId)
      || !['retry', 'fork', 'resume', 'rollback'].includes(String(value.action))
      || !isCapsuleRequest(value.request)
      || (value.targetChatSessionId !== undefined && !isSafeId(value.targetChatSessionId))
      || (value.checkpointArtifactId !== undefined && !isSafeId(value.checkpointArtifactId))
      || !isIsoTimestamp(value.createdAt)
    ) {
      throw new Error('invalid recovery plan shape');
    }
    return value as unknown as AgentRunCapsuleRecoveryPlan;
  } catch {
    throw new Error(`Agent run recovery plan is corrupt; the original file was preserved: ${path.basename(file)}`);
  }
}

function readRecoveryClaim(file: string): AgentRunCapsuleRecoveryClaim {
  try {
    const value = readBoundedJson(file);
    if (
      !isRecord(value)
      || value.schemaVersion !== 1
      || !isSafeId(value.planId)
      || !isSafeId(value.runId)
      || !isIsoTimestamp(value.claimedAt)
    ) {
      throw new Error('invalid recovery claim shape');
    }
    return value as unknown as AgentRunCapsuleRecoveryClaim;
  } catch {
    throw new Error(`Agent run recovery claim is corrupt; the original file was preserved: ${path.basename(file)}`);
  }
}

function readBoundedJson(file: string): unknown {
  if (statSync(file).size > MAX_CAPSULE_BYTES) {
    throw new Error(`stored payload exceeds ${MAX_CAPSULE_BYTES} bytes`);
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as unknown;
}

function writeJsonAtomic(file: string, value: AgentRunCapsule | AgentRunCapsuleRecoveryPlan): void {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, serializeJson(value), { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function writeJsonExclusive(
  file: string,
  value: AgentRunCapsule | AgentRunCapsuleRecoveryPlan | AgentRunCapsuleRecoveryClaim,
): boolean {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, serializeJson(value), { encoding: 'utf-8', mode: 0o600 });
    try {
      linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    return true;
  } finally {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
  }
}

function serializeJson(
  value: AgentRunCapsule | AgentRunCapsuleRecoveryPlan | AgentRunCapsuleRecoveryClaim,
): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_CAPSULE_BYTES) {
    throw new Error(`Agent run capsule payload is too large; the limit is ${MAX_CAPSULE_BYTES} bytes.`);
  }
  return serialized;
}

function requireSafeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function firstUserMessage(capsule: AgentRunCapsule): string {
  for (const message of capsule.request.messages) {
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content.trim();
  }
  return '';
}

function redactForProjection(value: string): string {
  return redactSensitiveText(value)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replaceAll('[redacted]', '[REDACTED]');
}
