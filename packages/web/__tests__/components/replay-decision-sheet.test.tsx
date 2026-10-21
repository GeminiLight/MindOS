// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { ReplayDecisionSheet } from '@/components/echo/replay/ReplayDecisionSheet';
import { requestRaceExample } from '@/components/echo/replay/replay-example';
import { replayCopy } from '@/components/echo/replay/replay-copy';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host);});
it('offers every route above long context and jumps without selecting it',async()=>{
 const story=requestRaceExample('zh');const choose=vi.fn();
 await act(async()=>root.render(<ReplayDecisionSheet scene={{...story.scenes[0],context:'长情境。'.repeat(100)}} state={createReplayState(story)} copy={replayCopy('zh')} onChoose={choose} onClose={vi.fn()}/>));
 const nav=host.querySelector('nav[aria-label="跳到选项"]');expect(nav).not.toBeNull();expect(nav?.querySelectorAll('button')).toHaveLength(2);
 const scroll=vi.fn();Object.defineProperty(host.querySelector('.replay-decision-body'),'scrollTo',{value:scroll});
 await act(async()=>nav!.querySelectorAll<HTMLButtonElement>('button')[1].click());
 expect(scroll).toHaveBeenCalled();expect(choose).not.toHaveBeenCalled();
});
