import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

function sessionsDir(storePath: string): string {
  return join(storePath, '..', 'sessions');
}

function sessionFiles(storePath: string): string[] {
  return readdirSync(sessionsDir(storePath)).filter((name) => name.endsWith('.json'));
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
    expect(existsSync(sessionsDir(storePath))).toBe(false);
  });

  it('stores each session in its own file and leaves other files untouched on save', async () => {
    const storePath = makeStorePath();
    await handleAskSessionsPost({ session: makeSession('s1', 1, 'hello') }, { storePath });
    expect(sessionFiles(storePath)).toHaveLength(1);
    const s1File = join(sessionsDir(storePath), sessionFiles(storePath)[0]);
    const s1Before = statSync(s1File).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await handleAskSessionsPost({ session: makeSession('s2', 2, 'world') }, { storePath });

    expect(sessionFiles(storePath)).toHaveLength(2);
    expect(statSync(s1File).mtimeMs).toBe(s1Before);
  });

  it('migrates a legacy single sessions.json into per-session files once', async () => {
    const storePath = makeStorePath();
    const older = makeSession('old', 1, 'legacy a');
    const newer = makeSession('new', 2, 'legacy b');
    writeFileSync(storePath, JSON.stringify([newer, older]), 'utf-8');

    expect(handleAskSessionsGet({ storePath }).body).toEqual([newer, older]);
    expect(existsSync(storePath)).toBe(false);
    expect(sessionFiles(storePath)).toHaveLength(2);

    // Saving after migration only touches the saved session's file.
    await handleAskSessionsPost({ session: makeSession('new', 3, 'updated') }, { storePath });
    expect(handleAskSessionsGet({ storePath }).body).toMatchObject([{ id: 'new', updatedAt: 3 }, { id: 'old' }]);
  });

  it('recovers from a corrupted legacy store file on the next write', async () => {
    const storePath = makeStorePath();
    writeFileSync(storePath, '{ not json', 'utf-8');

    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
    await handleAskSessionsPost({ session: makeSession('s1', 1, 'hi') }, { storePath });
    expect(handleAskSessionsGet({ storePath }).body).toHaveLength(1);
    expect(existsSync(storePath)).toBe(false);
  });

  it('skips a corrupted per-session file without losing the others', async () => {
    const storePath = makeStorePath();
    await handleAskSessionsPost({ session: makeSession('good', 1, 'ok') }, { storePath });
    writeFileSync(join(sessionsDir(storePath), 'broken.json'), '{nope', 'utf-8');

    const body = handleAskSessionsGet({ storePath }).body as Array<{ id: string }>;
    expect(body.map((session) => session.id)).toEqual(['good']);
  });

  it('serializes interleaved concurrent upserts without losing either session', async () => {
    const storePath = makeStorePath();
    const writes: Promise<unknown>[] = [];

    for (let i = 1; i <= 50; i++) {
      writes.push(Promise.resolve(handleAskSessionsPost({ session: makeSession('a', i, `a-${i}`) }, { storePath })));
      writes.push(Promise.resolve(handleAskSessionsPost({ session: makeSession('b', i, `b-${i}`) }, { storePath })));
    }
    await Promise.all(writes);

    const body = handleAskSessionsGet({ storePath }).body as Array<{ id: string; updatedAt: number; messages: Array<{ content: string }> }>;
    expect(body.find((s) => s.id === 'a')).toMatchObject({ updatedAt: 50, messages: [{ content: 'a-50' }] });
    expect(body.find((s) => s.id === 'b')).toMatchObject({ updatedAt: 50, messages: [{ content: 'b-50' }] });
  });

  it('interleaves upserts and deletes without corrupting the store', async () => {
    const storePath = makeStorePath();
    const ops: Promise<unknown>[] = [];
    for (let i = 1; i <= 20; i++) {
      ops.push(Promise.resolve(handleAskSessionsPost({ session: makeSession(`keep-${i}`, i, 'keep') }, { storePath })));
      ops.push(Promise.resolve(handleAskSessionsPost({ session: makeSession(`drop-${i}`, i, 'drop') }, { storePath })));
      ops.push(Promise.resolve(handleAskSessionsDelete({ id: `drop-${i}` }, { storePath })));
    }
    await Promise.all(ops);

    const body = handleAskSessionsGet({ storePath }).body as Array<{ id: string }>;
    expect(body.some((s) => s.id.startsWith('drop-'))).toBe(false);
    expect(body.filter((s) => s.id.startsWith('keep-'))).toHaveLength(20);
  });

  it('keeps only the 30 most recent sessions on disk', async () => {
    const storePath = makeStorePath();
    for (let i = 1; i <= 35; i++) {
      handleAskSessionsPost({ session: makeSession(`s-${i}`, i, `m-${i}`) }, { storePath });
    }

    expect(sessionFiles(storePath)).toHaveLength(30);
    const body = handleAskSessionsGet({ storePath }).body as Array<{ updatedAt: number }>;
    expect(body).toHaveLength(30);
    expect(body[0].updatedAt).toBe(35);
    expect(body.every((s) => s.updatedAt >= 6)).toBe(true);
  });

  it('caps an oversized session by dropping its oldest messages', async () => {
    const storePath = makeStorePath();
    const big = 'x'.repeat(500_000);
    const messages = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `${i}:${big}` }));
    handleAskSessionsPost({ session: { id: 'big', updatedAt: 1, messages } }, { storePath });

    const stored = handleAskSessionsGet({ storePath }).body as Array<{ messages: Array<{ content: string }> }>;
    const kept = stored[0].messages;
    expect(kept.length).toBeLessThan(12);
    expect(kept[kept.length - 1].content.startsWith('11:')).toBe(true);
    const file = join(sessionsDir(storePath), sessionFiles(storePath)[0]);
    expect(statSync(file).size).toBeLessThanOrEqual(4_000_000);
  });

  it('stores ids containing path separators and unicode safely inside the sessions dir', async () => {
    const storePath = makeStorePath();
    const tricky = makeSession('../escape/привет 🎉', 1, 'tricky');
    handleAskSessionsPost({ session: tricky }, { storePath });

    expect(handleAskSessionsGet({ storePath }).body).toEqual([tricky]);
    // Exactly one file, inside the sessions dir (the id must not traverse out).
    expect(sessionFiles(storePath)).toHaveLength(1);
    expect(readdirSync(join(storePath, '..'))).toEqual(['sessions']);

    handleAskSessionsDelete({ id: tricky.id }, { storePath });
    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
  });

  it('leaves no temp files behind after atomic writes', async () => {
    const storePath = makeStorePath();
    await handleAskSessionsPost({ session: makeSession('s1', 1, 'hello') }, { storePath });
    await handleAskSessionsPost({ session: makeSession('s2', 2, 'world') }, { storePath });

    expect(readdirSync(join(storePath, '..'))).toEqual(['sessions']);
    expect(sessionFiles(storePath)).toHaveLength(2);
    expect(readdirSync(sessionsDir(storePath)).some((name) => name.includes('.tmp'))).toBe(false);
  });
});
