import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { prepareObsidianPluginSession } from './obsidian-plugin-session';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const vaultId = 'b'.repeat(64);
const revision = 'a'.repeat(64);
const manifest = { id: 'table-editor-obsidian', name: 'Advanced Tables', version: '0.23.2' };
const defaults = { baseUrl: 'http://127.0.0.1:4567', token: 'test-only-secret', pluginId: manifest.id, filePath: '笔记/表格.md' };
function packageData(source = 'throw new Error("must never execute in main");') {
  const files = Object.entries({ 'main.js': source, 'manifest.json': JSON.stringify(manifest), 'styles.css': '/* original */' })
    .map(([path, text]) => ({ path, size: Buffer.byteLength(text), sha256: hash(text), base64: Buffer.from(text).toString('base64') }));
  const assets = files.map(({ base64: _, ...asset }) => asset);
  const fingerprint = hash(JSON.stringify(['mindos-plugin-package-v1', assets.map(({ path, size, sha256 }) => [path, size, sha256])]));
  return { manifest, vaultId, fingerprint, totalBytes: files.reduce((n, file) => n + file.size, 0), assets, files };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function setup(overrides: Partial<Parameters<typeof prepareObsidianPluginSession>[0]> = {}) {
  const life = new AbortController();
  const data = packageData();
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    if (url.pathname.endsWith('/package')) {
      const { files, ...preview } = data;
      return json(url.searchParams.has('fingerprint') ? { ...preview, files } : preview);
    }
    return json(init?.method === 'POST' ? { ok: true, revision: 'c'.repeat(64) } : { content: 'original', revision, vaultId });
  };
  const approve = vi.fn(async () => true);
  const options = { ...defaults, signal: life.signal, isCurrent: () => true, fetchImpl, approve, ...overrides };
  return { options, data, requests, life, approve };
}

describe('Desktop package and document approval coordinator', () => {
  it('binds configuration writes to approved code and revokes them after package replacement', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl;
    let changed = false; let writes = 0;
    fixture.options.fetchImpl = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/data')) {
        if (init?.method === 'POST') {
          writes++;
          expect(JSON.parse(String(init.body))).toMatchObject({ pluginId: manifest.id, vaultId, fingerprint: fixture.data.fingerprint, revision });
        }
        return json({ data: { label: '中文' }, revision });
      }
      if (changed && url.pathname.endsWith('/package')) return json(packageData('replacement'));
      return wire(input, init);
    };
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    expect(await session.readPluginData()).toEqual({ label: '中文' });
    await session.savePluginData({ label: 'saved' });
    expect(writes).toBe(1);
    changed = true;
    await expect(session.savePluginData({ label: 'late' })).rejects.toThrow(/changed/);
    expect(session.snapshot.status).toBe('closed');
    changed = false;
    await expect(session.readPluginData()).rejects.toThrow(/closed/);
    expect(writes).toBe(1);
  });

  it('does not send configuration requests after owner revocation', async () => {
    const fixture = setup();
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    const count = fixture.requests.length;
    fixture.life.abort();
    await expect(session.readPluginData()).rejects.toThrow(/closed|abort/);
    await expect(session.savePluginData({})).rejects.toThrow(/closed|abort/);
    expect(fixture.requests).toHaveLength(count);
  });

  it('never reads other files on ordinary approval and rejects a later read locally', async () => {
    const fixture = setup(); const session = (await prepareObsidianPluginSession(fixture.options))!;
    expect(session.vault).toBeUndefined();
    await expect(session.readVault()).rejects.toThrow(/not approved/i);
    expect(fixture.requests).toHaveLength(3); expect(session.snapshot.status).not.toBe('closed'); session.close();
  });

  it('reads only after explicit Vault consent and revalidates each refresh', async () => {
    const fixture = setup({ approve: async () => 'read-vault' }); const wire = fixture.options.fetchImpl;
    let reads = 0; let rejectRead = false;
    fixture.options.fetchImpl = async (input, init) => {
      if (!String(input).includes('/vault?')) return wire(input, init);
      reads++; if (rejectRead) return json({ error: 'approval_subject_changed' }, 409);
      return json({ vaultId, pluginFingerprint: fixture.data.fingerprint, name: 'Mind', files: [], folders: [], totalBytes: 0,
        revision: hash(JSON.stringify(['mindos-plugin-vault-v1', vaultId, [], []])) });
    };
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    expect(reads).toBe(1); expect(session.binding.capabilities).toContain('vault:read');
    expect(session.vault?.vaultId).toBe(vaultId); await session.readVault(); expect(reads).toBe(2);
    session.setDraft('keep me'); rejectRead = true; await expect(session.readVault()).rejects.toThrow();
    expect(session.snapshot).toMatchObject({ content: 'keep me', status: 'closed' });
  });

  it('does not interpret an arbitrary truthy approval as authority', async () => {
    const fixture = setup({ approve: async () => 'yes' as never });
    expect(await prepareObsidianPluginSession(fixture.options)).toBeNull(); expect(fixture.requests).toHaveLength(2);
  });

  it('approves one immutable code/vault/document subject before handing out verified bytes', async () => {
    const fixture = setup();
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    expect(fixture.approve).toHaveBeenCalledTimes(1);
    expect(fixture.approve).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: manifest.id, pluginName: manifest.name, pluginVersion: manifest.version,
      filePath: defaults.filePath, revision, vaultId, fingerprint: fixture.data.fingerprint,
      capabilities: ['document:read', 'document:write', 'plugin-data:read', 'plugin-data:write'],
    }));
    const binding = fixture.approve.mock.calls[0][0];
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.capabilities)).toBe(true);
    expect(fixture.requests.map(request => request.url.pathname)).toEqual(['/api/obsidian-plugins/package', '/api/file', '/api/obsidian-plugins/package']);
    expect(fixture.requests[2].url.searchParams.get('fingerprint')).toBe(fixture.data.fingerprint);
    expect(fixture.requests[2].url.searchParams.get('vaultId')).toBe(vaultId);
    expect(session.package.files).toEqual(fixture.data.files);
    expect(Object.isFrozen(session.package.files[0])).toBe(true);
    expect(JSON.stringify({ binding: session.binding, package: session.package, document: session.snapshot })).not.toContain(defaults.token);
    session.setDraft('changed');
    await session.save();
    expect(fixture.requests.slice(3).map(request => request.url.pathname)).toEqual(['/api/obsidian-plugins/package', '/api/file']);
    expect(JSON.parse(fixture.requests[4].init!.body as string)).toMatchObject({ path: defaults.filePath, expectedRevision: revision, expectedVaultId: vaultId });
    session.close();
  });

  it('declining approval never downloads executable bytes or grants a session', async () => {
    const fixture = setup({ approve: async () => false });
    expect(await prepareObsidianPluginSession(fixture.options)).toBeNull();
    expect(fixture.requests).toHaveLength(2);
  });

  it('rejects a vault switch between package preview and document read before asking approval', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl;
    fixture.options.fetchImpl = async (input, init) => String(input).includes('/api/file')
      ? json({ content: 'identical', revision, vaultId: 'd'.repeat(64) }) : wire(input, init);
    await expect(prepareObsidianPluginSession(fixture.options)).rejects.toThrow(/vault/i);
    expect(fixture.approve).not.toHaveBeenCalled();
  });

  it('a package update during approval cannot inherit the old approval', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl;
    fixture.options.fetchImpl = async (input, init) => String(input).includes('fingerprint=')
      ? json({ error: 'package_changed' }, 409) : wire(input, init);
    await expect(prepareObsidianPluginSession(fixture.options)).rejects.toThrow(/package_changed/);
    expect(fixture.approve).toHaveBeenCalledTimes(1);
  });

  it.each(['code', 'vault'])('revokes before writing after the approved %s changes, retaining the draft', async change => {
    const fixture = setup(); let changed = false; const wire = fixture.options.fetchImpl;
    fixture.options.fetchImpl = async (input, init) => changed && String(input).includes('/package')
      ? json(change === 'code' ? packageData('new code') : { ...fixture.data, vaultId: 'd'.repeat(64) }) : wire(input, init);
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    session.setDraft('recover this draft'); changed = true;
    await expect(session.save()).rejects.toThrow(/changed/i);
    expect(session.snapshot).toMatchObject({ status: 'closed', content: 'recover this draft', dirty: true });
    changed = false;
    await expect(session.save()).rejects.toThrow(/closed/i);
    expect(fixture.requests.some(request => request.init?.method === 'POST')).toBe(false);
  });

  it('closing the launching window while approval is pending rejects promptly without downloading code', async () => {
    const fixture = setup(); let approveStarted!: () => void;
    const started = new Promise<void>(resolve => { approveStarted = resolve; });
    fixture.options.approve = async () => { approveStarted(); return new Promise(() => {}); };
    const pending = prepareObsidianPluginSession(fixture.options);
    await started; fixture.life.abort();
    await expect(pending).rejects.toThrow(/closed|abort/i);
    expect(fixture.requests).toHaveLength(2);
  });

  it('mode changes revoke an old session permanently, including local draft updates', async () => {
    let current = true; const fixture = setup({ isCurrent: () => current });
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    session.setDraft('keep'); current = false;
    expect(() => session.setDraft('late')).toThrow(/authorization/i);
    current = true;
    await expect(session.save()).rejects.toThrow(/closed/i);
    expect(session.snapshot).toMatchObject({ status: 'closed', content: 'keep' });
  });

  it('window abort closes a ready document synchronously', async () => {
    const fixture = setup(); const session = (await prepareObsidianPluginSession(fixture.options))!;
    session.setDraft('keep'); fixture.life.abort();
    expect(session.snapshot).toMatchObject({ content: 'keep', status: 'closed' });
    expect(() => session.setDraft('late')).toThrow(/closed/i);
  });

  it('revocation during package preflight prevents the subsequent document write', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl; let revoke = false;
    fixture.options.fetchImpl = async (input, init) => {
      const response = await wire(input, init);
      if (revoke) fixture.life.abort();
      return response;
    };
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    session.setDraft('keep'); revoke = true;
    await expect(session.save()).rejects.toThrow(/closed|abort/i);
    expect(fixture.requests.some(request => request.init?.method === 'POST')).toBe(false);
  });

  it.each([
    ['changed source', (data: ReturnType<typeof packageData>) => { data.files[0].base64 = Buffer.from('tampered').toString('base64'); }],
    ['different manifest label', (data: ReturnType<typeof packageData>) => { data.manifest = { ...manifest, name: 'Spoofed name' }; }],
    ['duplicate asset', (data: ReturnType<typeof packageData>) => { data.assets.push(data.assets[0]); }],
    ['unsafe asset path', (data: ReturnType<typeof packageData>) => { data.assets[0].path = '../outside.js'; }],
    ['oversized total', (data: ReturnType<typeof packageData>) => { data.totalBytes = 65 * 1024 * 1024; }],
  ] as const)('rejects %s even if the package endpoint says success', async (_name, mutate) => {
    const fixture = setup(); const wire = fixture.options.fetchImpl;
    fixture.options.fetchImpl = async (input, init) => {
      if (!String(input).includes('fingerprint=')) return wire(input, init);
      const tampered = structuredClone(fixture.data); mutate(tampered); return json(tampered);
    };
    await expect(prepareObsidianPluginSession(fixture.options)).rejects.toThrow(/package|manifest|asset/i);
  });

  it.each(['https://example.com', 'http://127.0.0.1:4567/private', 'http://user:pass@127.0.0.1:4567'])('never sends the bearer token to an invalid origin: %s', async baseUrl => {
    const fixture = setup({ baseUrl });
    await expect(prepareObsidianPluginSession(fixture.options)).rejects.toThrow(/URL/i);
    expect(fixture.requests).toHaveLength(0);
  });

  it('an already aborted lifetime performs no requests', async () => {
    const fixture = setup(); fixture.life.abort();
    await expect(prepareObsidianPluginSession(fixture.options)).rejects.toThrow(/closed|abort/i);
    expect(fixture.requests).toHaveLength(0);
  });

  it('ignores a late approval after cancellation and never grants a successor session', async () => {
    const fixture = setup(); let answer!: (value: boolean) => void; let started!: () => void;
    const shown = new Promise<void>(resolve => { started = resolve; });
    fixture.options.approve = () => { started(); return new Promise(resolve => { answer = resolve; }); };
    const pending = prepareObsidianPluginSession(fixture.options);
    await shown; fixture.life.abort();
    await expect(pending).rejects.toThrow(/closed/i);
    answer(true); await Promise.resolve();
    expect(fixture.requests).toHaveLength(2);
  });

  it('does not let edits to the caller options rebind a pending native approval', async () => {
    const fixture = setup(); let answer!: (value: boolean) => void; let started!: () => void;
    const shown = new Promise<void>(resolve => { started = resolve; });
    let current = true;
    fixture.options.isCurrent = () => current;
    fixture.options.approve = () => { started(); return new Promise(resolve => { answer = resolve; }); };
    const pending = prepareObsidianPluginSession(fixture.options);
    await shown; current = false;
    fixture.options.isCurrent = () => true;
    answer(true);
    await expect(pending).rejects.toThrow(/authorization/i);
  });

  it('closing during document-body streaming cancels the body and ends preparation promptly', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl;
    let headers!: () => void;
    const reading = new Promise<void>(resolve => { headers = resolve; });
    const cancel = vi.fn();
    fixture.options.fetchImpl = async (input, init) => {
      if (!String(input).includes('/api/file')) return wire(input, init);
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"content":')); },
        // Signal after the consumer starts reading, not merely after fetch returns headers.
        pull() { headers(); }, cancel,
      }, { highWaterMark: 0 });
      return new Response(stream);
    };
    const pending = prepareObsidianPluginSession(fixture.options);
    await reading; await Promise.resolve(); fixture.life.abort();
    const outcome = await Promise.race([pending.then(() => 'unexpected success', () => 'closed'), new Promise(resolve => setTimeout(() => resolve('hung'), 40))]);
    expect(outcome).toBe('closed');
    expect(cancel).toHaveBeenCalled();
    expect(fixture.approve).not.toHaveBeenCalled();
  });

  it('rejects overlapping saves before issuing a second package preflight', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl;
    let hold = false; let release!: (response: Response) => void;
    fixture.options.fetchImpl = async (input, init) => hold && String(input).includes('/package')
      ? new Promise(resolve => { release = resolve; }) : wire(input, init);
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    session.setDraft('first'); hold = true;
    const saving = session.save();
    await expect(session.save()).rejects.toThrow(/progress/i);
    session.setDraft('second');
    release(json(fixture.data)); await saving;
    expect(session.snapshot).toMatchObject({ content: 'second', dirty: false });
    session.close();
  });

  it('keeps an existing document conflict without another package request or a misleading network error', async () => {
    const fixture = setup(); const wire = fixture.options.fetchImpl; let disconnected = false;
    fixture.options.fetchImpl = async (input, init) => {
      if (disconnected) throw new Error('Network disconnected');
      if (init?.method === 'POST') return json({ error: 'conflict' }, 409);
      return wire(input, init);
    };
    const session = (await prepareObsidianPluginSession(fixture.options))!;
    session.setDraft('keep conflicting draft');
    await expect(session.save()).rejects.toThrow(/conflict/i);
    disconnected = true;
    await expect(session.save()).rejects.toThrow(/conflict/i);
    expect(session.snapshot).toMatchObject({ status: 'conflict', content: 'keep conflicting draft' });
    session.close();
  });
});
