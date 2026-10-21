import { describe, expect, it } from 'vitest';
import { createReplayState, restoreReplayState, transitionReplay } from '@geminilight/mindos/knowledge/branch-replay';
import { requestRaceExample } from '@/components/echo/replay/replay-example';
import { buildReplayCanvas } from '@/components/echo/replay/replay-canvas-model';

describe('replay canvas visibility and spatial history',()=>{
 it('uses the decision tradeoff evidence instead of a later proposal and gives unknown paths a test question',()=>{
  const story=requestRaceExample('zh');const scene=story.scenes[0];const choice=scene.choices[1];const evidence=scene.evidence;
  choice.tradeoff={benefit:'收窄检查',cost:'多做一步',check:'同一输入下会怎样？',refs:evidence};choice.outcome={kind:'unobserved',title:'未知',steps:[]};
  let state=createReplayState(story);expect(buildReplayCanvas(story,state).nodes.find(n=>n.data.choiceId===choice.id)?.data.refs).toEqual(evidence);
  state=transitionReplay(story,state,{type:'choose',choiceId:choice.id});expect(buildReplayCanvas(story,state).nodes.find(n=>n.data.kind==='unknown')?.data.text).toBe('同一输入下会怎样？');
 });
 it('keeps practice progress when interface language changes',()=>{
  const english=requestRaceExample('en');let state=createReplayState(english);
  state=transitionReplay(english,state,{type:'choose',choiceId:'cache'});
  state=transitionReplay(english,state,{type:'advance'});
  expect(restoreReplayState(requestRaceExample('zh'),state).choiceId).toBe('cache');
 });
 it('reveals only the observed steps and preserves their positions on rewind and alternate choice',()=>{
  const story=requestRaceExample('zh');let state=createReplayState(story);
  const start=buildReplayCanvas(story,state);
  expect(start.nodes.filter(n=>n.data.kind==='step')).toHaveLength(0);
  state=transitionReplay(story,state,{type:'choose',choiceId:'cache'});
  state=transitionReplay(story,state,{type:'advance'});
  const first=buildReplayCanvas(story,state);
  expect(first.nodes.filter(n=>n.data.kind==='step')).toHaveLength(1);
  expect(first.nodes.map(n=>n.data.title)).not.toContain(story.scenes[0].choices[0].outcome.steps[1].title);
  const position=first.nodes.find(n=>n.data.kind==='step')!.position;
  state=transitionReplay(story,state,{type:'rewind'});
  state=transitionReplay(story,state,{type:'choose',choiceId:'guard'});
  state=transitionReplay(story,state,{type:'advance'});
  const alternate=buildReplayCanvas(story,state);
  expect(alternate.nodes.filter(n=>n.data.kind==='step')).toHaveLength(2);
  expect(alternate.nodes.find(n=>n.id===first.focusId)?.position).toEqual(position);
  expect(alternate.nodes.find(n=>n.id===first.focusId)?.data.status).toBe('visited');
  expect(alternate.nodes.find(n=>n.id===alternate.focusId)?.data.status).toBe('current');
 });
 it('shows an unobserved endpoint only after the route is chosen and never supplies an outcome',()=>{
  const story=requestRaceExample('en');story.scenes[0].choices[1].outcome={kind:'unobserved',title:'Unknown',steps:[]};
  let state=createReplayState(story);
  expect(buildReplayCanvas(story,state).nodes.some(n=>n.data.kind==='unknown')).toBe(false);
  state=transitionReplay(story,state,{type:'choose',choiceId:'guard'});
  const canvas=buildReplayCanvas(story,state);
  expect(canvas.nodes.filter(n=>n.data.kind==='unknown')).toHaveLength(1);
  expect(canvas.nodes.find(n=>n.id===canvas.focusId)?.data.refs).toEqual([]);
 });
 it('rejects an invalid scene cursor rather than drawing another scene',()=>{
  const story=requestRaceExample('en');
  expect(()=>buildReplayCanvas(story,{...createReplayState(story),sceneIndex:99})).toThrow('Invalid replay scene');
 });
});
