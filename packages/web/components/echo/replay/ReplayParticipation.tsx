'use client';
import { useEffect, useRef, useState } from 'react';
import type { BranchStory, ReplayArtifact, ReplayChoice, ReplayScene, ReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import type { ReplayCopy } from './replay-copy';
import type { ReplayJudgment } from './replay-judgments';

export function ReplayPredictionGate({scene,choice,copy,onContinue,onCancel,historical=false}:{scene:ReplayScene;choice:ReplayChoice;copy:ReplayCopy;onContinue:(value:ReplayJudgment|null)=>void;onCancel:()=>void;historical?:boolean}){
 const panel=useRef<HTMLElement>(null);useEffect(()=>{panel.current?.focus({preventScroll:true});},[]);
 const [prediction,setPrediction]=useState('');const [reason,setReason]=useState('');const [confidence,setConfidence]=useState<ReplayJudgment['confidence']>('unsure');
 return <section ref={panel} tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onCancel();}}} className="replay-prediction" aria-label={copy.predictionTitle}>
  <p className="text-xs text-muted-foreground">{historical?copy.historicalRoute:copy.yourNow} · {choice.label}</p>
  <h2 className="mt-3 text-xl font-semibold">{copy.predictionTitle}</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">{copy.predictionHint}</p>
  <fieldset className="mt-6"><legend className="mb-3 text-base font-medium">{scene.prediction?.question}</legend><div className="flex flex-wrap gap-2">{scene.prediction?.options.map(option=><Button key={option} variant={prediction===option?'secondary':'outline'} aria-pressed={prediction===option} onClick={()=>setPrediction(option)}>{option}</Button>)}</div></fieldset>
  <label className="mt-5 block text-sm" htmlFor="replay-prediction-reason">{copy.predictionReason}</label><textarea id="replay-prediction-reason" className="replay-note-input" maxLength={600} rows={2} value={reason} onChange={event=>setReason(event.target.value)}/>
  <fieldset className="mt-4"><legend className="mb-2 text-sm text-muted-foreground">{copy.predictionConfidence}</legend><div className="flex flex-wrap gap-2">{(['unsure','likely','confident'] as const).map(value=><Button key={value} size="sm" variant="ghost" aria-pressed={confidence===value} className={confidence===value?'bg-muted':''} onClick={()=>setConfidence(value)}>{copy[value]}</Button>)}</div></fieldset>
  <div className="mt-6 flex flex-wrap gap-3"><Button variant="amber" disabled={!prediction} onClick={()=>onContinue({prediction,reason,confidence})}>{copy.savePrediction}</Button><Button variant="outline" onClick={()=>onContinue(null)}>{copy.skipPrediction}</Button><Button variant="ghost" onClick={onCancel}>{copy.cancelChoice}</Button></div>
 </section>;
}

export function ReplayArtifactView({artifact,copy}:{artifact:ReplayArtifact;copy:ReplayCopy}){
 return <section className="replay-artifact" aria-label={artifact.title}>
  <div className="replay-artifact-caption"><span>{copy.fileExcerpt}</span><span>{artifact.fileName}</span></div>
  <h3 className="text-base font-semibold leading-7">{artifact.title}</h3>
  <div className="replay-artifact-table"><table><thead><tr>{artifact.columns.map((column,i)=><th key={i}>{column}</th>)}</tr></thead><tbody>{artifact.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
  <p className="replay-table-hint text-xs leading-6 text-muted-foreground">{copy.tableSwipe}</p>
  <p className="mt-3 text-xs leading-6 text-muted-foreground">{copy.artifactBoundary}</p>
  <details className="mt-2 text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{copy.artifactDetails}</summary><p>{copy.currentFile} · {artifact.fileName}</p><p>{copy.modified} · {new Date(artifact.modifiedAt).toLocaleString()}</p><p>{copy.captured} · {new Date(artifact.capturedAt).toLocaleString()}</p><p className="break-all font-mono">SHA-256 · {artifact.sha256}</p></details>
 </section>;
}

export function ReplayJudgmentFeedback({entry,copy,onChange,unknown=false}:{entry?:ReplayJudgment;copy:ReplayCopy;onChange:(patch:Partial<ReplayJudgment>)=>void;unknown?:boolean}){
 const field=unknown?'nextCheck':'revision';
 return <div className="replay-judgment-feedback">
  {entry?.prediction&&<><p className="text-xs text-muted-foreground">{copy.yourPrediction}{entry.confidence?` · ${copy[entry.confidence]}`:''}</p><p className="mt-2 text-sm font-medium leading-7">{entry.prediction}</p>{entry.reason&&<p className="mt-1 text-sm leading-7 text-muted-foreground">{copy.yourReason} · {entry.reason}</p>}</>}
  <label htmlFor={`replay-${field}`} className="mt-3 block text-sm leading-7">{unknown?copy.planCheck:copy.changeMind}</label><textarea id={`replay-${field}`} className="replay-note-input" rows={2} maxLength={600} value={entry?.[field]??''} onChange={event=>onChange({[field]:event.target.value})}/>
 </div>;
}

export function ReplayTransferExercise({story,state,selected,copy,onSelect}:{story:BranchStory;state:ReplayState;selected?:string;copy:ReplayCopy;onSelect:(id:string)=>void}){
 const exercise=story.transfer;if(!exercise)return null;
 const refs=state.attempts.flatMap(a=>story.scenes.find(s=>s.id===a.sceneId)?.choices.find(c=>c.id===a.choiceId)?.outcome.steps.slice(0,a.visibleSteps).flatMap(step=>step.refs)??[]);
 const terminal=state.attempts.some(a=>{const c=story.scenes.at(-1)?.choices.find(c=>c.id===a.choiceId);return a.sceneId===story.scenes.at(-1)?.id&&c?.outcome.kind==='recorded'&&a.visibleSteps===c.outcome.steps.length;});
 if(!terminal||!exercise.refs.every(r=>refs.some(seen=>seen.messageId===r.messageId&&seen.quote.includes(r.quote))))return null;
 const feedback=exercise.options.find(o=>o.id===selected)?.feedback;
 return <section className="replay-transfer" aria-label={copy.transferTitle}><p className="text-xs text-muted-foreground">{copy.transferLabel}</p><h2 className="mt-2 text-lg font-semibold">{copy.transferTitle}</h2><p className="mt-3 text-sm leading-7">{exercise.context}</p><p className="mt-2 text-sm leading-7 text-muted-foreground">{copy.transferHint}</p><fieldset className="mt-4"><legend className="mb-3 text-sm font-medium">{exercise.question}</legend><div className="flex flex-col gap-2">{exercise.options.map(option=><Button key={option.id} variant={selected===option.id?'secondary':'outline'} className="h-auto justify-start whitespace-normal py-3 text-left leading-6" aria-pressed={selected===option.id} onClick={()=>onSelect(option.id)}>{option.label}</Button>)}</div></fieldset>{feedback&&<p role="status" className="replay-learning-note mt-4 text-sm leading-7">{feedback}</p>}</section>;
}
