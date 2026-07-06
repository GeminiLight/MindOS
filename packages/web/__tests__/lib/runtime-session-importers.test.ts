import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listExternalRuntimeSessions,
  parseClaudeMessagesFromRecords,
  parseGeminiMessagesFromRecords,
  parseKimiWireMessages,
  parseOpenCodeTextRows,
  parseVisibleMessagesFromRecords,
} from '@/lib/server/runtime-session-importers';

const tempHomes: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mindos-runtime-importer-'));
  tempHomes.push(dir);
  return dir;
}

describe('runtime session native importers', () => {
  afterEach(async () => {
    await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('parses visible Kimi user and assistant text while ignoring thinking parts', () => {
    expect(parseKimiWireMessages([
      {
        type: 'context.append_message',
        time: 1782628947181,
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Please reply exactly: OK' }],
        },
      },
      {
        type: 'context.append_loop_event',
        time: 1782628951548,
        event: {
          type: 'content.part',
          turnId: '0',
          part: { type: 'think', think: 'hidden reasoning' },
        },
      },
      {
        type: 'context.append_loop_event',
        time: 1782628951549,
        event: {
          type: 'content.part',
          turnId: '0',
          part: { type: 'text', text: 'O' },
        },
      },
      {
        type: 'context.append_loop_event',
        time: 1782628951550,
        event: {
          type: 'content.part',
          turnId: '0',
          part: { type: 'text', text: 'K' },
        },
      },
    ])).toEqual([
      { role: 'user', content: 'Please reply exactly: OK', timestamp: 1782628947181 },
      { role: 'assistant', content: 'OK', timestamp: 1782628951549 },
    ]);
  });

  it('imports Kimi session folders for the requested project cwd', async () => {
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

    await mkdir(join(homeDir, '.kimi-code', 'sessions', 'wd_other_123456', 'session_other'), { recursive: true });

    const sessions = await listExternalRuntimeSessions({
      runtimeId: 'kimi',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'session_kimi_1',
      title: 'Kimi repo work',
      preview: 'Please inspect the repo',
      messageCount: 2,
      transcriptSource: 'kimi-code',
    });
    expect(sessions[0]?.turns?.map((message) => [message.role, message.content])).toEqual([
      ['user', 'inspect'],
      ['assistant', 'done'],
    ]);
  });

  it('parses Gemini chat snapshots from jsonl records', () => {
    expect(parseGeminiMessagesFromRecords([
      {
        sessionId: 'gemini-1',
        startTime: '2026-06-29T09:00:00.000Z',
        lastUpdated: '2026-06-29T09:01:00.000Z',
      },
      {
        $set: {
          messages: [
            {
              id: 'm1',
              timestamp: '2026-06-29T09:00:01.000Z',
              type: 'user',
              content: [{ text: 'hello gemini' }],
            },
            {
              id: 'm2',
              timestamp: '2026-06-29T09:00:02.000Z',
              type: 'assistant',
              content: [{ text: 'hello back' }],
            },
          ],
        },
      },
    ])).toEqual([
      { role: 'user', content: 'hello gemini', timestamp: Date.parse('2026-06-29T09:00:01.000Z') },
      { role: 'assistant', content: 'hello back', timestamp: Date.parse('2026-06-29T09:00:02.000Z') },
    ]);
  });

  it('imports Gemini chat files that match the requested project root', async () => {
    const homeDir = await makeTempHome();
    const projectDir = join(homeDir, '.gemini', 'tmp', 'repo');
    await mkdir(join(projectDir, 'chats'), { recursive: true });
    await writeFile(join(projectDir, '.project_root'), '/workspace/repo');
    await writeFile(join(projectDir, 'chats', 'session-1.jsonl'), [
      JSON.stringify({
        sessionId: 'gemini-session-1',
        startTime: '2026-06-29T09:00:00.000Z',
        lastUpdated: '2026-06-29T09:02:00.000Z',
      }),
      JSON.stringify({
        $set: {
          messages: [
            { type: 'user', timestamp: '2026-06-29T09:00:01.000Z', content: [{ text: 'summarize' }] },
            { type: 'assistant', timestamp: '2026-06-29T09:00:02.000Z', content: [{ text: 'summary' }] },
          ],
        },
      }),
    ].join('\n'));

    const sessions = await listExternalRuntimeSessions({
      runtimeId: 'gemini',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'gemini-session-1',
      title: 'summarize',
      messageCount: 2,
      transcriptSource: 'gemini-cli',
    });
  });

  it('parses visible OpenCode text parts and ignores reasoning or tool parts', () => {
    expect(parseOpenCodeTextRows([
      {
        message_id: 'm1',
        message_time_created: 1782628947000,
        message_data: JSON.stringify({ role: 'user' }),
        part_data: JSON.stringify({ type: 'text', text: 'run tests' }),
      },
      {
        message_id: 'm2',
        message_time_created: 1782628951000,
        message_data: JSON.stringify({ role: 'assistant' }),
        part_data: JSON.stringify({ type: 'reasoning', text: 'hidden' }),
      },
      {
        message_id: 'm2',
        message_time_created: 1782628951000,
        message_data: JSON.stringify({ role: 'assistant' }),
        part_data: JSON.stringify({ type: 'text', text: 'tests passed' }),
      },
      {
        message_id: 'm2',
        message_time_created: 1782628951000,
        message_data: JSON.stringify({ role: 'assistant' }),
        part_data: JSON.stringify({ type: 'tool', text: 'npm test' }),
      },
    ])).toEqual([
      { role: 'user', content: 'run tests', timestamp: 1782628947000 },
      { role: 'assistant', content: 'tests passed', timestamp: 1782628951000 },
    ]);
  });

  it('treats a missing OpenCode sqlite database as an empty optional import source', async () => {
    const homeDir = await makeTempHome();

    await expect(listExternalRuntimeSessions({
      runtimeId: 'opencode',
      cwd: '/workspace/repo',
      homeDir,
    })).resolves.toEqual([]);
  });

  it('parses visible Claude Code transcript text while ignoring tools and sidechains', () => {
    expect(parseClaudeMessagesFromRecords([
      {
        type: 'user',
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:01.000Z',
        message: { role: 'user', content: 'inspect the repo' },
      },
      {
        type: 'assistant',
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'repo inspected' },
            { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
            { type: 'thinking', thinking: 'hidden reasoning' },
          ],
        },
      },
      {
        type: 'user',
        isSidechain: true,
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:03.000Z',
        message: { role: 'user', content: 'sidechain task' },
      },
    ])).toEqual([
      { role: 'user', content: 'inspect the repo', timestamp: Date.parse('2026-07-06T06:00:01.000Z') },
      { role: 'assistant', content: 'repo inspected', timestamp: Date.parse('2026-07-06T06:00:02.000Z') },
    ]);
  });

  it('parses visible JSONL message records shared by Qwen, CodeBuddy, and OpenClaw', () => {
    expect(parseVisibleMessagesFromRecords([
      {
        type: 'user',
        session_id: 'shared-session-1',
        timestamp: '2026-07-06T07:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'load shared transcript' }],
        },
      },
      {
        type: 'assistant',
        session_id: 'shared-session-1',
        timestamp: '2026-07-06T07:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'hidden chain of thought' },
            { type: 'text', text: 'shared transcript loaded' },
            { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      },
      {
        type: 'user',
        isSidechain: true,
        session_id: 'shared-session-1',
        timestamp: '2026-07-06T07:00:03.000Z',
        message: { role: 'user', content: 'hidden sidechain' },
      },
    ])).toEqual([
      { role: 'user', content: 'load shared transcript', timestamp: Date.parse('2026-07-06T07:00:01.000Z') },
      { role: 'assistant', content: 'shared transcript loaded', timestamp: Date.parse('2026-07-06T07:00:02.000Z') },
    ]);
  });

  it('imports Claude Code project transcript files by session id', async () => {
    const homeDir = await makeTempHome();
    const projectDir = join(homeDir, '.claude', 'projects', '-workspace-repo');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'claude-session-1.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:01.000Z',
        cwd: '/workspace/repo',
        message: { role: 'user', content: 'load claude transcript' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'claude-session-1',
        timestamp: '2026-07-06T06:00:02.000Z',
        cwd: '/workspace/repo',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'claude transcript loaded' }],
        },
      }),
    ].join('\n'));

    const sessions = await listExternalRuntimeSessions({
      runtimeId: 'claude',
      sessionId: 'claude-session-1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'claude-session-1',
      title: 'load claude transcript',
      cwd: '/workspace/repo',
      messageCount: 2,
      transcriptSource: 'claude-code',
    });
    expect(sessions[0]?.turns?.map((message) => [message.role, message.content])).toEqual([
      ['user', 'load claude transcript'],
      ['assistant', 'claude transcript loaded'],
    ]);
  });

  it('rejects Claude Code session ids with path separators', async () => {
    const homeDir = await makeTempHome();
    await mkdir(join(homeDir, '.claude', 'projects', '-workspace-repo'), { recursive: true });
    await writeFile(join(homeDir, '.claude', 'projects', 'escape.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'escape',
        timestamp: '2026-07-06T06:00:01.000Z',
        cwd: '/workspace/repo',
        message: { role: 'user', content: 'should not load' },
      }),
    ].join('\n'));

    await expect(listExternalRuntimeSessions({
      runtimeId: 'claude',
      sessionId: '../escape',
      cwd: '/workspace/repo',
      homeDir,
    })).resolves.toEqual([]);
  });

  it('imports Qwen Code chat transcript files by session id', async () => {
    const homeDir = await makeTempHome();
    const chatsDir = join(homeDir, '.qwen', 'projects', '-workspace-repo', 'chats');
    await mkdir(chatsDir, { recursive: true });
    await writeFile(join(chatsDir, 'qwen-session-1.jsonl'), [
      JSON.stringify({
        type: 'user',
        session_id: 'qwen-session-1',
        timestamp: '2026-07-06T07:00:01.000Z',
        cwd: '/workspace/repo',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'ask qwen' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        session_id: 'qwen-session-1',
        timestamp: '2026-07-06T07:00:02.000Z',
        cwd: '/workspace/repo',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'hidden reasoning' },
            { type: 'text', text: 'qwen answered' },
            { type: 'tool_use', name: 'read_file' },
          ],
        },
      }),
    ].join('\n'));

    const sessions = await listExternalRuntimeSessions({
      runtimeId: 'qwen-code',
      sessionId: 'qwen-session-1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'qwen-session-1',
      title: 'ask qwen',
      cwd: '/workspace/repo',
      messageCount: 2,
      transcriptSource: 'qwen-code',
    });
    expect(sessions[0]?.turns?.map((message) => [message.role, message.content])).toEqual([
      ['user', 'ask qwen'],
      ['assistant', 'qwen answered'],
    ]);
  });

  it('imports CodeBuddy Code project transcript files by session id', async () => {
    const homeDir = await makeTempHome();
    const projectDir = join(homeDir, '.codebuddy', 'projects', 'repo-hash');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'codebuddy-session-1.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'codebuddy-session-1',
        timestamp: '2026-07-06T07:10:01.000Z',
        cwd: '/workspace/repo',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'ask codebuddy' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'codebuddy-session-1',
        timestamp: '2026-07-06T07:10:02.000Z',
        cwd: '/workspace/repo',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'codebuddy answered' },
            { type: 'tool_result', content: 'hidden tool output' },
          ],
        },
      }),
    ].join('\n'));

    const sessions = await listExternalRuntimeSessions({
      runtimeId: 'codebuddy',
      sessionId: 'codebuddy-session-1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'codebuddy-session-1',
      title: 'ask codebuddy',
      cwd: '/workspace/repo',
      messageCount: 2,
      transcriptSource: 'codebuddy-code',
    });
    expect(sessions[0]?.turns?.map((message) => [message.role, message.content])).toEqual([
      ['user', 'ask codebuddy'],
      ['assistant', 'codebuddy answered'],
    ]);
  });

  it('imports OpenClaw session transcripts from agent session roots', async () => {
    const homeDir = await makeTempHome();
    const sessionsDir = join(homeDir, '.kimi_openclaw', 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({
      'agent:main:main': {
        sessionId: 'openclaw-session-1',
        sessionFile: 'openclaw-session-1.jsonl',
        updatedAt: '2026-07-06T07:20:03.000Z',
      },
    }));
    await writeFile(join(sessionsDir, 'openclaw-session-1.jsonl'), [
      JSON.stringify({
        type: 'session',
        id: 'openclaw-session-1',
        cwd: '/workspace/repo',
        timestamp: '2026-07-06T07:20:00.000Z',
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-06T07:20:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'ask openclaw' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-06T07:20:02.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'hidden reasoning' },
            { type: 'text', text: 'openclaw answered' },
          ],
        },
      }),
    ].join('\n'));

    const sessions = await listExternalRuntimeSessions({
      runtimeId: 'openclaw',
      sessionId: 'openclaw-session-1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'openclaw-session-1',
      title: 'ask openclaw',
      cwd: '/workspace/repo',
      messageCount: 2,
      transcriptSource: 'openclaw',
    });
    expect(sessions[0]?.turns?.map((message) => [message.role, message.content])).toEqual([
      ['user', 'ask openclaw'],
      ['assistant', 'openclaw answered'],
    ]);
  });
});
