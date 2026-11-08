import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), sessions: vi.fn(), attach: vi.fn(), active: vi.fn(), read: vi.fn(), offer: vi.fn(), load: vi.fn(), messages: vi.fn() }));
vi.mock('@/lib/agent-run-store', async original => ({ ...await original<typeof import('@/lib/agent-run-store')>(), getMessages: mocks.messages }));
vi.mock('@/lib/agent-session-store', () => ({ resetAgentSessionStoreForTests: () => {}, refreshSessions: mocks.refresh, getSessions: mocks.sessions, attachRuntimeSession: mocks.attach, getActiveSessionId: mocks.active, loadSession: mocks.load }));
vi.mock('@/lib/runtime-session-history', () => ({ readRuntimeSessionHistory: mocks.read }));
vi.mock('@/lib/chat-task-draft', () => ({ offerTaskDraft: mocks.offer }));
import { experienceContinuationDraft, resumeExperience } from '@/lib/echo-experience-resume';
import { requestRaceExample } from '@/components/echo/replay/replay-example';
const source = { id: 'native-one', runtime: 'claude' as const, title: '测试', cwd: '/项目/一' };
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { vi.clearAllMocks(); mocks.messages.mockReturnValue([]); mocks.sessions.mockReturnValue([]); mocks.read.mockResolvedValue({ entry: { ...source, runtime: { id: 'claude', kind: 'claude', name: 'Claude Code' } }, messages: [] }); mocks.attach.mockReturnValue(true); mocks.active.mockReturnValue('local-one'); mocks.offer.mockReturnValue(true); });
describe('resume an experience in its original runtime session', () => {
  it('carries the final personal takeaway into the native draft for the same story version', () => {
    const story = { ...requestRaceExample('zh'), source: { ...requestRaceExample('zh').source, ...source } };
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.endsWith(':takeaway') ? JSON.stringify({ fingerprint: story.fingerprint, text: '先抽真实输出，再统计失效频率。' }) : null });
    expect(experienceContinuationDraft(source, story)).toContain('先抽真实输出，再统计失效频率。');
    vi.unstubAllGlobals();
  });
  it('does not carry another source, stale takeaway, or malformed browser note', () => {
    const story = { ...requestRaceExample('zh'), source: { ...requestRaceExample('zh').source, ...source } };
    for (const raw of [JSON.stringify({ fingerprint: 'old', text: '不应带回' }), '{broken']) {
      vi.stubGlobal('localStorage', { getItem: () => raw });
      expect(experienceContinuationDraft(source, story)).not.toContain('不应带回');
    }
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ fingerprint: story.fingerprint, text: '不应带回' }) });
    expect(experienceContinuationDraft({ ...source, id: 'another' }, story)).not.toContain('不应带回');
    vi.unstubAllGlobals();
  });
  it('carries a current unsaved takeaway even when browser storage fails', async () => {
    const story = { ...requestRaceExample('zh'), source: { ...requestRaceExample('zh').source, ...source } };
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    await resumeExperience(source, story, undefined, '尚未保存，但这是我想带回的判断。');
    expect(mocks.offer).toHaveBeenCalledWith('local-one', expect.stringContaining('尚未保存，但这是我想带回的判断。'));
    vi.unstubAllGlobals();
  });
  it('preserves current run-store messages even when session metadata has an empty message list', async () => {
    mocks.sessions.mockReturnValue([{ id: 'local-one', messages: [], runtimeSessionBinding: { runtime: 'claude', runtimeId: 'claude', externalSessionId: 'native-one' } }]);
    mocks.messages.mockReturnValue([{ role: 'user', content: '未同步的新消息' }]);
    await resumeExperience(source);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.attach.mock.calls[0][2]).not.toHaveProperty('messages');
  });
  it('binds the original native identity and directory before offering an unsent prompt', async () => {
    expect(await resumeExperience(source)).toMatchObject({ sessionId: 'local-one', draftOffered: true });
    expect(mocks.attach).toHaveBeenCalledWith(expect.objectContaining({ kind: 'claude' }), expect.objectContaining({ externalSessionId: 'native-one', cwd: '/项目/一' }), expect.anything());
    expect(mocks.offer).toHaveBeenCalledWith('local-one', expect.stringContaining('先核对当前项目状态'));
  });
  it('does not offer a prompt when a running session refuses rebinding', async () => {
    mocks.attach.mockReturnValue(false);
    await expect(resumeExperience(source)).rejects.toThrow(/运行|running/i);
    expect(mocks.offer).not.toHaveBeenCalled();
  });
  it('propagates missing history without creating an empty replacement', async () => {
    mocks.read.mockRejectedValue(new Error('会话已删除'));
    await expect(resumeExperience(source)).rejects.toThrow('会话已删除');
    expect(mocks.attach).not.toHaveBeenCalled();
  });
  it('reports a conflicting existing draft without replacing it', async () => {
    mocks.offer.mockReturnValue(false);
    expect(await resumeExperience(source)).toMatchObject({ sessionId: 'local-one', draftOffered: false });
  });
  it('does not bind or offer a draft if the user leaves while native history is loading', async () => {
    const controller = new AbortController();
    mocks.read.mockImplementation(async () => { controller.abort(); return { entry: source, messages: [] }; });
    await expect(resumeExperience(source, undefined, controller.signal)).rejects.toThrow();
    expect(mocks.attach).not.toHaveBeenCalled(); expect(mocks.offer).not.toHaveBeenCalled();
  });
});
