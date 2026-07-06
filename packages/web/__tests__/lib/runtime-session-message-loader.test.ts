import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexThreadManagerServices } from '@geminilight/mindos/server';
import {
  loadRuntimeSessionMessages,
  resolveRuntimeSessionMessageTarget,
} from '@/lib/server/runtime-session-message-loader';

const tempHomes: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mindos-session-message-loader-'));
  tempHomes.push(dir);
  return dir;
}

type CodexClient = Awaited<ReturnType<NonNullable<CodexThreadManagerServices['createCodexClient']>>>;

function createCodexServices(): CodexThreadManagerServices & {
  calls: Array<{ method: string; input?: unknown }>;
} {
  const calls: Array<{ method: string; input?: unknown }> = [];
  return {
    calls,
    createCodexClient: async () => ({
      initialize: async () => {
        calls.push({ method: 'initialize' });
      },
      startThread: async () => ({ threadId: 'thr-new' }),
      resumeThread: async (input) => ({ threadId: input.threadId }),
      listThreads: async () => ({
        data: [],
        nextCursor: null,
        backwardsCursor: null,
      }),
      readThread: async (input) => {
        calls.push({ method: 'thread/read', input });
        return {
          thread: {
            id: input.threadId,
            name: 'Codex repo session',
            updatedAt: 1782628960000,
            turns: input.includeTurns
              ? [{ input: 'run the tests', output: 'tests passed' }]
              : [],
          },
        };
      },
      forkThread: async (input) => ({
        thread: {
          id: 'thr-forked',
          forkedFromId: input.threadId,
        },
      }),
      archiveThread: async () => {},
      unarchiveThread: async (input) => ({
        thread: {
          id: input.threadId,
          turns: [],
        },
      }),
      startTurn: async function* () {},
      close: async () => {
        calls.push({ method: 'close' });
      },
    } satisfies CodexClient),
  };
}

describe('runtime session message loader', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('resolves known CLI aliases to stable runtime message targets', () => {
    expect(resolveRuntimeSessionMessageTarget('codex-cli')).toMatchObject({
      kind: 'codex',
      cli: 'codex',
      runtime: { id: 'codex', kind: 'codex' },
    });
    expect(resolveRuntimeSessionMessageTarget('kimi_code')).toMatchObject({
      kind: 'native',
      cli: 'kimi',
      runtime: { id: 'kimi', kind: 'acp' },
    });
    expect(resolveRuntimeSessionMessageTarget('claude-code')).toMatchObject({
      kind: 'native',
      cli: 'claude',
      runtime: { id: 'claude', kind: 'claude' },
    });
  });

  it('loads Codex thread turns through the durable Codex thread reader', async () => {
    const services = createCodexServices();

    const result = await loadRuntimeSessionMessages({
      cli: 'codex',
      sessionId: 'thr-existing',
      codexServices: services,
    });

    expect(result.status).toBe('loaded');
    expect(result.source).toEqual({
      kind: 'codex-thread',
      durable: true,
      confidence: 'full',
    });
    expect(result.entry).toMatchObject({
      id: 'thr-existing',
      title: 'Codex repo session',
      runtime: { id: 'codex', kind: 'codex' },
    });
    expect(result.messages.map((message) => [message.role, message.content, message.agentKind])).toEqual([
      ['user', 'run the tests', 'codex'],
      ['assistant', 'tests passed', 'codex'],
    ]);
    expect(services.calls).toEqual([
      { method: 'initialize' },
      {
        method: 'thread/read',
        input: { threadId: 'thr-existing', includeTurns: true },
      },
      { method: 'close' },
    ]);
  });

  it('loads Kimi Code session messages from its native transcript archive', async () => {
    const homeDir = await makeTempHome();
    const sessionDir = join(
      homeDir,
      '.kimi-code',
      'sessions',
      'wd_repo_123456',
      'session_kimi_1',
    );
    await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
    await writeFile(join(sessionDir, 'state.json'), JSON.stringify({
      title: 'Kimi repo work',
      createdAt: 1782628900000,
      updatedAt: 1782628960000,
      lastPrompt: 'Please inspect the repo',
    }));
    await writeFile(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
      JSON.stringify({
        type: 'context.append_message',
        time: 1782628947181,
        message: { role: 'user', content: [{ type: 'text', text: 'inspect' }] },
      }),
      JSON.stringify({
        type: 'context.append_loop_event',
        time: 1782628951549,
        event: { type: 'content.part', turnId: '0', part: { type: 'text', text: 'done' } },
      }),
    ].join('\n'));

    const result = await loadRuntimeSessionMessages({
      cli: 'kimi-code',
      sessionId: 'session_kimi_1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(result.status).toBe('loaded');
    expect(result.source).toEqual({
      kind: 'native-transcript',
      transcriptSource: 'kimi-code',
      durable: true,
      confidence: 'full',
    });
    expect(result.entry).toMatchObject({
      id: 'session_kimi_1',
      title: 'Kimi repo work',
      runtime: { id: 'kimi', kind: 'acp' },
      messageCount: 2,
    });
    expect(result.messages.map((message) => [message.role, message.content, message.agentId])).toEqual([
      ['user', 'inspect', 'kimi'],
      ['assistant', 'done', 'kimi'],
    ]);
  });

  it('returns a missing result when a native transcript source has no matching session', async () => {
    const homeDir = await makeTempHome();

    const result = await loadRuntimeSessionMessages({
      cli: 'opencode',
      sessionId: 'missing-session',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(result).toMatchObject({
      cli: 'opencode',
      sessionId: 'missing-session',
      status: 'missing',
      messages: [],
      runtime: { id: 'opencode', kind: 'acp' },
      source: {
        kind: 'missing',
        confidence: 'missing',
      },
    });
  });

  it('loads Claude Code session messages from its project transcript archive', async () => {
    const homeDir = await makeTempHome();
    const projectDir = join(homeDir, '.claude', 'projects', '-workspace-repo');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'claude-session-1.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:01.000Z',
        cwd: '/workspace/repo',
        message: { role: 'user', content: 'inspect with claude' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:02.000Z',
        cwd: '/workspace/repo',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'claude inspected it' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } },
          ],
        },
      }),
    ].join('\n'));

    const result = await loadRuntimeSessionMessages({
      cli: 'claude-code',
      sessionId: 'claude-session-1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(result.status).toBe('loaded');
    expect(result.runtime).toMatchObject({ id: 'claude', kind: 'claude' });
    expect(result.source).toEqual({
      kind: 'native-transcript',
      transcriptSource: 'claude-code',
      durable: true,
      confidence: 'full',
    });
    expect(result.messages.map((message) => [message.role, message.content, message.agentKind])).toEqual([
      ['user', 'inspect with claude', 'claude'],
      ['assistant', 'claude inspected it', 'claude'],
    ]);
  });

  it('marks unknown CLIs as unsupported', async () => {
    const result = await loadRuntimeSessionMessages({
      cli: 'unknown-agent',
      sessionId: 'session-1',
    });

    expect(result.status).toBe('unsupported');
    expect(result.source).toMatchObject({
      kind: 'unsupported',
      durable: false,
      confidence: 'missing',
    });
  });
});
