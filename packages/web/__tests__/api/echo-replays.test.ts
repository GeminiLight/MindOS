import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), saved: vi.fn(), save: vi.fn() }));
vi.mock('@geminilight/mindos/agent/runtime/adapters', () => ({ listReplaySources: mocks.list, readReplaySource: mocks.read }));
vi.mock('@geminilight/mindos/knowledge/branch-replay/store', () => ({ listBranchStories: mocks.saved, saveBranchStory: mocks.save }));
import { GET, POST } from '@/app/api/echo/replays/route';
import { extractBranchStory, type ReplaySource } from '@geminilight/mindos/knowledge/branch-replay';
const source = { id: 'one', runtime: 'codex', title: '产品选择', messages: [
  { id: 'm0', role: 'user', text: '请帮我思考如何设计我们的产品。' },
  { id: 'm1', role: 'assistant', text: '我们可以从工作台重新设计开始，重新安排导航与内容组织。' },
  { id: 'm2', role: 'user', text: '不要改变那么多，保留原来的文件树，在现有布局继续优化。' },
  { id: 'm3', role: 'assistant', text: '我们会保留原来的文件树和内容布局，只把来源与后续工作连接起来。' },
] };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); mocks.saved.mockReturnValue([]); mocks.read.mockResolvedValue(source); });
describe('Echo replay owner API', () => {
  it('keeps a previously curated story when the same source is imported again', async()=>{
    const value=extractBranchStory(source as ReplaySource)!;mocks.saved.mockReturnValue([value]);
    const res=await POST(new Request('http://localhost/api/echo/replays',{method:'POST',body:JSON.stringify({runtime:'codex',sessionId:'one'})}));
    expect(res.status).toBe(200);expect(mocks.read).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
    expect((await res.json()).story.fingerprint).toBe(value.fingerprint);
  });
  it('does not read or save a session after the request is cancelled',async()=>{
    const controller=new AbortController();controller.abort();
    const res=await POST(new Request('http://localhost/api/echo/replays',{method:'POST',signal:controller.signal,body:JSON.stringify({runtime:'codex',sessionId:'one'})}));
    expect(res.status).toBe(499);expect(mocks.read).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
  });
  it('returns private no-store data and separates source failures from an empty list', async () => {
    mocks.list.mockRejectedValueOnce(new Error('permission denied'));
    const res = await GET(new Request('http://localhost/api/echo/replays'));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const body = await res.json(); expect(body.sourceErrors).toHaveLength(1); expect(body.stories).toEqual([]);
  });
  it('extracts a source-grounded story and saves it locally', async () => {
    const res = await POST(new Request('http://localhost/api/echo/replays', { method: 'POST', body: JSON.stringify({ runtime: 'codex', sessionId: 'one' }) }));
    expect(res.status).toBe(200); const body = await res.json(); expect(body.story.scenes).toHaveLength(1); expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid requests without reading a session', async () => {
    const res = await POST(new Request('http://localhost/api/echo/replays', { method: 'POST', body: JSON.stringify({ runtime: 'codex', sessionId: '../secret' }) }));
    expect(res.status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not save a supplied draft with invented evidence', async () => {
    const draft = { title:'假的',summary:'假的',scenes:[] };
    const res = await POST(new Request('http://localhost/api/echo/replays', { method:'POST',body:JSON.stringify({ runtime:'codex',sessionId:'one',draft }) }));
    expect(res.status).toBe(422); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('reports no suitable decision and retains original-source access', async () => {
    mocks.read.mockResolvedValue({ ...source,messages:[source.messages[0]] });
    const res = await POST(new Request('http://localhost/api/echo/replays', { method:'POST',body:JSON.stringify({ runtime:'codex',sessionId:'one' }) }));
    expect(res.status).toBe(422); expect(mocks.save).not.toHaveBeenCalled();
  });
});
