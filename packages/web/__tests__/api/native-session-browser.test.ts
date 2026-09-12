import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/agent-runtimes/external-sessions/route';
const mocks = vi.hoisted(() => ({ browse: vi.fn(), legacy: vi.fn() }));
vi.mock('@geminilight/mindos/agent/runtime/adapters', async importOriginal => {
  const original = await importOriginal<typeof import('@geminilight/mindos/agent/runtime/adapters')>();
  return { ...original, browseNativeSessions: mocks.browse, listRuntimeSessionTranscripts: mocks.legacy };
});
import { NativeSessionBrowserError } from '@geminilight/mindos/agent/runtime/adapters';
beforeEach(() => vi.clearAllMocks());
describe('native session browser API', () => {
  it('returns a metadata page without caching', async () => {
    mocks.browse.mockResolvedValue({ sessions: [{ id: 'one' }], nextCursor: '30' });
    const result = await GET(new Request('http://test/api/agent-runtimes/external-sessions?runtimeId=claude&page=1&cursor=0&query=design'));
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toEqual({ sessions: [{ id: 'one' }], nextCursor: '30' });
  });
  it.each([400, 404, 500] as const)('preserves actionable %s errors', async status => {
    mocks.browse.mockRejectedValue(new NativeSessionBrowserError('Cannot read session', status));
    const result = await GET(new Request('http://test/api/agent-runtimes/external-sessions?runtimeId=claude&page=1'));
    expect(result.status).toBe(status);
  });
});
