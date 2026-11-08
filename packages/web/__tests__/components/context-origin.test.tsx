// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import ContextOriginBar from '@/components/chat/ContextOriginBar';
const mocks = vi.hoisted(() => ({ rootId: 'root-a', error: undefined as string | undefined, push: vi.fn(), close: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/studio/one', useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'zh' }) }));
vi.mock('@/lib/views/hooks', () => ({ useViewsIndex: () => ({ data: { rootId: mocks.rootId }, error: mocks.error, refresh: mocks.refresh }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const origin = { rootId: 'root-a', title: '产品方向', folder: '项目', position: { kind: 'project' as const, id: 'one', title: '产品方向', folder: '项目', mode: 'view' as const, file: '项目/简报.md' }, items: [{ id: 'brief', label: '简报.md', path: '项目/简报.md' }] };
beforeEach(() => { vi.clearAllMocks(); mocks.rootId = 'root-a'; mocks.error = undefined; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('shows the handoff receipt and returns to its presentation without a route reload', async () => {
  const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  await act(async () => root.render(<ContextOriginBar origin={origin} close={mocks.close} />));
  expect(host.textContent).toContain('产品方向');
  expect(host.textContent).toContain('简报.md');
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '回到资料')!.click());
  expect(replace.mock.calls[0][2]).toContain('mode=view');
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
  replace.mockRestore();
});
it('opens a listed source in the same Context without including additional material', async () => {
  const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  await act(async () => root.render(<ContextOriginBar origin={origin} close={mocks.close} />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="查看 简报.md"]')!.click());
  expect(replace.mock.calls[0][2]).toContain('mode=files');
  expect(replace.mock.calls[0][2]).toContain(encodeURIComponent('项目/简报.md'));
  replace.mockRestore();
});
it('does not return into a different library or expose the previous material list', async () => {
  mocks.rootId = 'root-b';
  await act(async () => root.render(<ContextOriginBar origin={origin} close={mocks.close} />));
  expect(host.textContent).toContain('资料库已切换');
  expect(host.textContent).not.toContain('简报.md');
  expect(host.querySelector('button')).toBeNull();
});
it('offers retry instead of an endless loading message when origin validation fails', async () => {
  mocks.error = 'NETWORK_ERROR';
  await act(async () => root.render(<ContextOriginBar origin={origin} close={mocks.close} />));
  expect(host.textContent).toContain('暂时无法核对 Context 来源');
  expect(host.textContent).not.toContain('简报.md');
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重试')!.click());
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
