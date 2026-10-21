export function simulateRequestRace(input: {guard:boolean;oldDelay:number;newDelay:number;time:number}):{project:'A'|'B'|null;events:Array<{round:'old'|'current';time:number;ignored:boolean}>} {
  if([input.oldDelay,input.newDelay,input.time].some(v=>!Number.isFinite(v)||v<0||v>10000))throw new Error('Invalid simulation timing');
  const events = [
    {round:'old' as const,time:input.oldDelay,ignored:input.guard},
    {round:'current' as const,time:120+input.newDelay,ignored:false},
  ].filter(e=>e.time<=input.time).sort((a,b)=>a.time-b.time || (a.round==='old'?-1:1));
  let project:'A'|'B'|null=null;
  for(const event of events)if(!event.ignored)project=event.round==='current'?'B':'A';
  return {project,events};
}
