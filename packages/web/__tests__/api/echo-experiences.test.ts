import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ page: vi.fn(), read: vi.fn(), saved: vi.fn(), save: vi.fn(), boundary: vi.fn() }));
vi.mock('@geminilight/mindos/agent/runtime/adapters', () => ({ listReplaySourcePage: mocks.page, readReplaySource: mocks.read }));
vi.mock('@geminilight/mindos/knowledge/branch-replay/store', () => ({ listBranchStories: mocks.saved, readBranchStory: (id: string) => mocks.saved().find((story: {id: string}) => story.id === id) || null, saveBranchStory: mocks.save }));
vi.mock('@/lib/research-http', async original => ({ ...await original<typeof import('@/lib/research-http')>(), ownerBoundary: mocks.boundary }));
import { GET, POST } from '@/app/api/echo/experiences/route';
beforeEach(() => { vi.clearAllMocks(); mocks.boundary.mockResolvedValue(null); mocks.page.mockResolvedValue({ sources: [], nextCursor: null }); mocks.saved.mockReturnValue([]); });
const request = (body: unknown) => new NextRequest('http://localhost/api/echo/experiences', { method: 'POST', body: JSON.stringify(body) });
describe('project experiences', () => {
  it('pages both sources independently and preserves a working runtime when another fails', async () => {
    mocks.page.mockImplementation(({ runtime }) => runtime === 'claude' ? Promise.reject(new Error('unreadable')) : Promise.resolve({ sources: [{ id: 'one', runtime: 'codex' }], nextCursor: '50' }));
    const res = await GET(new NextRequest('http://localhost/api/echo/experiences'));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(await res.json()).toMatchObject({ sources: [{ id: 'one' }], cursors: { codex: '50', claude: null }, sourceErrors: [{ runtime: 'claude' }] });
  });
  it('does not read transcripts until a bounded, valid batch is requested', async () => {
    expect((await POST(request({ sources: [] }))).status).toBe(400);
    expect((await POST(request({ sources: Array(9).fill({ runtime: 'codex', id: 'one' }) }))).status).toBe(400);
    expect((await POST(request({ sources: [{ runtime: 'codex', id: '../secret' }] }))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('separates no decision from read failure without failing the complete project', async () => {
    mocks.read.mockImplementation((runtime, id) => id === 'bad' ? Promise.reject(new Error('missing')) : Promise.resolve({ id, runtime, title: '普通记录', messages: [] }));
    const res = await POST(request({ sources: [{ runtime: 'claude', id: 'empty' }, { runtime: 'codex', id: 'bad' }] }));
    expect(await res.json()).toMatchObject({ episodes: [{ status: 'no-decisions' }, { status: 'unavailable' }] });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not allow a rejected owner boundary to scan the user machine', async () => {
    mocks.boundary.mockResolvedValue(Response.json({}, { status: 401 }));
    expect((await GET(new NextRequest('http://localhost/api/echo/experiences'))).status).toBe(401);
    expect((await POST(request({ sources: [{ runtime: 'codex', id: 'one' }] }))).status).toBe(401);
    expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
});
