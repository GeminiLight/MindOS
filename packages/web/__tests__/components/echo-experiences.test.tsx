// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ params: '', push: vi.fn(), resume: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.params) }));
vi.mock('@/hooks/useSmoothRouterPush', () => ({ useSmoothRouterPush: () => state.push }));
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'zh' }) }));
vi.mock('@/lib/echo-experience-resume', () => ({ resumeExperience: state.resume }));
vi.mock('@/components/echo/replay/ReplayExperience', () => ({ ReplayExperience: ({ initialSceneId }: { initialSceneId?: string }) => <div data-canvas>{initialSceneId || 'canvas'}</div> }));
import ExperiencesPageClient from '@/components/echo/experiences/ExperiencesPageClient';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
const fetcher = vi.fn();
const source = { id: 'one', runtime: 'codex', title: '真实项目判断', projectId: 'project-one', project: '项目一', projectPath: '/项目/一', cwd: '/项目/一', updatedAt: 1000 };
const episode = { source, status: 'ready', title: '一次取舍', storyId: 'replay-codex-one', decisions: [{ id: 'fork-1', title: '怎样选择', context: '当时尚不确定下一步怎样验证。' }] };
const catalog = { sources: [source], episodes: [episode], cursors: { codex: '50', claude: null }, sourceErrors: [] };
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.includes(text))!;
beforeEach(() => { vi.clearAllMocks(); state.params = ''; window.history.replaceState(null, '', '/echo/experiences'); vi.stubGlobal('fetch', fetcher); fetcher.mockResolvedValue(response(catalog)); });
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); localStorage.clear(); });
describe('project experience journey', () => {
  it('shows previously discovered projects on home while hiding cached archived sessions by default',async()=>{
    const found={...source,id:'found-home',projectId:'project-found-home',project:'已经发现的较早项目'};
    const archived={...source,id:'archived-home',projectId:'project-archived-home',project:'已归档项目',archived:true};
    sessionStorage.setItem('mindos:echo-experiences:catalog:v2',JSON.stringify({...catalog,sources:[source,found,archived]}));
    await act(async()=>root.render(<ExperiencesPageClient/>));
    expect(host.querySelector('.experience-project-grid')?.textContent).toContain('已经发现的较早项目');
    expect(host.querySelector('.experience-project-grid')?.textContent).not.toContain('已归档项目');
  });
  it('accepts a new search while initial discovery is pending and ignores the late initial response',async()=>{
    let finish!:(value:unknown)=>void;
    const found={...source,id:'found-fast',projectId:'fast-project',project:'快速搜索找到的项目'};
    fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(response({...catalog,sources:[found],episodes:[]}));
    await act(async()=>root.render(<ExperiencesPageClient/>));
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
    const field=host.querySelector('input[aria-label="搜索项目或会话"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,'快速');field.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await act(async()=>finish(response(catalog)));
    expect(host.textContent).toContain('快速搜索找到的项目');
    expect(host.querySelector('.experience-project-grid')?.textContent).not.toContain('项目一');
  });
  it('retains project sessions discovered by search after reloading a deep project link', async () => {
    const found={...source,id:'found',projectId:'project-found',project:'搜索发现的项目'};
    fetcher.mockResolvedValueOnce(response(catalog)).mockResolvedValueOnce(response({...catalog,sources:[found],episodes:[{...episode,source:found,storyId:'replay-codex-found'}],cursors:{codex:null,claude:null}})).mockResolvedValue(response(catalog));
    await act(async()=>root.render(<ExperiencesPageClient/>));
    const field=host.querySelector('input[aria-label="搜索项目或会话"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,'搜索发现');field.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await act(async()=>root.unmount());root=createRoot(host);state.params='project=project-found';
    await act(async()=>root.render(<ExperiencesPageClient/>));
    expect(host.querySelector('h1')?.textContent).toBe('搜索发现的项目');
    expect(host.querySelector('.experience-project-start')?.textContent).toContain('一次取舍');
  });
  it('labels a completed replay as a revisit rather than promising a fresh start', async () => {
    state.params = 'project=project-one';
    localStorage.setItem('mindos:branch-replay:replay-codex-one',JSON.stringify({sceneIndex:0,phase:'complete',attempts:[{sceneId:'fork-1'}]}));
    await act(async () => root.render(<ExperiencesPageClient/>));
    expect(host.querySelector('.experience-project-start')?.textContent).toContain('回看这段经历');
    expect(host.querySelector('.experience-project-start')?.textContent).not.toContain('开始这段回放');
  });
  it('names and opens the richer prepared experience instead of silently opening the first session', async () => {
    state.params = 'project=project-one';
    const second = { ...source, id: 'two', createdAt: 2000 };
    const rich = { ...episode, source: second, storyId: 'replay-codex-two', title: '完整的五层取舍', decisions: Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, title: `第${i + 1}层问题`, context: '尚未揭晓的结果' })) };
    fetcher.mockResolvedValue(response({ ...catalog, sources: [{ ...source, createdAt: 1000 }, second], episodes: [episode, rich] }));
    await act(async () => root.render(<ExperiencesPageClient/>));
    const entry = host.querySelector('.experience-project-start')!;
    expect(entry.querySelector('h2')?.textContent).toContain('完整的五层取舍');
    expect(entry.textContent).not.toContain('尚未揭晓的结果');
    await act(async () => entry.querySelector<HTMLButtonElement>('button')!.click());
    expect(window.location.search).toContain('story=replay-codex-two');
  });
  it('keeps non-playable records available in a collapsed section', async () => {
    state.params = 'project=project-one';
    const ordinary = { ...source, id: 'ordinary', title: '普通会话' };
    fetcher.mockResolvedValue(response({ ...catalog, sources: [source, ordinary], episodes: [episode, { source: ordinary, status: 'no-decisions' }] }));
    await act(async () => root.render(<ExperiencesPageClient/>));
    const details = host.querySelector<HTMLDetailsElement>('.experience-other-sessions');
    expect(details).not.toBeNull(); expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('普通会话');
    expect(host.querySelector('.experience-timeline')?.textContent).not.toContain('普通会话');
  });
  it('explains a queued draft conflict instead of silently navigating without the new judgment', async () => {
    state.params = 'project=project-one&story=replay-codex-one';
    fetcher.mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(response(init?.method === 'POST' ? { story: { id: 'replay-codex-one', source } } : catalog)));
    state.resume.mockResolvedValue({ sessionId: 'chat-one', draftOffered: false, draft: '本次新的判断' });
    await act(async () => root.render(<ExperiencesPageClient/>));
    await act(async () => button('带着判断继续工作').click());
    expect(state.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('已有一份待接收的草稿');
    expect((document.querySelector('[role=dialog] textarea') as HTMLTextAreaElement)?.value).toContain('本次新的判断');
  });
  it('discovers projects first and preserves the project in the selected journey URL', async () => {
    await act(async () => root.render(<ExperiencesPageClient/>));
    expect(host.querySelector('h1')?.textContent).toContain('回到值得重走');
    await act(async () => button('项目一').click());
    expect(window.location.search).toBe('?project=project-one');
  });
  it('opens a specific decision without exposing its outcome on the project home', async () => {
    state.params = 'project=project-one';
    await act(async () => root.render(<ExperiencesPageClient/>));
    await act(async () => button('怎样选择').click());
    expect(window.location.search).toContain('story=replay-codex-one&scene=fork-1');
    expect(host.textContent).not.toContain('结果成功');
    expect(host.textContent).not.toContain('当时尚不确定下一步怎样验证。');
  });
  it('keeps existing projects available after discovery fails and permits retry', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(catalog));
    await act(async () => root.render(<ExperiencesPageClient/>));
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    await act(async () => button('刷新重试').click());
    expect(host.textContent).toContain('项目一');
  });
  it('loads older pages with independent cursors and deduplicates repeated sessions', async () => {
    fetcher.mockResolvedValueOnce(response(catalog)).mockResolvedValueOnce(response({ ...catalog, sources: [source, { ...source, id: 'two' }], cursors: { codex: null, claude: null } }));
    await act(async () => root.render(<ExperiencesPageClient/>));
    await act(async () => button('发现更早记录').click());
    expect(fetcher.mock.calls[1][0]).toContain('codex=50&claude=done');
    expect(host.textContent).toContain('2 段会话');
    expect(host.textContent).not.toContain('3 段会话');
  });
});
