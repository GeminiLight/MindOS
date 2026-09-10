import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  finishPendingPrompt,
  getPendingPromptDatabase,
  pendingPromptKey,
  readPendingDecisionsForOwner,
  recordPendingPrompt,
  resetPendingPromptStoreForTest,
  submitPendingPromptDecision,
} from './pending-prompt-store.js';
import { drainPendingDecisionsOnce } from './pending-prompt-changes.js';
import {
  answerAskUserQuestionOrForward,
  cancelAskUserQuestionOrForward,
  resolveRuntimePermissionOrForward,
} from './pending-prompt-resolution.js';
import {
  requestRuntimePermissionForRun,
  runWithRuntimePermissionBridge,
  type PendingRuntimePermissionSnapshot,
} from './runtime-permission-bridge.js';
import {
  askUserQuestionViaBridge,
  runWithAskUserQuestionBridge,
  type PendingAskUserQuestionSnapshot,
} from './user-question-bridge.js';

/**
 * Cross-process resolution (spec-cross-process-run-events C): a decision
 * submitted to a process that does NOT hold the prompt is validated against
 * the persisted snapshot and forwarded through the store; the owning process
 * drains it into the original bridge promise. First-writer-wins lives in the
 * store; these tests cover the validation and forwarding seams.
 */

let root = '';

const PERMISSION_SNAPSHOT: PendingRuntimePermissionSnapshot = {
  kind: 'runtime-permission',
  runId: 'foreign-run',
  requestId: 'foreign-request',
  runtime: 'codex',
  toolCallId: 'tool-f',
  toolName: 'Bash',
  options: [
    { id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' },
    { id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' },
  ],
  action: 'command',
  resource: 'pnpm test',
  risk: { level: 'medium', summary: 'Runs a command.' },
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};

const QUESTION_SNAPSHOT: PendingAskUserQuestionSnapshot = {
  kind: 'user-question',
  runId: 'foreign-run',
  toolCallId: 'question-f',
  questions: [{
    header: 'Release',
    question: 'Ship now?',
    options: [{ label: 'Yes', description: 'Publish.' }, { label: 'No', description: 'Hold.' }],
  }],
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};

describe('pending prompt resolution', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-prompt-resolution-'));
    setMindRootResolverForTests(() => root);
    resetPendingPromptStoreForTest();
  });

  afterEach(() => {
    resetPendingPromptStoreForTest();
    setMindRootResolverForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a locally held permission through the original path without forwarding', async () => {
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'local-run', send, timeoutMs: 30_000 }, async () => {
      const pending = requestRuntimePermissionForRun('local-run', {
        runtime: 'codex',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        options: [{ id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' }],
      }, { requestId: 'request-1' });
      // Let the enqueue settle so the store row exists before resolving.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = resolveRuntimePermissionOrForward({ runId: 'local-run', requestId: 'request-1', decision: 'allow-once' });
      expect(result).toEqual({ ok: true });
      return pending;
    });
    await expect(promise).resolves.toMatchObject({ decision: 'allow-once', cancelled: false });
  });

  it('forwards a decision for a prompt held by another live process', () => {
    recordPendingPrompt(PERMISSION_SNAPSHOT);
    const result = resolveRuntimePermissionOrForward({
      runId: 'foreign-run',
      requestId: 'foreign-request',
      decision: 'allow-once',
    });
    expect(result).toEqual({ ok: true, forwarded: true });
    const decisions = readPendingDecisionsForOwner();
    expect(decisions).toEqual([expect.objectContaining({
      key: pendingPromptKey(PERMISSION_SNAPSHOT),
      decision: { type: 'permission-decision', decision: 'allow-once' },
    })]);
  });

  it('rejects a forwarded decision that is not one of the snapshot options', () => {
    recordPendingPrompt(PERMISSION_SNAPSHOT);
    expect(resolveRuntimePermissionOrForward({
      runId: 'foreign-run',
      requestId: 'foreign-request',
      decision: 'allow-always',
    })).toEqual({ ok: false, status: 400, error: 'Permission decision is not valid for this request.' });
    // Nothing was persisted, so the owner can still decide.
    expect(readPendingDecisionsForOwner()).toEqual([]);
  });

  it('accepts cancel for any forwarded permission prompt', () => {
    recordPendingPrompt(PERMISSION_SNAPSHOT);
    expect(resolveRuntimePermissionOrForward({
      runId: 'foreign-run',
      requestId: 'foreign-request',
      decision: 'cancel',
    })).toEqual({ ok: true, forwarded: true });
  });

  it('answers 404 with the original message when the stored prompt is already resolved', () => {
    recordPendingPrompt(PERMISSION_SNAPSHOT);
    finishPendingPrompt(pendingPromptKey(PERMISSION_SNAPSHOT));
    expect(resolveRuntimePermissionOrForward({
      runId: 'foreign-run',
      requestId: 'foreign-request',
      decision: 'allow-once',
    })).toEqual({ ok: false, status: 404, error: 'Permission request is no longer pending.' });
  });

  it('answers 404 when the prompt owner process is dead', () => {
    recordPendingPrompt(PERMISSION_SNAPSHOT);
    const db = getPendingPromptDatabase({ create: false })!;
    db.prepare('UPDATE agent_pending_prompts SET owner_pid = ?').run(2_147_483_000);
    expect(resolveRuntimePermissionOrForward({
      runId: 'foreign-run',
      requestId: 'foreign-request',
      decision: 'allow-once',
    })).toEqual({ ok: false, status: 404, error: 'Permission request is no longer pending.' });
  });

  it('validates forwarded question answers against the snapshot questions', () => {
    recordPendingPrompt(QUESTION_SNAPSHOT);
    expect(answerAskUserQuestionOrForward({
      runId: 'foreign-run',
      toolCallId: 'question-f',
      answers: [{ questionIndex: 0, question: 'Wrong text?', kind: 'option', answer: 'Yes' }],
    })).toEqual({ ok: false, status: 400, error: 'Answer question text does not match the pending question.' });

    expect(answerAskUserQuestionOrForward({
      runId: 'foreign-run',
      toolCallId: 'question-f',
      answers: [{ questionIndex: 0, question: 'Ship now?', kind: 'option', answer: 'Maybe' }],
    })).toEqual({ ok: false, status: 400, error: 'Selected option is not valid for this question.' });

    expect(answerAskUserQuestionOrForward({
      runId: 'foreign-run',
      toolCallId: 'question-f',
      answers: [{ questionIndex: 0, question: 'Ship now?', kind: 'option', answer: 'Yes' }],
    })).toEqual({ ok: true, forwarded: true });
  });

  it('forwards a question cancel', () => {
    recordPendingPrompt(QUESTION_SNAPSHOT);
    expect(cancelAskUserQuestionOrForward({ runId: 'foreign-run', toolCallId: 'question-f', reason: 'user_cancelled' }))
      .toEqual({ ok: true, forwarded: true });
    expect(readPendingDecisionsForOwner()).toEqual([expect.objectContaining({
      decision: { type: 'question-cancel', reason: 'user_cancelled' },
    })]);
  });

  it('answers 404 for a question nobody recorded', () => {
    expect(answerAskUserQuestionOrForward({
      runId: 'ghost-run',
      toolCallId: 'ghost-question',
      answers: [{ questionIndex: 0, question: 'Ship now?', kind: 'option', answer: 'Yes' }],
    })).toEqual({ ok: false, status: 404, error: 'Question is no longer pending.' });
    expect(cancelAskUserQuestionOrForward({ runId: 'ghost-run', toolCallId: 'ghost-question' }))
      .toEqual({ ok: false, status: 404, error: 'Question is no longer pending.' });
  });
});

describe('pending decision drain (owner side)', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-prompt-drain-'));
    setMindRootResolverForTests(() => root);
    resetPendingPromptStoreForTest();
  });

  afterEach(() => {
    resetPendingPromptStoreForTest();
    setMindRootResolverForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves the owning permission promise within ~1s of a forwarded decision', async () => {
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'owner-run', send, timeoutMs: 30_000 }, async () => {
      const pending = requestRuntimePermissionForRun('owner-run', {
        runtime: 'codex',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        options: [{ id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' }],
      }, { requestId: 'request-1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Simulate the foreign process submitting its decision through the store.
      const submitted = submitPendingPromptDecision('runtime-permission:owner-run:request-1', {
        type: 'permission-decision',
        decision: 'allow-once',
      });
      expect(submitted).toEqual({ ok: true });
      const startedAt = Date.now();
      const result = await pending;
      expect(Date.now() - startedAt).toBeLessThanOrEqual(1_500);
      return result;
    });
    await expect(promise).resolves.toMatchObject({ decision: 'allow-once', cancelled: false });
    // The drain consumed the decision and the local finish marked the row resolved.
    expect(readPendingDecisionsForOwner()).toEqual([]);
  });

  it('resolves the owning question promise from forwarded answers', async () => {
    const send = vi.fn();
    const promise = runWithAskUserQuestionBridge({ runId: 'owner-question-run', send, timeoutMs: 30_000 }, async () => {
      const pending = askUserQuestionViaBridge({
        toolCallId: 'question-1',
        params: {
          questions: [{
            header: 'Release',
            question: 'Ship now?',
            options: [{ label: 'Yes', description: 'Publish.' }],
          }],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const forwarded = answerAskUserQuestionOrForward({
        runId: 'owner-question-run',
        toolCallId: 'question-1',
        answers: [{ questionIndex: 0, question: 'Ship now?', kind: 'option', answer: 'Yes' }],
      });
      // Same process holds the prompt, so the local map wins and no forward happens.
      expect(forwarded).toEqual({ ok: true });
      return pending;
    });
    await expect(promise).resolves.toMatchObject({
      cancelled: false,
      answers: [expect.objectContaining({ answer: 'Yes' })],
    });
  });

  it('drains a submitted cancel into the owning question promise', async () => {
    const send = vi.fn();
    const promise = runWithAskUserQuestionBridge({ runId: 'drain-cancel-run', send, timeoutMs: 30_000 }, async () => {
      const pending = askUserQuestionViaBridge({
        toolCallId: 'question-1',
        params: {
          questions: [{ header: 'Mode', question: 'Choose mode', options: [{ label: 'Safe', description: '' }] }],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(submitPendingPromptDecision('user-question:drain-cancel-run:question-1', {
        type: 'question-cancel',
        reason: 'user_cancelled',
      })).toEqual({ ok: true });
      drainPendingDecisionsOnce();
      return pending;
    });
    await expect(promise).resolves.toMatchObject({ cancelled: true });
    expect(readPendingDecisionsForOwner()).toEqual([]);
  });

  it('consumes a decision whose local prompt already finished without retrying forever', async () => {
    const send = vi.fn();
    await runWithRuntimePermissionBridge({ runId: 'gone-run', send, timeoutMs: 30_000 }, async () => {
      const pending = requestRuntimePermissionForRun('gone-run', {
        runtime: 'codex',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        options: [{ id: 'deny', label: 'Deny', intent: 'deny', scope: 'once' }],
      }, { requestId: 'request-1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // A foreign decision lands, but the owner resolves locally first.
      expect(submitPendingPromptDecision('runtime-permission:gone-run:request-1', {
        type: 'permission-decision',
        decision: 'deny',
      })).toEqual({ ok: true });
      expect(resolveRuntimePermissionOrForward({ runId: 'gone-run', requestId: 'request-1', decision: 'deny' }))
        .toEqual({ ok: true });
      // The drain finds the still-unconsumed decision, gets a local 404 and
      // consumes it instead of retrying every tick.
      drainPendingDecisionsOnce();
      expect(readPendingDecisionsForOwner()).toEqual([]);
      drainPendingDecisionsOnce();
      return pending;
    });
  });
});
