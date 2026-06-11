import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  handleAskSessionsDelete,
  handleAskSessionsGet,
  handleAskSessionsPost,
} from './ask-sessions.js';

function makeStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'mindos-ask-sessions-handler-')), 'sessions.json');
}

function makeSession(id: string, updatedAt: number, content: string) {
  return {
    id,
    updatedAt,
    messages: [{ role: 'user', content }],
  };
}

describe('ask-sessions handler', () => {
  it('upserts, lists, and deletes sessions', async () => {
    const storePath = makeStorePath();
    const session = makeSession('s1', 1, 'hello');

    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);

    const post = await handleAskSessionsPost({ session }, { storePath });
    expect(post).toMatchObject({ status: 200, body: { ok: true } });
    expect(handleAskSessionsGet({ storePath }).body).toEqual([session]);

    const del = await handleAskSessionsDelete({ id: 's1' }, { storePath });
    expect(del).toMatchObject({ status: 200, body: { ok: true } });
    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
  });

  it('rejects invalid payloads without touching the store', async () => {
    const storePath = makeStorePath();

    expect((await handleAskSessionsPost({ session: { id: 42 } }, { storePath })).status).toBe(400);
    expect((await handleAskSessionsPost(undefined, { storePath })).status).toBe(400);
    expect((await handleAskSessionsDelete({}, { storePath })).status).toBe(400);
    expect((await handleAskSessionsDelete({ ids: [] }, { storePath })).status).toBe(400);
    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
  });

  it('recovers from a corrupted store file on the next write', async () => {
    const storePath = makeStorePath();
    writeFileSync(storePath, '{ not json', 'utf-8');

    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
    await handleAskSessionsPost({ session: makeSession('s1', 1, 'hi') }, { storePath });
    expect(handleAskSessionsGet({ storePath }).body).toHaveLength(1);
  });

  it('serializes interleaved concurrent upserts without losing either session', async () => {
    const storePath = makeStorePath();
    const writes: Promise<unknown>[] = [];

    // 2×50 interleaved read-modify-write cycles. Without a write queue the
    // last writer clobbers the other lane's updates.
    for (let i = 1; i <= 50; i++) {
      writes.push(handleAskSessionsPost({ session: makeSession('a', i, `a-${i}`) }, { storePath }));
      writes.push(handleAskSessionsPost({ session: makeSession('b', i, `b-${i}`) }, { storePath }));
    }
    await Promise.all(writes);

    const raw = readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as Array<{ id: string; updatedAt: number; messages: Array<{ content: string }> }>;
    const a = parsed.find((s) => s.id === 'a');
    const b = parsed.find((s) => s.id === 'b');
    expect(a).toMatchObject({ updatedAt: 50, messages: [{ content: 'a-50' }] });
    expect(b).toMatchObject({ updatedAt: 50, messages: [{ content: 'b-50' }] });
  });

  it('interleaves upserts and deletes without corrupting the file', async () => {
    const storePath = makeStorePath();
    const ops: Promise<unknown>[] = [];
    for (let i = 1; i <= 20; i++) {
      ops.push(handleAskSessionsPost({ session: makeSession(`keep-${i}`, i, 'keep') }, { storePath }));
      ops.push(handleAskSessionsPost({ session: makeSession(`drop-${i}`, i, 'drop') }, { storePath }));
      ops.push(handleAskSessionsDelete({ id: `drop-${i}` }, { storePath }));
    }
    await Promise.all(ops);

    const parsed = JSON.parse(readFileSync(storePath, 'utf-8')) as Array<{ id: string }>;
    expect(parsed.some((s) => s.id.startsWith('drop-'))).toBe(false);
    expect(parsed.filter((s) => s.id.startsWith('keep-'))).toHaveLength(20);
  });

  it('truncates to the 30 most recent sessions inside the write queue', async () => {
    const storePath = makeStorePath();
    const writes: Promise<unknown>[] = [];
    for (let i = 1; i <= 35; i++) {
      writes.push(handleAskSessionsPost({ session: makeSession(`s-${i}`, i, `m-${i}`) }, { storePath }));
    }
    await Promise.all(writes);

    const parsed = JSON.parse(readFileSync(storePath, 'utf-8')) as Array<{ id: string; updatedAt: number }>;
    expect(parsed).toHaveLength(30);
    expect(parsed[0].updatedAt).toBe(35);
    expect(parsed.every((s) => s.updatedAt >= 6)).toBe(true);
  });

  it('leaves no temp files behind after atomic writes', async () => {
    const storePath = makeStorePath();
    await handleAskSessionsPost({ session: makeSession('s1', 1, 'hello') }, { storePath });
    await handleAskSessionsPost({ session: makeSession('s2', 2, 'world') }, { storePath });

    const dir = readdirSync(join(storePath, '..'));
    expect(dir).toEqual(['sessions.json']);
  });
});
