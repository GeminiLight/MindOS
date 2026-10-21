import { simulateRequestRace } from '@geminilight/mindos/knowledge/branch-replay';
import type { ReplayCopy } from './replay-copy';

export interface PracticeConditions {oldDelay:number;newDelay:number;}
export const DEFAULT_PRACTICE_CONDITIONS:PracticeConditions={oldDelay:900,newDelay:200};
export function restorePracticeConditions(fingerprint:string,raw:unknown):PracticeConditions {
  if(raw&&typeof raw==='object'){
    const value=raw as Record<string,unknown>;
    const valid=(n:unknown,max:number):n is number=>typeof n==='number'&&Number.isInteger(n)&&n>=100&&n<=max&&n%100===0;
    if(value.fingerprint===fingerprint&&valid(value.oldDelay,1600)&&valid(value.newDelay,1200))return {oldDelay:value.oldDelay,newDelay:value.newDelay};
  }
  return {...DEFAULT_PRACTICE_CONDITIONS};
}
export function practiceOutcome(choiceId:string,visibleSteps:number,conditions:PracticeConditions,copy:ReplayCopy){
  const result=simulateRequestRace({guard:choiceId==='guard',...conditions,
    time:visibleSteps>1?Math.max(conditions.oldDelay,120+conditions.newDelay)+100:120+conditions.newDelay});
  const ignored=result.events.some(e=>e.ignored);
  return {project:result.project,ignored,
    title:result.project==='A'?copy.overwrittenTitle:ignored?copy.preservedTitle:copy.currentTitle,
    text:result.project==='A'?copy.overwrittenResult:ignored?copy.ignoredResult:copy.currentResult};
}
