import { describe,expect,it } from 'vitest';
import { simulateRequestRace } from './race.js';
describe('bounded request-race practice',()=>{
 it('shows a temporary recovery followed by stale overwrite for a cache-only choice',()=>{
  expect(simulateRequestRace({guard:false,oldDelay:900,newDelay:200,time:320}).project).toBe('B');
  expect(simulateRequestRace({guard:false,oldDelay:900,newDelay:200,time:900}).project).toBe('A');
 });
 it('keeps the current round and ignores the late old result with a guard',()=>{
  const result=simulateRequestRace({guard:true,oldDelay:900,newDelay:200,time:900});
  expect(result.project).toBe('B');expect(result.events.find(e=>e.round==='old')?.ignored).toBe(true);
 });
 it('changes the observed outcome when the arrival order changes, and rejects invalid timing',()=>{
  expect(simulateRequestRace({guard:false,oldDelay:150,newDelay:200,time:900}).project).toBe('B');
  expect(()=>simulateRequestRace({guard:false,oldDelay:NaN,newDelay:200,time:900})).toThrow();
  expect(()=>simulateRequestRace({guard:false,oldDelay:-1,newDelay:200,time:900})).toThrow();
 });
});
