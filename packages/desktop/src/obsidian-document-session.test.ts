import { describe, expect, it, vi } from 'vitest';
import { createObsidianDocumentSession } from './obsidian-document-session';

const revision = 'a'.repeat(64);
const vaultId = 'b'.repeat(64);
const initial = { content: 'original', revision, vaultId };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const defaults = { baseUrl: 'http://127.0.0.1:4567', filePath: 'Notes/中文 📝.md', pluginId: 'table-editor-obsidian', token: 'test-only-token', isAuthorized: () => true };

function transport(responses: Response[]) {
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const response = responses.shift();
    if (!response) throw new Error('Network disconnected');
    return response;
  };
  return { fetchImpl, requests };
}

describe('desktop approved-document session', () => {
  it('does not grant a session when the owner declines', async () => {
    const wire = transport([json(initial)]);
    const approve = vi.fn(async () => false);
    const session = await createObsidianDocumentSession({ ...defaults, ...wire, approve });
    expect(session).toBeNull();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ filePath: defaults.filePath, pluginId: defaults.pluginId, vaultId }));
    expect(wire.requests).toHaveLength(1);
  });

  it('saves only the approved path with content and vault preconditions, advancing its revision', async () => {
    const wire = transport([json(initial), json({ ok: true, revision: 'c'.repeat(64) }), json({ ok: true, revision: 'd'.repeat(64) })]);
    const session = (await createObsidianDocumentSession({ ...defaults, ...wire, approve: async () => true }))!;
    session.setDraft('first');
    await session.save();
    session.setDraft('second');
    await session.save();
    expect(JSON.parse(wire.requests[1].options!.body as string)).toEqual({
      op: 'save_file', path: defaults.filePath, content: 'first', expectedRevision: revision, expectedVaultId: vaultId,
    });
    expect(JSON.parse(wire.requests[2].options!.body as string).expectedRevision).toBe('c'.repeat(64));
    expect(wire.requests.every(request => new URL(request.url).origin === defaults.baseUrl)).toBe(true);
    expect(new Headers(wire.requests[1].options!.headers).get('x-mindos-agent')).toBe('obsidian:table-editor-obsidian');
    expect(wire.requests[1].options!.redirect).toBe('error');
    expect(session.snapshot).toMatchObject({ content: 'second', dirty: false, status: 'ready' });
    expect(JSON.stringify(session.snapshot)).not.toContain(defaults.token);
  });

  it.each(['conflict', 'vault_changed'])('retains the draft and stops retrying on %s', async (error) => {
    const wire = transport([json(initial), json({ error, serverRevision: 'c'.repeat(64) }, 409)]);
    const session = (await createObsidianDocumentSession({ ...defaults, ...wire, approve: async () => true }))!;
    session.setDraft('unsaved');
    await expect(session.save()).rejects.toThrow(error);
    expect(session.snapshot).toMatchObject({ content: 'unsaved', dirty: true, status: 'conflict' });
    await expect(session.save()).rejects.toThrow(/conflict/i);
    expect(wire.requests).toHaveLength(2);
  });

  it('keeps edits made during a save and rejects overlapping saves', async () => {
    let finish!: (value: Response) => void;
    let calls = 0;
    const fetchImpl: typeof fetch = async () => ++calls === 1 ? json(initial) : new Promise(resolve => { finish = resolve; });
    const session = (await createObsidianDocumentSession({ ...defaults, fetchImpl, approve: async () => true }))!;
    session.setDraft('first');
    const saving = session.save();
    session.setDraft('second');
    await expect(session.save()).rejects.toThrow(/progress/i);
    finish(json({ ok: true, revision: 'c'.repeat(64) }));
    await saving;
    expect(session.snapshot).toMatchObject({ content: 'second', dirty: true, status: 'ready', revision: 'c'.repeat(64) });
    expect(session.snapshot.revision).not.toBe(revision);
  });

  it('retains the original preconditions after an ambiguous network failure', async () => {
    const wire = transport([json(initial)]);
    const session = (await createObsidianDocumentSession({ ...defaults, ...wire, approve: async () => true }))!;
    session.setDraft('unsaved');
    await expect(session.save()).rejects.toThrow('Network disconnected');
    expect(session.snapshot).toMatchObject({ content: 'unsaved', dirty: true, status: 'ready' });
    await expect(session.save()).rejects.toThrow('Network disconnected');
    expect(JSON.parse(wire.requests[2].options!.body as string).expectedRevision).toBe(revision);
  });

  it('revokes a closed session without dropping its recoverable draft', async () => {
    const wire = transport([json(initial)]);
    const session = (await createObsidianDocumentSession({ ...defaults, ...wire, approve: async () => true }))!;
    session.setDraft('recover me');
    session.close();
    await expect(session.save()).rejects.toThrow(/closed/i);
    expect(() => session.setDraft('late')).toThrow(/closed/i);
    expect(session.snapshot).toMatchObject({ content: 'recover me', dirty: true, status: 'closed' });
    expect(wire.requests).toHaveLength(1);
  });

  it('aborts an in-flight request on close and never reports a late success', async () => {
    let requestSignal: AbortSignal | null | undefined;
    let finish!: (value: Response) => void;
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, options) => {
      if (++calls === 1) return json(initial);
      requestSignal = options?.signal;
      return new Promise(resolve => { finish = resolve; });
    };
    const session = (await createObsidianDocumentSession({ ...defaults, fetchImpl, approve: async () => true }))!;
    session.setDraft('draft');
    const saving = session.save();
    session.close();
    expect(requestSignal?.aborted).toBe(true);
    finish(json({ ok: true, revision: 'c'.repeat(64) }));
    await expect(saving).rejects.toThrow(/closed/i);
    expect(session.snapshot).toMatchObject({ content: 'draft', dirty: true, status: 'closed' });
  });

  it.each([
    { baseUrl: 'https://evil.example' }, { baseUrl: 'http://127.0.0.1:4567/other' },
    { filePath: '../outside.md' }, { filePath: '/outside.md' }, { filePath: '.mindos/private.md' },
    { filePath: 'folder/../outside.md' }, { filePath: 'note.pdf' }, { pluginId: '../plugin' },
  ])('rejects an invalid binding before reading anything: %j', async (invalid) => {
    const wire = transport([json(initial)]);
    await expect(createObsidianDocumentSession({ ...defaults, ...invalid, ...wire, approve: async () => true })).rejects.toThrow();
    expect(wire.requests).toHaveLength(0);
  });

  it.each([{ content: 'old server' }, { ...initial, revision: '' }, { ...initial, vaultId: null }])('fails closed on a malformed or older server snapshot', async (snapshot) => {
    const wire = transport([json(snapshot)]);
    const approve = vi.fn(async () => true);
    await expect(createObsidianDocumentSession({ ...defaults, ...wire, approve })).rejects.toThrow(/snapshot/i);
    expect(approve).not.toHaveBeenCalled();
  });

  it('rejects oversized draft content before it can enter the IPC save queue', async () => {
    const wire = transport([json(initial)]);
    const session = (await createObsidianDocumentSession({ ...defaults, ...wire, approve: async () => true }))!;
    expect(() => session.setDraft('字'.repeat(1_000_000))).toThrow(/large/i);
    expect(session.snapshot.content).toBe(initial.content);
  });

  it('checks coordinator authorization again after owner approval and before every save', async () => {
    const wire = transport([json(initial)]);
    let authorized = true;
    await expect(createObsidianDocumentSession({
      ...defaults, ...wire, isAuthorized: () => authorized,
      approve: async () => { authorized = false; return true; },
    })).rejects.toThrow(/authorization/i);
    expect(wire.requests).toHaveLength(1);

    authorized = true;
    const secondWire = transport([json(initial)]);
    const session = (await createObsidianDocumentSession({
      ...defaults, ...secondWire, isAuthorized: () => authorized, approve: async () => true,
    }))!;
    session.setDraft('retain after revoke');
    authorized = false;
    await expect(session.save()).rejects.toThrow(/authorization/i);
    expect(session.snapshot).toMatchObject({ content: 'retain after revoke', dirty: true, status: 'closed' });
    authorized = true;
    await expect(session.save()).rejects.toThrow(/closed/i);
    expect(secondWire.requests).toHaveLength(1);
  });

  it('rejects Windows drive paths before a request, even when running on macOS', async () => {
    const wire = transport([json(initial)]);
    await expect(createObsidianDocumentSession({ ...defaults, ...wire, filePath: 'C:/secret.md', approve: async () => true })).rejects.toThrow(/path/i);
    expect(wire.requests).toHaveLength(0);
  });

  it('bounds the response by bytes, cancels an oversized stream, and never asks for approval', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const wire = transport([new Response(stream)]);
    const approve = vi.fn(async () => true);
    await expect(createObsidianDocumentSession({ ...defaults, ...wire, approve })).rejects.toThrow(/large/i);
    expect(cancelled).toBe(true);
    expect(approve).not.toHaveBeenCalled();
  });

  it('times out a stalled save and preserves the draft for retry or recovery', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, options) => {
      if (++calls === 1) return json(initial);
      return new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
      });
    };
    const session = (await createObsidianDocumentSession({ ...defaults, fetchImpl, timeoutMs: 20, approve: async () => true }))!;
    session.setDraft('not lost on timeout');
    await expect(session.save()).rejects.toThrow(/timeout/i);
    expect(session.snapshot).toMatchObject({ content: 'not lost on timeout', dirty: true, status: 'ready' });
  });

  it('does not acknowledge a malformed success response or a permission rejection as saved', async () => {
    const wire = transport([json(initial), json({ ok: true }), json({ error: 'permission_required' }, 403)]);
    const session = (await createObsidianDocumentSession({ ...defaults, ...wire, approve: async () => true }))!;
    session.setDraft('still unsaved');
    await expect(session.save()).rejects.toThrow(/cannot confirm/i);
    await expect(session.save()).rejects.toThrow(/permission_required/i);
    expect(session.snapshot).toMatchObject({ content: 'still unsaved', dirty: true });
    expect(JSON.parse(wire.requests[2].options!.body as string).expectedRevision).toBe(revision);
  });
});
