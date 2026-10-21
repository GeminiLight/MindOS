import { describe, expect, it } from 'vitest';
import { DEFAULT_PRACTICE_CONDITIONS, restorePracticeConditions } from '@/components/echo/replay/replay-practice';

describe('restoring practice conditions',()=>{
 it('restores edited timings for the same scenario',()=>{
  expect(restorePracticeConditions('race-v1',{fingerprint:'race-v1',oldDelay:100,newDelay:400})).toEqual({oldDelay:100,newDelay:400});
 });
 it('uses defaults for absent, stale, or corrupt browser storage',()=>{
  for(const raw of [null,{},'broken',{fingerprint:'old',oldDelay:100,newDelay:400},{fingerprint:'race-v1',oldDelay:Infinity,newDelay:200}]){
   expect(restorePracticeConditions('race-v1',raw)).toEqual(DEFAULT_PRACTICE_CONDITIONS);
  }
 });
 it('accepts slider limits and rejects values a user cannot select',()=>{
  expect(restorePracticeConditions('race-v1',{fingerprint:'race-v1',oldDelay:1600,newDelay:1200})).toEqual({oldDelay:1600,newDelay:1200});
  for(const values of [{oldDelay:0,newDelay:200},{oldDelay:900,newDelay:1300},{oldDelay:105,newDelay:200},{oldDelay:'900',newDelay:200}]){
   expect(restorePracticeConditions('race-v1',{fingerprint:'race-v1',...values})).toEqual(DEFAULT_PRACTICE_CONDITIONS);
  }
 });
});
