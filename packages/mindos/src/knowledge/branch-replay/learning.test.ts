import { describe, expect, it } from 'vitest';
import { validateBranchStory } from './index.js';
const reference={messageId:'m',quote:'误差 5 mm，分数 0.69。'};
const source={id:'learning',runtime:'claude' as const,title:'取舍',messages:[{id:'m',role:'assistant' as const,text:'误差 5 mm，分数 0.69。先做局部检查。'}]};
function draft(){return {title:'判断',summary:'重访取舍',scenes:[{id:'s',title:'先检查什么？',context:'观察分数',evidence:[reference],reconsideration:{prompt:'这个分数漏了什么？',insight:'先核对局部误差',refs:[reference]},choices:[
 {id:'a',label:'局部检查',description:'检查物体',proposal:reference,tradeoff:{benefit:'定位局部问题',cost:'要逐个检查',check:'先检查哪个物体？',refs:[reference]},rejoin:{note:'原会话随后调整检查方式',refs:[reference]},outcome:{kind:'recorded',title:'记录',steps:[{title:'出现误差',text:'观察结果',refs:[reference],signals:[{label:'误差',value:'5 mm'},{label:'分数',value:'0.69'}]}]}},
 {id:'b',label:'先汇总',description:'看整场',proposal:reference,outcome:{kind:'unobserved',title:'未知',steps:[]}},
 ]}]};}
describe('evidence-bound learning details',()=>{
 it('retains tradeoffs, reconsideration, observed signals and a documented rejoin',()=>{
  const story=validateBranchStory(source,draft());expect(story.scenes[0].reconsideration?.prompt).toContain('漏了什么');
  expect(story.scenes[0].choices[0].tradeoff?.cost).toBe('要逐个检查');expect(story.scenes[0].choices[0].outcome.steps[0].signals?.[1].value).toBe('0.69');
 });
 it('rejects an attractive metric that is absent from its quoted evidence',()=>{
  const value=draft();value.scenes[0].choices[0].outcome.steps[0].signals[0].value='100%';
  expect(()=>validateBranchStory(source,value)).toThrow(/signal|evidence/i);
 });
 it('checks references on editorial tradeoffs and reconsideration',()=>{
  const value=draft();value.scenes[0].choices[0].tradeoff.refs=[{messageId:'missing',quote:'证据'}];
  expect(()=>validateBranchStory(source,value)).toThrow(/missing/i);
  const other=draft();other.scenes[0].reconsideration.refs=[{messageId:'m',quote:'不存在'}];expect(()=>validateBranchStory(source,other)).toThrow(/quote/i);
 });
 it('cannot add an unseen result through a rejoin notice or attach one to an unknown path',()=>{
  const value=draft();value.scenes[0].choices[0].rejoin.refs=[{messageId:'m',quote:'先做局部检查'}];
  expect(()=>validateBranchStory(source,value)).toThrow(/rejoin|observed/i);
  const unknown=draft();Object.assign(unknown.scenes[0].choices[1],{rejoin:{note:'后来已通过',refs:[reference]}});
  expect(()=>validateBranchStory(source,unknown)).toThrow(/rejoin|recorded/i);
 });
});
