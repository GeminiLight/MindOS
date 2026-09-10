import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { agentLedgerOwnerIdentity } from '../ledger/run-ledger.js';
import {
  PENDING_PROMPT_DB_RELATIVE_PATH,
  finishPendingPrompt,
  getPendingPromptDatabase,
  listOpenPendingPrompts,
  markPendingDecisionConsumed,
  pendingPromptKey,
  prunePendingPromptStore,
  readOpenPendingPrompt,
  readPendingDecisionsForOwner,
  readPendingPromptStoreVersion,
  recordPendingPrompt,
  resetPendingPromptStoreForTest,
  subscribePendingPromptChanges,
  submitPendingPromptDecision,
} from './pending-prompt-store.js';
import type { PendingRuntimePermissionSnapshot } from './runtime-permission-bridge.js';
import type { PendingAskUserQuestionSnapshot } from './user-question-bridge.js';

/**
 * Cross-process pending prompt store (spec-cross-process-run-events B). The
 * store is a plain WAL sqlite file next to the run ledger: prompts recorded by
 * one process are listed by any other, and a decision is first-writer-wins
 * through a single guarded UPDATE.
 */

let root = '';

function permissionSnapshot(overrides: Partial<PendingRuntimePermissionSnapshot> = {}): PendingRuntimePermissionSnapshot {
  return {
    kind: 'runtime-permission',
    runId: 'run-1',
    requestId: 'request-1',
    runtime: 'codex',
    toolCallId: 'tool-1',
    toolName: 'Bash',
    input: { command: 'pnpm test' },
    options: [
      { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
      { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
    ],
    action: 'command',
    resource: 'pnpm test',
    risk: { level: 'medium', summary: 'Runs a command.' },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function questionSnapshot(overrides: Partial<PendingAskUserQuestionSnapshot> = {}): PendingAskUserQuestionSnapshot {
  return {
    kind: 'user-question',
    runId: 'run-2',
    toolCallId: 'question-1',
    questions: [{
      header: 'Release',
      question: 'Ship now?',
      options: [{ label: 'Yes', description: 'Publish the patch.' }],
    }],
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

/** A pid that cannot belong to a live process on any supported platform. */
const DEAD_PID = 2_147_483_000;

describe('pending prompt store', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-pending-prompts-'));
    setMindRootResolverForTests(() => root);
    resetPendingPromptStoreForTest();
  });

  afterEach(() => {
    resetPendingPromptStoreForTest();
    setMindRootResolverForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records a permission prompt and lists it as open with owner and snapshot', () => {
    const snapshot = permissionSnapshot();
    expect(recordPendingPrompt(snapshot)).toBe(true);

    const key = pendingPromptKey(snapshot);
    expect(key).toBe('runtime-permission:run-1:request-1');
    const open = listOpenPendingPrompts(Date.now());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      key,
      kind: 'runtime-permission',
      runId: 'run-1',
      promptId: 'request-1',
      owner: agentLedgerOwnerIdentity(),
    });
    expect(open[0]!.snapshot).toEqual(snapshot);

    const version = readPendingPromptStoreVersion();
    expect(version).toMatchObject({ version: 1, writerPid: process.pid });
  });

  it('records a question prompt under its own key namespace', () => {
    const snapshot = questionSnapshot();
    expect(recordPendingPrompt(snapshot)).toBe(true);
    expect(pendingPromptKey(snapshot)).toBe('user-question:run-2:question-1');
    expect(listOpenPendingPrompts(Date.now())).toEqual([
      expect.objectContaining({ kind: 'user-question', promptId: 'question-1', snapshot }),
    ]);
    expect(readOpenPendingPrompt('user-question:run-2:question-1', Date.now())?.snapshot).toEqual(snapshot);
  });

  it('keeps first-writer-wins: the second decision for the same prompt is refused as resolved', () => {
    recordPendingPrompt(permissionSnapshot());
    const key = 'runtime-permission:run-1:request-1';
    expect(submitPendingPromptDecision(key, { type: 'permission-decision', decision: 'allow-once' }))
      .toEqual({ ok: true });
    expect(submitPendingPromptDecision(key, { type: 'permission-decision', decision: 'deny' }))
      .toEqual({ ok: false, reason: 'resolved' });

    const decisions = readPendingDecisionsForOwner();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ key, decision: { type: 'permission-decision', decision: 'allow-once' } });
  });

  it('refuses a decision for a key that was never recorded', () => {
    expect(submitPendingPromptDecision('runtime-permission:nope:nope', { type: 'permission-decision', decision: 'deny' }))
      .toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a decision whose owner process is dead', () => {
    recordPendingPrompt(permissionSnapshot());
    const db = getPendingPromptDatabase({ create: false })!;
    db.prepare('UPDATE agent_pending_prompts SET owner_pid = ? WHERE key = ?')
      .run(DEAD_PID, 'runtime-permission:run-1:request-1');
    expect(submitPendingPromptDecision('runtime-permission:run-1:request-1', { type: 'permission-decision', decision: 'deny' }))
      .toEqual({ ok: false, reason: 'missing' });
  });

  it('finish marks the prompt resolved so it is no longer open or decidable', () => {
    recordPendingPrompt(permissionSnapshot());
    const key = 'runtime-permission:run-1:request-1';
    expect(finishPendingPrompt(key)).toBe(true);
    expect(listOpenPendingPrompts(Date.now())).toEqual([]);
    expect(readOpenPendingPrompt(key, Date.now())).toBeNull();
    expect(submitPendingPromptDecision(key, { type: 'permission-decision', decision: 'allow-once' }))
      .toEqual({ ok: false, reason: 'resolved' });
    // Finishing twice is a no-op, not an error.
    expect(finishPendingPrompt(key)).toBe(false);
  });

  it('filters rows whose owner process is dead out of the open listing', () => {
    recordPendingPrompt(permissionSnapshot());
    recordPendingPrompt(questionSnapshot());
    const db = getPendingPromptDatabase({ create: false })!;
    db.prepare('UPDATE agent_pending_prompts SET owner_pid = ? WHERE kind = ?')
      .run(DEAD_PID, 'runtime-permission');
    const open = listOpenPendingPrompts(Date.now());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'user-question' });
  });

  it('filters rows whose expiresAt has passed out of the open listing', () => {
    const now = Date.now();
    recordPendingPrompt(permissionSnapshot({ createdAt: now - 120_000, expiresAt: now - 60_000 }));
    expect(listOpenPendingPrompts(now)).toEqual([]);
    // The row is still there for the owner to finish; it is just not offered.
    const db = getPendingPromptDatabase({ create: false })!;
    expect((db.prepare('SELECT count(*) AS n FROM agent_pending_prompts').get() as { n: number }).n).toBe(1);
  });

  it('consumes a decision exactly once', () => {
    recordPendingPrompt(questionSnapshot());
    const key = 'user-question:run-2:question-1';
    submitPendingPromptDecision(key, {
      type: 'question-answers',
      answers: [{ questionIndex: 0, question: 'Ship now?', kind: 'option', answer: 'Yes' }],
    });
    expect(readPendingDecisionsForOwner()).toHaveLength(1);
    markPendingDecisionConsumed(key);
    expect(readPendingDecisionsForOwner()).toEqual([]);
  });

  it('prunes rows resolved or expired more than an hour ago and keeps fresh ones', () => {
    const now = Date.now();
    recordPendingPrompt(permissionSnapshot({ requestId: 'old-resolved' }));
    recordPendingPrompt(permissionSnapshot({ requestId: 'old-expired', expiresAt: now + 60_000 }));
    recordPendingPrompt(permissionSnapshot({ requestId: 'fresh' }));
    finishPendingPrompt('runtime-permission:run-1:old-resolved');
    const db = getPendingPromptDatabase({ create: false })!;
    db.prepare('UPDATE agent_pending_prompts SET resolved_at = ? WHERE key = ?')
      .run(now - 2 * 60 * 60 * 1000, 'runtime-permission:run-1:old-resolved');
    db.prepare('UPDATE agent_pending_prompts SET expires_at = ? WHERE key = ?')
      .run(now - 2 * 60 * 60 * 1000, 'runtime-permission:run-1:old-expired');

    prunePendingPromptStore(now);
    const keys = listOpenPendingPrompts(now).map((row) => row.key);
    expect(keys).toEqual(['runtime-permission:run-1:fresh']);
    expect((db.prepare('SELECT count(*) AS n FROM agent_pending_prompts').get() as { n: number }).n).toBe(1);
  });

  it('notifies subscribers on record, finish, and decisions but not on consumption', () => {
    let calls = 0;
    const unsubscribe = subscribePendingPromptChanges(() => { calls += 1; });
    recordPendingPrompt(permissionSnapshot());
    expect(calls).toBe(1);
    finishPendingPrompt('runtime-permission:run-1:request-1');
    expect(calls).toBe(2);
    recordPendingPrompt(questionSnapshot());
    submitPendingPromptDecision('user-question:run-2:question-1', { type: 'question-cancel', reason: 'user_cancelled' });
    expect(calls).toBe(4);
    markPendingDecisionConsumed('user-question:run-2:question-1');
    expect(calls).toBe(4);
    unsubscribe();
    recordPendingPrompt(permissionSnapshot({ requestId: 'after-unsubscribe' }));
    expect(calls).toBe(4);
  });

  it('read paths never create the database file', () => {
    const file = path.join(fs.realpathSync(root), ...PENDING_PROMPT_DB_RELATIVE_PATH.split('/'));
    expect(listOpenPendingPrompts(Date.now())).toEqual([]);
    expect(readPendingDecisionsForOwner()).toEqual([]);
    expect(readPendingPromptStoreVersion()).toBeNull();
    expect(readOpenPendingPrompt('runtime-permission:a:b', Date.now())).toBeNull();
    expect(submitPendingPromptDecision('runtime-permission:a:b', { type: 'permission-decision', decision: 'deny' }))
      .toEqual({ ok: false, reason: 'missing' });
    expect(finishPendingPrompt('runtime-permission:a:b')).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('skips a corrupt snapshot row without poisoning the listing', () => {
    recordPendingPrompt(permissionSnapshot());
    recordPendingPrompt(questionSnapshot());
    const db = getPendingPromptDatabase({ create: false })!;
    db.prepare('UPDATE agent_pending_prompts SET snapshot_json = ? WHERE kind = ?')
      .run('{oops', 'user-question');
    const open = listOpenPendingPrompts(Date.now());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'runtime-permission' });
    expect(readOpenPendingPrompt('user-question:run-2:question-1', Date.now())).toBeNull();
  });

  it('re-recording a key reopens it as a fresh prompt', () => {
    const snapshot = permissionSnapshot();
    recordPendingPrompt(snapshot);
    finishPendingPrompt('runtime-permission:run-1:request-1');
    recordPendingPrompt(permissionSnapshot({ expiresAt: Date.now() + 30_000 }));
    const row = readOpenPendingPrompt('runtime-permission:run-1:request-1', Date.now());
    expect(row).not.toBeNull();
    expect(row?.resolvedAt).toBeNull();
    expect(row?.decision).toBeNull();
  });
});

describe('pending prompt store without a mind root', () => {
  beforeEach(() => {
    setMindRootResolverForTests(() => '');
    resetPendingPromptStoreForTest();
  });

  afterEach(() => {
    resetPendingPromptStoreForTest();
    setMindRootResolverForTests(null);
  });

  it('falls back to an in-process memory database so prompts keep working', () => {
    expect(recordPendingPrompt(permissionSnapshot())).toBe(true);
    expect(listOpenPendingPrompts(Date.now())).toHaveLength(1);
    expect(submitPendingPromptDecision('runtime-permission:run-1:request-1', { type: 'permission-decision', decision: 'deny' }))
      .toEqual({ ok: true });
  });
});
