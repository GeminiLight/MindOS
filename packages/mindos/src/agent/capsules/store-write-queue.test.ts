import fs, { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import {
  createAgentRunCapsule,
  finalizeAgentRunCapsule,
  flushAllCapsuleWrites,
  flushCapsuleWrites,
  getAgentRunCapsule,
  listAgentRunCapsules,
  writePendingCapsuleWritesSync,
} from './store.js';

let mindRoot = '';

function capsuleInput(overrides: Record<string, unknown> = {}) {
  const input = {
    id: 'capsule-run-1',
    runId: 'run-1',
    rootRunId: 'run-1',
    chatSessionId: 'chat-1',
    source: 'interactive' as const,
    status: 'running' as const,
    request: {
      messages: [{ role: 'user', content: 'Review deployment' }],
      runtime: { kind: 'codex' as const, id: 'codex', name: 'Codex' },
      runtimeBinding: {
        type: 'codex-thread' as const,
        runtime: 'codex' as const,
        runtimeId: 'codex',
        externalSessionId: 'thread-1',
      },
      agentMode: 'default',
      permissionMode: 'ask',
      context: {
        attachedFiles: [],
        uploadedFiles: [],
        receiptIds: [],
        assetIds: [],
      },
    },
    provenance: { cwd: '/tmp/project' },
    now: new Date('2026-09-03T10:00:00.000Z'),
  };
  return { ...input, ...overrides };
}

function storedPath(id: string): string {
  return join(mindRoot, '.mindos', 'agent-run-capsules', '2026', '09', `${id}.json`);
}

describe('agent run capsule async write queue', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-capsule-queue-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await flushAllCapsuleWrites().catch(() => {});
    closeAllMindosDatabases();
    rmSync(mindRoot, { recursive: true, force: true });
  });

  it('lands a tiny stub synchronously while the full payload write is queued', () => {
    const capsule = createAgentRunCapsule(mindRoot, capsuleInput());
    expect(capsule).toMatchObject({ id: 'capsule-run-1', status: 'running' });
    // The synchronous stub is a schema-valid capsule with an empty transcript;
    // queued jobs cannot run inside this block, so the full payload is not on
    // disk yet — but same-process reads already see it via the overlay.
    const stub = JSON.parse(readFileSync(storedPath('capsule-run-1'), 'utf-8'));
    expect(stub.id).toBe('capsule-run-1');
    expect(stub.request.messages).toEqual([]);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toEqual(capsule);
    expect(listAgentRunCapsules(mindRoot)).toEqual([capsule]);
  });

  it('fails finalize and cancels the queued write when the capsule is deleted mid-run', async () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    // Simulate the capsule being deleted behind the store's back before the
    // queued full write lands (lane-runner degrades to CAPSULE_FINALIZE_FAILED).
    rmSync(storedPath('capsule-run-1'));
    expect(() => finalizeAgentRunCapsule(mindRoot, 'capsule-run-1', { status: 'completed' }))
      .toThrow(/not found/i);
    await flushCapsuleWrites('capsule-run-1');
    // The cancelled in-flight write must not resurrect the capsule.
    expect(existsSync(storedPath('capsule-run-1'))).toBe(false);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toBeNull();
    expect(listAgentRunCapsules(mindRoot)).toEqual([]);
  });

  it('lands the queued write byte-identical to the old synchronous format on flush', async () => {
    const capsule = createAgentRunCapsule(mindRoot, capsuleInput());
    await flushCapsuleWrites('capsule-run-1');

    const raw = readFileSync(storedPath('capsule-run-1'), 'utf-8');
    expect(raw).toBe(`${JSON.stringify(capsule, null, 2)}\n`);
    expect(JSON.parse(raw)).toEqual(capsule);
    if (process.platform !== 'win32') {
      expect(fs.statSync(storedPath('capsule-run-1')).mode & 0o777).toBe(0o600);
    }
    // After landing, reads come from disk/cache and stay identical.
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toEqual(capsule);
    expect(listAgentRunCapsules(mindRoot)).toEqual([capsule]);
  });

  it('defers reading a large transcript until the queued write is flushed', async () => {
    // Observe transcript traversal directly: a wall-clock threshold also measures
    // scheduling pauses from other test workers, and cannot prove work was deferred.
    let contentReads = 0;
    const messages = Array.from({ length: 100 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      get content() {
        contentReads += 1;
        return `message ${index}: ${'lorem ipsum dolor sit amet '.repeat(Math.round((60 * 1024) / 26))}`;
      },
    }));
    const base = capsuleInput();
    createAgentRunCapsule(mindRoot, capsuleInput({
      request: { ...base.request, messages },
    }));
    expect(contentReads).toBe(0);
    const stub = readFileSync(storedPath('capsule-run-1'), 'utf-8');
    expect(Buffer.byteLength(stub)).toBeLessThan(4096);
    expect(JSON.parse(stub).request.messages).toEqual([]);

    await flushCapsuleWrites('capsule-run-1');
    expect(contentReads).toBeGreaterThan(0);
    const stored = JSON.parse(readFileSync(storedPath('capsule-run-1'), 'utf-8'));
    expect(stored.request.messages).toEqual(messages);
  });

  it('serializes finalize behind the pending create on the same run chain', async () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    const finalized = finalizeAgentRunCapsule(mindRoot, 'capsule-run-1', {
      status: 'completed',
      outputText: 'native ok',
      now: new Date('2026-09-03T10:05:00.000Z'),
    });
    expect(finalized.status).toBe('completed');
    // Overlay serves the finalized state even though neither write has landed.
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toEqual(finalized);

    await flushCapsuleWrites('capsule-run-1');
    expect(JSON.parse(readFileSync(storedPath('capsule-run-1'), 'utf-8'))).toEqual(finalized);
  });

  it('rejects a duplicate id synchronously both while pending and after landing', async () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    expect(() => createAgentRunCapsule(mindRoot, capsuleInput())).toThrow(/already exists/i);

    await flushCapsuleWrites('capsule-run-1');
    expect(() => createAgentRunCapsule(mindRoot, capsuleInput())).toThrow(/already exists/i);
  });

  it('surfaces an oversized payload as a flush rejection instead of a synchronous throw', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = capsuleInput();
    const capsule = createAgentRunCapsule(mindRoot, capsuleInput({
      request: {
        ...base.request,
        messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }],
      },
    }));
    expect(capsule.id).toBe('capsule-run-1');
    // The failed write removes the overlay entry so the capsule is never listed.
    await expect(flushCapsuleWrites('capsule-run-1')).rejects.toThrow(/payload is too large/i);
    expect(listAgentRunCapsules(mindRoot)).toEqual([]);
    expect(getAgentRunCapsule(mindRoot, 'capsule-run-1')).toBeNull();
    expect(existsSync(storedPath('capsule-run-1'))).toBe(false);
    expect(errorLog).toHaveBeenCalled();
  });

  it('keeps finalize not-found and invalid-input errors synchronous', () => {
    expect(() => finalizeAgentRunCapsule(mindRoot, 'capsule-missing', { status: 'failed' }))
      .toThrow(/not found/i);
    expect(() => createAgentRunCapsule(mindRoot, capsuleInput({ id: '../escape' })))
      .toThrow(/capsule id/i);
  });

  it('flushes every pending capsule write for the process-exit fallback', () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-run-2', runId: 'run-2' }));
    // The exit hook path: synchronous best-effort write of everything pending.
    writePendingCapsuleWritesSync();
    expect(JSON.parse(readFileSync(storedPath('capsule-run-1'), 'utf-8')).id).toBe('capsule-run-1');
    expect(JSON.parse(readFileSync(storedPath('capsule-run-2'), 'utf-8')).id).toBe('capsule-run-2');
  });

  it('queues independent runs on independent chains', async () => {
    createAgentRunCapsule(mindRoot, capsuleInput());
    createAgentRunCapsule(mindRoot, capsuleInput({ id: 'capsule-run-2', runId: 'run-2' }));
    await flushCapsuleWrites('capsule-run-2');
    expect(JSON.parse(readFileSync(storedPath('capsule-run-2'), 'utf-8')).request.messages).toHaveLength(1);
    await flushCapsuleWrites('capsule-run-1');
    expect(JSON.parse(readFileSync(storedPath('capsule-run-1'), 'utf-8')).request.messages).toHaveLength(1);
  });
});
