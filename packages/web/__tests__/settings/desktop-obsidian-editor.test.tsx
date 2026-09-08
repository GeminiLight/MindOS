// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopObsidianEditor } from '@/components/settings/DesktopObsidianEditor';
import { getDesktopBridge } from '@/lib/desktop-bridge';

vi.mock('@/lib/desktop-bridge', () => ({ getDesktopBridge: vi.fn() }));
let root: Root; let host: HTMLDivElement; const open = vi.fn();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks(); open.mockResolvedValue({ opened: true });
  vi.mocked(getDesktopBridge).mockReturnValue({ checkUpdate: vi.fn(), getAppInfo: async () => ({ mode: 'local' }), openObsidianEditor: open });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<DesktopObsidianEditor plugins={[{ id: 'tables', name: 'Tables' }]} />)); }
async function enter(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(host.querySelector('input'), value);
    host.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

it('stays absent in a browser or a remote desktop', async () => {
  vi.mocked(getDesktopBridge).mockReturnValue(null); await render(); expect(host.textContent).toBe('');
  await act(async () => root.unmount()); root = createRoot(host);
  vi.mocked(getDesktopBridge).mockReturnValue({ checkUpdate: vi.fn(), getAppInfo: async () => ({ mode: 'remote' }), openObsidianEditor: open });
  await render(); expect(host.textContent).toBe('');
});
it('only requests a native launch on explicit valid submission', async () => {
  await render(); expect(open).not.toHaveBeenCalled();
  await enter('笔记/表格.md'); await submit();
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith('tables', '笔记/表格.md');
  expect(host.textContent).toContain('已打开');
});
it.each(['', '../Private.md', '/root.md', 'note.txt'])('rejects invalid note paths even on direct form submission: %s', async value => {
  await render(); await enter(value); await submit(); expect(open).not.toHaveBeenCalled();
});
it('prevents duplicate submissions and shows native cancellation without claiming the editor opened', async () => {
  let done!: (value: { opened: boolean }) => void; open.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  await render(); await enter('Tables.md'); await submit(); await submit();
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => done({ opened: false })); expect(host.textContent).toContain('已取消');
});
it('shows a launch failure and permits retry', async () => {
  open.mockRejectedValueOnce(new Error('Local server unavailable'));
  await render(); await enter('Tables.md'); await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Local server unavailable');
  await submit(); expect(open).toHaveBeenCalledTimes(2);
});
