'use client';
import { useEffect,useState } from 'react';
import { FileText,Play,Pause,RotateCcw } from 'lucide-react';
import { simulateRequestRace } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
export function ReplayRaceLab({choiceId,visibleSteps,locale,conditions,onConditionsChange}:{choiceId:string;visibleSteps:number;locale:'zh'|'en';conditions:{oldDelay:number;newDelay:number};onConditionsChange:(values:{oldDelay:number;newDelay:number})=>void}){
 const zh=locale==='zh';const {oldDelay,newDelay}=conditions;
 const setOldDelay=(value:number)=>onConditionsChange({...conditions,oldDelay:value});
 const setNewDelay=(value:number)=>onConditionsChange({...conditions,newDelay:value});
 const [clock,setClock]=useState<{key:string;time:number}>({key:'',time:0});const [playingKey,setPlayingKey]=useState<string|null>(null);
 const max=Math.max(oldDelay,120+newDelay)+100;
 const clockKey=`${choiceId}:${visibleSteps}:${oldDelay}:${newDelay}`;
 const phaseTime=visibleSteps>1?max:120+newDelay;
 const time=clock.key===clockKey?clock.time:phaseTime;
 const playing=playingKey===clockKey&&time<max;
 const setPlaying=(value:boolean)=>setPlayingKey(value?clockKey:null);
 const setTime=(value:number)=>setClock({key:clockKey,time:value});
 useEffect(()=>{if(!playing)return;const id=setInterval(()=>setClock(c=>({key:clockKey,time:Math.min(max,(c.key===clockKey?c.time:phaseTime)+40)})),25);return()=>clearInterval(id);},[playing,max,clockKey,phaseTime]);
 const result=simulateRequestRace({guard:choiceId==='guard',oldDelay,newDelay,time});
 const stale=result.project==='A';
 return <div className="replay-result my-8">
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><span className="text-sm font-medium">{zh?'当前选择的影响':'Effect of this choice'}</span><span className="text-xs text-muted-foreground">{zh?'隔离演练 · 不修改项目':'Isolated practice · no project changes'}</span></div>
  <div className="mt-5 flex items-center justify-between gap-3"><span className="text-sm font-medium">{zh?'已选择：项目 B':'Selected: project B'}</span><span className={`rounded-md px-2 py-1 text-xs ${stale?'bg-error/10 text-error':'bg-success/10 text-success'}`}>{result.project?(zh?`实际显示：项目 ${result.project}`:`Showing project ${result.project}`):(zh?'等待返回':'Waiting for a response')}</span></div>
  <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">{(result.project==='A'?['旧项目说明.md','历史方案.md','旧测试.md']:['产品方向.md','界面讨论.md','验证计划.md']).map(name=><div key={name} className="flex items-center gap-3 border-b border-border py-3 text-sm last:border-0"><FileText size={15} className="text-muted-foreground"/><span>{result.project?name:'—'}</span><span className="ml-auto text-xs text-muted-foreground">{result.project?`Project ${result.project}`:''}</span></div>)}</div>
  <p className={`mt-4 text-sm leading-7 ${stale?'text-error':'text-muted-foreground'}`} aria-live="polite">{!result.project?(zh?'尚未收到当前内容，可以继续观察返回顺序。':'No current content has arrived yet. Keep observing.'):stale?(zh?'较早的返回覆盖了当前页面。':'An earlier response overwrote the page.'):(result.events.some(e=>e.ignored)?(zh?'旧结果已到达，被忽略；当前内容保留。':'The old response was ignored; current content is preserved.'):(zh?'当前内容已显示，还可以继续观察。':'The current content is shown; keep observing.'))}</p>
  <div className="mt-6 space-y-4 border-t border-border pt-5">{[{name:zh?'上一轮请求':'Earlier request',end:oldDelay,round:'old'},{name:zh?'当前轮请求':'Current request',end:120+newDelay,round:'current'}].map(row=><div className="flex items-center gap-3" key={row.round}><span className="w-24 shrink-0 text-xs text-muted-foreground">{row.name}</span><div className="relative h-6 flex-1"><span className="absolute top-3 h-px bg-border" style={{left:`${row.round==='old'?0:120/max*100}%`,width:`${(row.end-(row.round==='old'?0:120))/max*100}%`}}/><span className={`absolute top-2 h-2 w-2 rounded-full ${time>=row.end?'bg-[var(--amber)]':'bg-muted-foreground'}`} style={{left:`${row.end/max*100}%`}}/><span className="absolute -top-1 font-mono text-[11px] text-muted-foreground" style={{left:`${row.end/max*100}%`,transform:'translateX(-50%)'}}>{row.end} ms</span></div><span className="w-14 text-xs text-muted-foreground">{time>=row.end?(row.round==='old'&&choiceId==='guard'?(zh?'忽略':'Ignored'):(zh?'写入':'Applied')):'—'}</span></div>)}</div>
  <div className="mt-5 flex items-center gap-3"><Button variant="ghost" size="icon-sm" aria-label={zh?'播放演练':'Play practice'} onClick={()=>{if(time>=max)setTime(0);setPlaying(!playing);}}>{playing?<Pause size={14}/>:<Play size={14}/>}</Button><input type="range" min={0} max={max} step={10} value={time} onChange={e=>{setPlaying(false);setTime(Number(e.target.value));}} className="min-w-0 flex-1 accent-[var(--amber)]" aria-label={zh?'观察时刻':'Observation time'}/><span className="w-16 text-right font-mono text-xs">{time} ms</span><Button variant="ghost" size="icon-sm" aria-label={zh?'重播':'Replay'} onClick={()=>{setTime(0);setPlaying(true);}}><RotateCcw size={14}/></Button></div>
  <div className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-2"><label className="text-xs text-muted-foreground">{zh?'旧请求返回时间':'Old response timing'} <span className="float-right font-mono">{oldDelay} ms</span><input className="mt-3 w-full accent-[var(--amber)]" type="range" min={100} max={1600} step={100} value={oldDelay} onChange={e=>setOldDelay(Number(e.target.value))}/></label><label className="text-xs text-muted-foreground">{zh?'新请求耗时':'New request duration'} <span className="float-right font-mono">{newDelay} ms</span><input className="mt-3 w-full accent-[var(--amber)]" type="range" min={100} max={1200} step={100} value={newDelay} onChange={e=>setNewDelay(Number(e.target.value))}/></label></div>
 </div>;
}
