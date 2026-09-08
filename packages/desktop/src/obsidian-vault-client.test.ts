import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createObsidianVaultClient } from './obsidian-vault-client';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const binding = { pluginId: 'reader', vaultId: 'a'.repeat(64), fingerprint: 'b'.repeat(64) };
function snapshot() {
  const files = [{ path: 'Notes/中文.md', base64: Buffer.from('hello').toString('base64'), sha256: hash('hello'), stat: { ctime: 1, mtime: 2, size: 5 } }];
  const folders = ['Notes'];
  return { vaultId: binding.vaultId, pluginFingerprint: binding.fingerprint, name: 'Mind', files, folders, totalBytes: 5,
    revision: hash(JSON.stringify(['mindos-plugin-vault-v1', binding.vaultId, folders, files.map(f => [f.path, f.sha256, f.stat.ctime, f.stat.mtime, f.stat.size])])) };
}
function client(data: unknown = snapshot()) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(data)));
  const life = new AbortController();
  return { fetchImpl, life, reader: createObsidianVaultClient({ baseUrl: 'http://127.0.0.1:4567', token: 'test-secret', ...binding, signal: life.signal, fetchImpl }) };
}
describe('main-only verified Vault transport', () => {
  it('pins the subject, verifies bytes and returns an immutable credential-free snapshot', async () => {
    const fixture = client(); const result = await fixture.reader.read();
    expect(result).toEqual(snapshot()); expect(Object.isFrozen(result.files[0].stat)).toBe(true);
    const [url, init] = fixture.fetchImpl.mock.calls[0];
    expect(String(url)).toContain(binding.fingerprint); expect(init).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer test-secret' } });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });
  it.each(['digest', 'private', 'traversal', 'duplicate', 'size', 'vault', 'plugin', 'revision', 'parent'])('rejects malformed or unbound %s data', async kind => {
    const data = snapshot();
    if (kind === 'digest') data.files[0].base64 = Buffer.from('other').toString('base64');
    if (kind === 'private') data.files[0].path = '.env';
    if (kind === 'traversal') data.files[0].path = '../secret';
    if (kind === 'duplicate') data.files.push(data.files[0]);
    if (kind === 'size') data.files[0].stat.size = -1;
    if (kind === 'vault') data.vaultId = 'c'.repeat(64);
    if (kind === 'plugin') data.pluginFingerprint = 'c'.repeat(64);
    if (kind === 'revision') data.revision = 'c'.repeat(64);
    if (kind === 'parent') data.folders = [];
    await expect(client(data).reader.read()).rejects.toThrow();
  });
  it('does not request data after revocation', async () => {
    const fixture = client(); fixture.life.abort(); await expect(fixture.reader.read()).rejects.toThrow();
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects non-loopback endpoints before credentials leave main', () => {
    expect(() => createObsidianVaultClient({ ...binding, baseUrl: 'https://example.com', token: 'secret', signal: new AbortController().signal })).toThrow();
  });
  it('terminates a pending read when its owner closes, even if the transport ignores abort', async () => {
    const life = new AbortController(); let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const reader = createObsidianVaultClient({ ...binding, baseUrl: 'http://127.0.0.1:4567', token: 'secret', signal: life.signal,
      fetchImpl: async () => { start(); return new Promise(() => {}); } });
    const pending = reader.read(); await started; life.abort(new Error('owner closed'));
    await expect(pending).rejects.toThrow('owner closed');
  });
});
