// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResponsiveInboxDetails } from '@/components/inbox/ResponsiveInboxDetails';
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia = vi.fn().mockReturnValue({matches:true}); HTMLElement.prototype.scrollIntoView = vi.fn(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it('takes narrow-screen focus into the selected detail and provides a return action', async () => {
 const back = vi.fn();
 await act(async () => root.render(<ResponsiveInboxDetails selectedPath="Inbox/a.md" backLabel="Back to queue" onBack={back}><p>Actual note</p></ResponsiveInboxDetails>));
 expect(document.activeElement).toBe(host.querySelector('button'));
 await act(async () => host.querySelector('button')!.click());
 expect(back).toHaveBeenCalledOnce();
});
it('does not move desktop focus or offer an empty mobile detail', async () => {
 window.matchMedia = vi.fn().mockReturnValue({matches:false});
 await act(async () => root.render(<ResponsiveInboxDetails selectedPath={null} backLabel="Back" onBack={() => {}}><p>Select a note</p></ResponsiveInboxDetails>));
 expect(host.querySelector('aside')?.className).toContain('hidden xl:block');
 expect(host.querySelector('button')).toBeNull();
 expect(document.activeElement).toBe(document.body);
});

vi.mock('@/lib/stores/locale-store', async () => {
 const {messages} = await import('@/lib/i18n'); return {useLocale: () => ({t:messages.en})};
});
vi.mock('next/navigation', () => ({useRouter: () => ({push:vi.fn()})}));
it('lets the nested batch button handle Enter and Space without opening the row', async () => {
 const {InboxFileRow} = await import('@/components/inbox/InboxFileRow');
 const select = vi.fn(); const toggle = vi.fn();
 await act(async () => root.render(<InboxFileRow file={{name:'a.md',path:'Inbox/a.md',size:2,modifiedAt:new Date().toISOString(),isAging:false}} index={0} animate={false} selected={false} multiSelect onSelect={select} onToggleChecked={toggle} onDelete={() => {}} />));
 const button = host.querySelector('[data-inbox-row-select-control]')!;
 for (const key of ['Enter',' ']) {
   const event = new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
   await act(async () => button.dispatchEvent(event));
   expect(event.defaultPrevented).toBe(false);
 }
 expect(select).not.toHaveBeenCalled();
 await act(async () => (button as HTMLButtonElement).click());
 expect(toggle).toHaveBeenCalledOnce();
});
