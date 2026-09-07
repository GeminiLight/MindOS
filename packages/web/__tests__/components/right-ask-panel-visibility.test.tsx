// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import RightAskPanel from '@/components/RightAskPanel';
vi.mock('@/components/chat/ChatContent', () => ({ default: () => <textarea aria-label="Draft" defaultValue="Preserved draft" /> }));
it('removes a folded help panel from focus and accessibility while retaining its draft', async () => {
 (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=async(open:boolean)=>act(async()=>root.render(<RightAskPanel open={open} onClose={()=>{}} width={400} onWidthChange={()=>{}} onWidthCommit={()=>{}}/>));
 try {
  await render(true);const input=host.querySelector('textarea')!;input.value='Keep my unsent work';
  await render(false);expect(host.querySelector('aside')?.hasAttribute('inert')).toBe(true);expect(host.querySelector('aside')?.getAttribute('aria-hidden')).toBe('true');
  await render(true);expect(host.querySelector('aside')?.hasAttribute('inert')).toBe(false);expect(host.querySelector('textarea')).toBe(input);expect(input.value).toBe('Keep my unsent work');
 } finally {await act(async()=>root.unmount());host.remove();}
});
