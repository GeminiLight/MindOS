import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AcpRegistryEntry } from './types.js';
import {
  closeAllSessions,
  closeSession,
  createSessionFromEntry,
  forkSessionFromEntry,
  getActiveSessions,
  getSession,
  loadSessionFromEntry,
} from './session.js';
import { updateSessionState } from './session-registry.js';

/**
 * Reopening an agent-side session prefers `session/resume`, which restores it
 * without replaying the whole history, and falls back to `session/load` for
 * agents that only offer that. `session/fork` branches a session into a new
 * one. Driven over real stdio against the fake agent.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function entry(): AcpRegistryEntry {
  return {
    id: 'fake-acp-reopen',
    name: 'Fake ACP Reopen',
    description: 'Local fake ACP agent for resume / fork tests',
    transport: 'binary',
    command: process.execPath,
    args: [path.join(__dirname, '__fixtures__', 'fake-acp-agent.mjs')],
  };
}

let dir: string;
let callLog: string;

function options(env: Record<string, string>) {
  return { cwd: dir, env: { FAKE_ACP_CALL_LOG: callLog, ...env }, permissionMode: 'auto' as const };
}

function calls(): string[] {
  return existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean) : [];
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mindos-acp-reopen-'));
  callLog = path.join(dir, 'calls.log');
});

afterEach(async () => {
  await closeAllSessions();
  rmSync(dir, { recursive: true, force: true });
});

async function agentSessionId(env: Record<string, string>): Promise<string> {
  const created = await createSessionFromEntry(entry(), options(env));
  const id = created.agentSessionId;
  await closeSession(created.id, { closeAgentSession: false });
  return id;
}

describe('reopening an agent session', () => {
  it('uses session/resume when the agent offers it, so history is not replayed', async () => {
    const env = { FAKE_ACP_RESUME: '1', FAKE_ACP_LOAD_SESSION: '1' };
    const id = await agentSessionId(env);

    const reopened = await loadSessionFromEntry(entry(), id, options(env));

    expect(reopened.agentSessionId).toBe(id);
    expect(calls()).toEqual([`resume ${id}`]);
    expect(reopened.configOptions?.map((option) => option.configId)).toContain('model');
  });

  it('falls back to session/load for agents without session/resume', async () => {
    const env = { FAKE_ACP_LOAD_SESSION: '1' };
    const id = await agentSessionId(env);

    const reopened = await loadSessionFromEntry(entry(), id, options(env));

    expect(reopened.agentSessionId).toBe(id);
    expect(calls()).toEqual([`load ${id}`]);
  });

  it('resumes agents that offer only session/resume', async () => {
    const env = { FAKE_ACP_RESUME: '1' };
    const id = await agentSessionId(env);

    await loadSessionFromEntry(entry(), id, options(env));

    expect(calls()).toEqual([`resume ${id}`]);
  });

  it('refuses to reopen when the agent offers neither, and leaves no session behind', async () => {
    const id = await agentSessionId({});

    await expect(loadSessionFromEntry(entry(), id, options({}))).rejects.toThrow(/session\/resume or session\/load/);
    expect(getActiveSessions()).toEqual([]);
  });
});

describe('forking an agent session', () => {
  it('opens a new agent session branched from the source', async () => {
    const env = { FAKE_ACP_FORK: '1' };
    const source = await agentSessionId(env);

    const forked = await forkSessionFromEntry(entry(), source, options(env));

    expect(forked.agentSessionId).not.toBe(source);
    expect(forked.agentSessionId).toMatch(/^fork-/);
    expect(calls()).toEqual([`fork ${source} -> ${forked.agentSessionId}`]);
    expect(getActiveSessions().map((session) => session.agentSessionId)).toEqual([forked.agentSessionId]);
  });

  it('refuses to fork when the agent does not offer session/fork', async () => {
    const source = await agentSessionId({ FAKE_ACP_LOAD_SESSION: '1' });

    await expect(forkSessionFromEntry(entry(), source, options({ FAKE_ACP_LOAD_SESSION: '1' }))).rejects.toThrow(/session\/fork/);
    expect(getActiveSessions()).toEqual([]);
  });

  it('releases an idle local session still holding the source, since Codex cannot fork a thread open in another process', async () => {
    const env = { FAKE_ACP_FORK: '1' };
    const live = await createSessionFromEntry(entry(), options(env));

    const forked = await forkSessionFromEntry(entry(), live.agentSessionId, options(env));

    expect(getSession(live.id)).toBeUndefined();
    expect(getActiveSessions().map((session) => session.id)).toEqual([forked.id]);
  });

  it('refuses to fork while a turn is still running on the source', async () => {
    const env = { FAKE_ACP_FORK: '1' };
    const live = await createSessionFromEntry(entry(), options(env));
    updateSessionState(live, 'active');

    await expect(forkSessionFromEntry(entry(), live.agentSessionId, options(env))).rejects.toThrow(/turn is still running/);
    expect(getSession(live.id)).toBeDefined();
    expect(calls()).toEqual([]);
  });
});
