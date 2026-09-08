import { describe, expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { installObsidianPluginDocument } from './obsidian-plugin-document';

function fixture(source = 'window.fixture = "</SCRIPT>";') {
  let respond!: (request: Request) => Response;
  const clearStorageData = vi.fn().mockResolvedValue(undefined);
  const session = { protocol: { handle: vi.fn((_scheme, handler) => { respond = handler; }) }, clearStorageData };
  const document = installObsidianPluginDocument(session as unknown as Session, source, () => '<body>trusted shell</body>');
  return { document, session, response: (url = document.url, method = 'GET') => respond(new Request(url, { method })) };
}

describe('isolated plugin document transport', () => {
  it('serves only in-memory source with safe script delimiting and an offline Worker-capable policy', async () => {
    const f = fixture(); const response = f.response();
    expect(f.session.protocol.handle).toHaveBeenCalledWith('https', expect.any(Function));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('window.fixture = "<\\/script>";');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'; worker-src blob:; frame-src 'none'");
    expect(f.document.origin).toMatch(/^https:\/\/[0-9a-f-]{36}\.obsidian\.mindos\.invalid$/);
    const shell = f.response(f.document.shellUrl);
    expect(await shell.text()).toBe('<body>trusted shell</body>');
    expect(shell.headers.get('content-security-policy')).toContain(`worker-src 'none'; frame-src ${f.document.origin}`);
    expect(new URL(f.document.shellUrl).origin).not.toBe(f.document.origin);
  });
  it('does not map foreign origins, other paths, queries or non-GET methods to source', async () => {
    const f = fixture();
    for (const url of ['https://example.com/frame', `${f.document.origin}/`, `${f.document.url}?data=secret`, `${f.document.origin}/file.txt`]) {
      expect(f.response(url).status).toBe(403);
    }
    for (const method of ['POST', 'HEAD', 'PUT', 'DELETE']) expect(f.response(f.document.url, method).status).toBe(403);
    expect(fixture().document.origin).not.toBe(f.document.origin);
  });
  it('revokes response bytes before clearing only its session storage and never restores them on failure', async () => {
    const f = fixture(); f.session.clearStorageData.mockRejectedValueOnce(new Error('Storage unavailable'));
    const clearing = f.document.revoke();
    expect(f.response().status).toBe(403);
    expect(f.response(f.document.shellUrl).status).toBe(403);
    await expect(clearing).rejects.toThrow('Storage unavailable');
    expect(f.response().status).toBe(403);
    expect(f.session.clearStorageData).toHaveBeenCalledOnce();
  });
  it('reports synchronous storage teardown failure through one shared cleanup promise', async () => {
    const f = fixture(); f.session.clearStorageData.mockImplementation(() => { throw new Error('Session stopped'); });
    const pending = f.document.revoke();
    await expect(pending).rejects.toThrow('Session stopped');
    expect(f.document.revoke()).toBe(pending);
    expect(f.session.clearStorageData).toHaveBeenCalledOnce();
    expect(f.response().status).toBe(403);
  });
});
