// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentAssistance } from '@/components/echo/coevolution/AgentAssistance';
import { EvidenceFields } from '@/components/echo/coevolution/editor-shared';
import { TransferEditor } from '@/components/echo/coevolution/TransferEditor';
import type { CoevolutionTask, CoevolutionMethod, CoevolutionRun } from '@geminilight/mindos/knowledge';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host=document.createElement('div');document.body.append(host);let root=createRoot(host);
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(host)});
const task={id:'task', corrections:[], agreements:[], applications:[], runs:[]} as unknown as CoevolutionTask;
it('asks the Agent for a source-based candidate before presenting a manual form',async()=>{
 const request=vi.fn();await act(async()=>root.render(<AgentAssistance task={task} feature="correction" locale="zh" busy={false} request={request}/>));
 expect(host.querySelectorAll('textarea')).toHaveLength(0);
 await act(async()=>host.querySelector('button')!.click());expect(request).toHaveBeenCalledWith('correction');
});
it('does not label an older receipt as the latest run',async()=>{
 const older={startedAt:1,collaboration:{context:'older contract'}};const newer={startedAt:2};
 await act(async()=>root.render(<AgentAssistance task={{...task,runs:[older,newer] as CoevolutionRun[]}} feature="handoff" locale="zh" busy={false} request={vi.fn()}/>));
 expect(host.querySelector('summary')).toBeNull();
});
it('uses the latest completed output verbatim while excluding unfinished runs',async()=>{
 const change=vi.fn();const runs=[{runId:'old',status:'completed',startedAt:1,output:'old output'},{runId:'new',status:'completed',startedAt:2,output:'new output'},{runId:'pending',status:'running',startedAt:3,output:'partial'}] as CoevolutionRun[];
 await act(async()=>root.render(<EvidenceFields value={{observation:'My judgment'}} change={change} runs={runs} locale="zh"/>));
 await act(async()=>host.querySelector('button')!.click());expect(change).toHaveBeenCalledWith({observation:'My judgment',evidenceKind:'run',runId:'new',quote:'new output'});
});
it('lets the human try a scoped method without inventing a rationale or filling a form',async()=>{
 const mutate=vi.fn().mockResolvedValue(true);const method={learningId:'l',attemptIndex:-1,revisionIndex:0,baseHash:'h',behavior:'Show a choice',scope:'This task',check:'Choice before outcome'} as CoevolutionMethod;
 await act(async()=>root.render(<TransferEditor task={task} methods={[method]} locale="zh" busy={false} mutate={mutate}/>));
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='按这个范围试用')!;
 await act(async()=>button.click());expect(mutate).toHaveBeenCalledWith(expect.objectContaining({action:'apply-method',disposition:'adopt',reason:'用户选择按原适用范围在本任务试用，效果待验证。'}));
 expect(host.querySelector('details')?.open).toBe(false);
});

it('excludes a run already in flight when the trial was activated', async () => {
 const change=vi.fn();const runs=[{runId:'old',status:'completed',startedAt:1,completedAt:9,output:'Old instructions'},{runId:'trial',status:'completed',startedAt:5,completedAt:7,output:'Trial instructions'}] as CoevolutionRun[];
 await act(async()=>root.render(<EvidenceFields value={{}} change={change} runs={runs} locale="zh" startedAfter={new Date(5).toISOString()}/>));
 await act(async()=>host.querySelector('button')!.click());
 expect(change).toHaveBeenCalledWith(expect.objectContaining({runId:'trial',quote:'Trial instructions'}));
 expect(host.textContent).not.toContain('Old instructions');
});
