// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SessionHistoryPanel from '@/components/ask/SessionHistoryPanel';
vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ t: { ask: {}, hints: {} } }) }));
const runtime = { id: 'claude', kind: 'claude' as const, name: 'Claude' };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const close = vi.fn(), open = vi.fn(), load = vi.fn(), searchChanged = vi.fn();
const scrollState = { current: { key: '', top: 0 } };
beforeEach(() => {
  vi.clearAllMocks(); scrollState.current = { key: '', top: 0 };
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(extra: Record<string, unknown> = {}) {
  act(() => root.render(<SessionHistoryPanel sessions={[{ id: 'saved', title: 'Saved conversation', messages: [], createdAt: 1, updatedAt: 1 }]} activeSessionId={null}
    selectedAgentRuntime={runtime} runtimeSessionsSupported runtimeSessions={[{ id: 'native', title: 'Native conversation', runtime, updatedAt: 2 }]}
    onLoad={load} onDelete={vi.fn()} onRename={vi.fn()} onTogglePin={vi.fn()} onClearAll={vi.fn()} onClose={close} onNewChat={vi.fn()}
    onAttachRuntimeSession={open} onForkRuntimeSession={vi.fn()} onExternalQueryChange={searchChanged} {...{ scrollStateRef: scrollState }} {...extra} />));
}
function key(target: Element, value: string, composing = false) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, isComposing: composing })));
}
function change(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('commits Chinese search only after composition and never closes while choosing a candidate', () => {
  render(); const input = host.querySelector('input')!;
  act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  change(input, 'ni'); key(input, 'Escape', true); key(input, 'ArrowDown', true);
  expect(searchChanged).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input);
  change(input, '你好'); act(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' })));
  expect(searchChanged).toHaveBeenCalledWith('你好');
});
it('clears search before closing on Escape and restores focus after clicking clear', () => {
  render(); const input = host.querySelector('input')!; change(input, 'Native'); key(input, 'Escape');
  expect(input.value).toBe(''); expect(close).not.toHaveBeenCalled();
  change(input, 'Saved'); const clear = host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!;
  clear.focus(); act(() => clear.click()); expect(document.activeElement).toBe(input);
  key(input, 'Escape'); expect(close).toHaveBeenCalledTimes(1);
});
it('navigates native and saved results from search and opens saved rows with the keyboard', () => {
  render(); const input = host.querySelector('input')!;
  const native = host.querySelector<HTMLElement>('[data-runtime-session-row]')!, saved = host.querySelector<HTMLElement>('[data-session-history-row]')!;
  key(input, 'ArrowDown'); expect(document.activeElement).toBe(native);
  key(native, 'ArrowDown'); expect(document.activeElement).toBe(saved);
  key(saved, 'Home'); expect(document.activeElement).toBe(native);
  key(native, 'End'); expect(document.activeElement).toBe(saved);
  key(saved, 'Enter'); expect(load).toHaveBeenCalledWith('saved'); expect(open).not.toHaveBeenCalled();
});
it('does not open a row while keyboard events originate inside its action buttons', () => {
  render(); const action = host.querySelector('[data-runtime-session-row] button')!;
  key(action, 'Enter'); expect(open).not.toHaveBeenCalled();
});
it('restores the previous scroll position on remount and resets it for a different search', () => {
  render(); const list = host.querySelector<HTMLElement>('[data-history-scroll]')!;
  expect(list).not.toBeNull(); list.scrollTop = 420; act(() => list.dispatchEvent(new Event('scroll')));
  act(() => root.render(null)); render();
  expect(host.querySelector('[data-history-scroll]')!.scrollTop).toBe(420);
  render({ externalQuery: 'Native' }); expect(host.querySelector('[data-history-scroll]')!.scrollTop).toBe(0);
});
it('skips the busy native row during keyboard navigation', () => {
  render({ runtimeSessionActionId: 'native' }); const input = host.querySelector('input')!; key(input, 'ArrowDown');
  expect(document.activeElement).toBe(host.querySelector('[data-session-history-row]'));
});
it('consumes Escape inside history so its containing chat does not close as well', () => {
  render(); const dismissChat = vi.fn(); window.addEventListener('keydown', dismissChat);
  try { key(host.querySelector('input')!, 'Escape'); expect(close).toHaveBeenCalledOnce(); expect(dismissChat).not.toHaveBeenCalled(); }
  finally { window.removeEventListener('keydown', dismissChat); }
});
