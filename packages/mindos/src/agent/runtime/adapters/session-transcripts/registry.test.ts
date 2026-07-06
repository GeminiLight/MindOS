import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRuntimeSessionTranscriptAdapter,
  listRuntimeSessionTranscripts,
  parseVisibleMessagesFromRecords,
  resolveRuntimeSessionTranscriptTarget,
} from './index.js';

const tempHomes: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mindos-core-session-transcripts-'));
  tempHomes.push(dir);
  return dir;
}

describe('runtime session transcript adapter registry', () => {
  afterEach(async () => {
    await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('resolves supported and unverified agent transcript targets from aliases', () => {
    expect(resolveRuntimeSessionTranscriptTarget('qwen')).toMatchObject({
      cli: 'qwen-code',
      runtime: { id: 'qwen-code', kind: 'acp' },
      adapter: { id: 'qwen-code', status: 'supported', durable: true },
    });
    expect(resolveRuntimeSessionTranscriptTarget('codebuddy-code')).toMatchObject({
      cli: 'codebuddy',
      runtime: { id: 'codebuddy', kind: 'acp' },
      adapter: { id: 'codebuddy-code', status: 'supported', durable: true },
    });
    expect(resolveRuntimeSessionTranscriptTarget('openclaw')).toMatchObject({
      cli: 'openclaw',
      runtime: { id: 'openclaw', kind: 'acp' },
      adapter: { id: 'openclaw', status: 'supported', durable: true },
    });
    expect(resolveRuntimeSessionTranscriptTarget('cursor')).toMatchObject({
      cli: 'cursor',
      runtime: { id: 'cursor', kind: 'acp' },
      adapter: { id: 'cursor', status: 'unverified', durable: false },
    });
    expect(resolveRuntimeSessionTranscriptTarget('hermes-code')).toMatchObject({
      cli: 'hermes',
      runtime: { id: 'hermes', kind: 'acp' },
      adapter: { id: 'hermes', status: 'unverified', durable: false },
    });
  });

  it('returns empty transcript lists for recognized but unverified native stores', async () => {
    expect(getRuntimeSessionTranscriptAdapter('cursor')).toMatchObject({
      status: 'unverified',
      durable: false,
    });
    await expect(listRuntimeSessionTranscripts({
      runtimeId: 'cursor',
      sessionId: 'cursor-session-1',
      homeDir: await makeTempHome(),
    })).resolves.toEqual([]);
  });

  it('loads Qwen Code sessions through the core registry', async () => {
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
          ],
        },
      }),
    ].join('\n'));

    const sessions = await listRuntimeSessionTranscripts({
      runtimeId: 'qwen',
      sessionId: 'qwen-session-1',
      cwd: '/workspace/repo',
      homeDir,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'qwen-session-1',
      title: 'ask qwen',
      transcriptSource: 'qwen-code',
      messageCount: 2,
    });
    expect(sessions[0]?.turns?.map((message) => [message.role, message.content])).toEqual([
      ['user', 'ask qwen'],
      ['assistant', 'qwen answered'],
    ]);
  });

  it('normalizes visible text records without exposing thinking or tool parts', () => {
    expect(parseVisibleMessagesFromRecords([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'hidden' },
            { type: 'text', text: 'visible' },
            { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      },
    ])).toEqual([
      { role: 'assistant', content: 'visible' },
    ]);
  });
});
