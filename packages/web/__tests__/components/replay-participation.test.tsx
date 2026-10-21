// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createReplayState, transitionReplay, validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { restoreJudgments } from '@/components/echo/replay/replay-judgments';
import { ReplayArtifactView, ReplayPredictionGate, ReplayTransferExercise } from '@/components/echo/replay/ReplayParticipation';
import { replayCopy } from '@/components/echo/replay/replay-copy';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const ref={messageId:'m',quote:'proposal.docx'};
const story=validateBranchStory({id:'participate-web',runtime:'codex',title:'测试',messages:[{id:'m',role:'assistant',text:'proposal.docx 已保存'}]}, {title:'先判断',summary:'测试',artifacts:[{id:'row',title:'任务行',fileName:'proposal.docx',sha256:'a'.repeat(64),capturedAt:'2026-10-22T01:00:00Z',modifiedAt:'2026-10-01T01:00:00Z',source:ref,columns:['任务','状态'],rows:[['Motion','<script>探索候选</script>']]}],transfer:{context:'验证器已经通过复跑',question:'现在怎样安排？',options:[{id:'ready',label:'检查新证据再定',feedback:'条件改变后重新核对承诺'},{id:'same',label:'保持原结论',feedback:'原结论有条件，先看条件是否改变'}],refs:[ref]},scenes:[{id:'s',title:'怎样选',context:'这里',evidence:[ref],prediction:{question:'读者会怎样理解？',options:['确定承诺','探索候选']},choices:[{id:'a',label:'标为候选',description:'说明状态',proposal:ref,outcome:{kind:'recorded',title:'已记录',steps:[{title:'出现真实文档',text:'观察',refs:[ref],artifactIds:['row']}]}},{id:'b',label:'先承诺',description:'待验证',proposal:ref,outcome:{kind:'unobserved',title:'没有验证',steps:[]}}]}]});
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host);});
it('lets a learner predict before revealing and skip without fabricating a prediction',async()=>{
 const onContinue=vi.fn();await act(async()=>root.render(<ReplayPredictionGate scene={story.scenes[0]} choice={story.scenes[0].choices[0]} copy={replayCopy('zh')} onContinue={onContinue} onCancel={()=>{}}/>));
 expect(host.textContent).not.toContain('出现真实文档');expect(host.textContent).not.toContain('条件改变');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='探索候选')!.click());
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('记下预测'))!.click());
 expect(onContinue.mock.calls[0][0].prediction).toBe('探索候选');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('直接看记录'))!.click());expect(onContinue.mock.calls[1][0]).toBeNull();
});
it('renders an artifact as literal table text with current-file provenance',async()=>{
 await act(async()=>root.render(<ReplayArtifactView artifact={story.artifacts![0]} copy={replayCopy('zh')}/>));
 expect(host.querySelector('table')?.textContent).toContain('Motion');expect(host.querySelector('script')).toBeNull();
 expect(host.textContent).toContain('本地现存文件');expect(host.textContent).toContain('不是当时每次修改的快照');
});
it('restores only bounded notes for existing routes and the same version',()=>{
 const valid={fingerprint:story.fingerprint,entries:{'s/a':{prediction:'探索候选',reason:'因为没有验证',confidence:'unsure',revision:'先核对验证器'}},transferId:'ready'};
 expect(restoreJudgments(story,valid).entries['s/a'].revision).toBe('先核对验证器');
 expect(restoreJudgments(story,{...valid,fingerprint:'old'}).entries).toEqual({});
 expect(restoreJudgments(story,{...valid,entries:{'s/foreign':{prediction:'fake'}}}).entries).toEqual({});
 expect(restoreJudgments(story,{...valid,transferId:'forged'}).transferId).toBeUndefined();
 expect(restoreJudgments(story,null).entries).toEqual({});
});
it('keeps transfer feedback hidden until an actual selection and enough evidence',async()=>{
 const onSelect=vi.fn();await act(async()=>root.render(<ReplayTransferExercise story={story} state={createReplayState(story)} copy={replayCopy('zh')} onSelect={onSelect}/>));expect(host.textContent).toBe('');
 let state=transitionReplay(story,createReplayState(story),{type:'choose',choiceId:'a'});state=transitionReplay(story,state,{type:'advance'});
 await act(async()=>root.render(<ReplayTransferExercise story={story} state={state} copy={replayCopy('zh')} onSelect={onSelect}/>));expect(host.textContent).toContain('验证器已经通过复跑');expect(host.textContent).not.toContain('条件改变后');
 await act(async()=>root.render(<ReplayTransferExercise story={story} state={state} selected="ready" copy={replayCopy('zh')} onSelect={onSelect}/>));expect(host.textContent).toContain('条件改变后');
});
