// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChangesBanner from '@/components/changes/ChangesBanner';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const state=vi.hoisted(()=>({pathname:'/echo/replay',agentCount:2}));
const write=vi.hoisted(()=>vi.fn());
vi.mock('next/navigation',()=>({usePathname:()=>state.pathname}));
vi.mock('@/hooks/useAgentChangeReview',()=>({useAgentChangeReview:()=>({unreadAgentCount:state.agentCount,unreadCount:3,unreviewedPathCount:1,unreviewedEvents:[{id:'pending'}]})}));
vi.mock('@/lib/agent-review-reminder',()=>({readDismissedAgentReviewIds:()=>new Set(),writeDismissedAgentReviewIds:write}));
vi.mock('@/lib/stores/locale-store',()=>({useLocale:()=>({t:{changes:{agentReviewNoticeTitle:()=> '待审阅修改',agentReviewNoticeMeta:()=> '尚未确认',reviewAgentChanges:'审阅',reviewAgentShort:'审阅',activityNoticeTitle:()=> '新活动',activityNoticeMeta:'工作动态',viewActivity:'查看',dismiss:'关闭'}}})}));
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
beforeEach(()=>{state.pathname='/echo/replay';state.agentCount=2;write.mockClear();vi.useFakeTimers();vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);});
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host);vi.useRealTimers();vi.unstubAllGlobals();});
const render=async()=>{await act(async()=>{root.render(<ChangesBanner/>);await vi.advanceTimersByTimeAsync(0);});};
describe('uninterrupted replay reading',()=>{
 it('defers a pending review while reading and presents it after leaving without dismissing it',async()=>{
  await render();expect(host.querySelector('[data-changes-banner]')).toBeNull();
  state.pathname='/wiki';await render();expect(host.textContent).toContain('待审阅修改');expect(write).not.toHaveBeenCalled();
 });
 it('immediately clears an existing overlay on entry and can show the same pending review again',async()=>{
  state.pathname='/wiki';await render();expect(host.querySelector('[data-changes-banner]')).not.toBeNull();
  state.pathname='/echo/replay';await render();expect(host.querySelector('[data-changes-banner]')).toBeNull();
  state.pathname='/wiki';await render();expect(host.querySelectorAll('[data-changes-banner]')).toHaveLength(1);expect(write).not.toHaveBeenCalled();
 });
 it('does not silently auto-dismiss ordinary activity during replay or suppress unrelated routes',async()=>{
  state.agentCount=0;await render();await act(async()=>vi.advanceTimersByTimeAsync(20000));expect(host.querySelector('[data-changes-banner]')).toBeNull();
  state.pathname='/echo/replayground';await render();expect(host.textContent).toContain('新活动');
 });
});
