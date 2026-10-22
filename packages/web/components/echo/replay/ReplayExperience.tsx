'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, GitBranch, Play, RotateCcw, Info, ShieldCheck, X } from 'lucide-react';
import { createReplayState, restoreReplayState, transitionReplay, historicalReplayChoice, type BranchStory, type ReplayAction } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import { ReplayCanvas } from './ReplayCanvas';
import { ReplayJourneyReview } from './ReplayJourneyReview';
import { OriginalRecord } from './ReplayEvidence';
import { replayCopy } from './replay-copy';
import { ReplayRaceLab } from './ReplayRaceLab';
import { DEFAULT_PRACTICE_CONDITIONS, practiceOutcome, restorePracticeConditions } from './replay-practice';
import { resumeReplayRoute, revisitReplayScene } from './replay-navigation';
import { ReplayPredictionGate } from './ReplayParticipation';
import { useReplayJudgments } from './useReplayJudgments';
import { judgmentKey } from './replay-judgments';
import './replay.css';

export function ReplayExperience({story,locale}:{story:BranchStory;locale:'zh'|'en'}) {
  const copy=replayCopy(locale);const storageKey=`mindos:branch-replay:${story.id}`;
  const [state,setState]=useState(()=>{
    try{return restoreReplayState(story,JSON.parse(localStorage.getItem(storageKey)||'null'));}
    catch{return createReplayState(story);}
  });
  const {judgments,saved:notesSaved,write,selectTransfer}=useReplayJudgments(story);
  const [pendingChoice,setPendingChoice]=useState<string|null>(null);
  const [pendingHistory,setPendingHistory]=useState(false);
  const [view,setView]=useState<'story'|'compare'|'journey'|'source'>('story');
  const tabs=story.scenes.length>1?['story','compare','journey','source'] as const:['story','compare','source'] as const;
  const [progressNotice,setProgressNotice]=useState<'restored'|'updated'|null>(()=>{
    try{const raw=JSON.parse(localStorage.getItem(storageKey)||'null');if(!raw)return null;
      if(raw.fingerprint!==story.fingerprint)return 'updated';
      return restoreReplayState(story,raw).attempts.length?'restored':null;
    }catch{return null;}
  });
  const [saved,setSaved]=useState(true);
  const [labConditions,setLabConditions]=useState(()=>{
    try{return restorePracticeConditions(story.fingerprint,JSON.parse(localStorage.getItem(`${storageKey}:practice`)||'null'));}
    catch{return {...DEFAULT_PRACTICE_CONDITIONS};}
  });
  const scene=story.scenes[state.sceneIndex];
  const choice=scene.choices.find(c=>c.id===state.choiceId);
  const lastStep=choice?.outcome.steps[state.visibleSteps-1];
  const attempts=state.attempts.filter(a=>a.sceneId===scene.id);
  const canTryAnother=attempts.length<scene.choices.length&&(state.phase==='complete'||state.phase==='unobserved')&&!choice?.nextSceneId;
  useEffect(()=>{let success=true;try{
    localStorage.setItem(storageKey,JSON.stringify(state));
    if(story.source.runtime==='example')localStorage.setItem(`${storageKey}:practice`,JSON.stringify({fingerprint:story.fingerprint,...labConditions}));
  }catch{success=false;}
    // Storage availability is a runtime result, not derivable from the cursor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(success);
  },[state,storageKey,labConditions,story.source.runtime,story.fingerprint]);
  const dispatch=useCallback((action:ReplayAction)=>{setProgressNotice(null);setState(s=>transitionReplay(story,s,action));},[story]);
  const commitChoice=useCallback((id:string)=>{
    setProgressNotice(null);
    setState(s=>{
      const fork=s.phase==='choice'?s:transitionReplay(story,s,{type:'rewind'});
      const chosen=transitionReplay(story,fork,{type:'choose',choiceId:id});
      return chosen.phase==='result'?transitionReplay(story,chosen,{type:'advance'}):chosen;
    });
    setView('story');
  },[story,setView]);
  const choose=useCallback((id:string)=>{
    if(pendingChoice)return;
    if(scene.prediction&&scene.choices.find(c=>c.id===id)?.outcome.kind==='recorded'&&!state.attempts.some(a=>a.sceneId===scene.id&&a.choiceId===id)){setPendingHistory(false);setPendingChoice(id);setView('story');return;}
    commitChoice(id);
  },[scene,state.attempts,commitChoice,pendingChoice]);
  const followHistory=()=>{
    const route=historicalReplayChoice(scene);if(!route)return;
    if(scene.prediction&&!state.attempts.some(a=>a.sceneId===scene.id&&a.choiceId===route.id&&a.visibleSteps>0)){
      setPendingHistory(true);setPendingChoice(route.id);return;
    }
    dispatch({type:'follow-history'});
  };
  const pending=scene.choices.find(c=>c.id===pendingChoice);
  const resume=(id:string)=>{setProgressNotice(null);setPendingChoice(null);setState(s=>resumeReplayRoute(story,s,id));setView('story');};
  const revisit=(index:number)=>{setProgressNotice(null);setPendingChoice(null);setState(s=>revisitReplayScene(story,s,index));setView('story');};
  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(pendingChoice||view!=='story'||event.altKey||event.metaKey||event.ctrlKey||target.closest('input,textarea,select,nav,[role=tab],[contenteditable=true],.replay-canvas-inspector,.replay-moment-panel,.replay-prediction'))return;
      if(!target.closest('.replay-shell')&&target!==document.body&&target.id!=='main-content')return;
      if(state.phase==='choice'&&/^[1-5]$/.test(event.key)){const option=scene.choices[Number(event.key)-1];if(option){event.preventDefault();choose(option.id);}}
      if(event.key==='ArrowLeft'&&state.choiceId){event.preventDefault();dispatch({type:'rewind'});}
      if(event.key==='ArrowRight'&&choice&&(state.phase==='result'||choice.nextSceneId)){event.preventDefault();dispatch({type:'advance'});}
    };window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);
  },[view,pendingChoice,state.phase,state.choiceId,scene,choice,choose,dispatch]);
  const current=state.phase==='unobserved'?copy.unknown:story.source.runtime==='example'&&choice?practiceOutcome(choice.id,state.visibleSteps,labConditions,copy).title:lastStep?.title||copy.beforeChoice;
  const renderPractice=(choiceId:string,visibleSteps:number)=><ReplayRaceLab choiceId={choiceId} visibleSteps={visibleSteps} locale={locale} conditions={labConditions} onConditionsChange={setLabConditions}/>;
  return <div className="replay-shell">
    <div className="replay-topline">
      <nav className="replay-tabs" role="tablist" aria-label={copy.replay} onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!(event.target as HTMLElement).closest('[role=tab]'))return;
        event.preventDefault();const index=(tabs as readonly string[]).indexOf(view);
        const tab=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
        setView(tab);document.getElementById(`replay-tab-${tab}`)?.focus();
      }}>
        {tabs.map(tab=><Button id={`replay-tab-${tab}`} key={tab} variant="ghost" role="tab" tabIndex={view===tab?0:-1} aria-selected={view===tab} aria-controls="replay-view" className="replay-tab" onClick={()=>setView(tab)}>{tab==='story'?copy.replay:tab==='compare'?copy.compare:tab==='journey'?copy.decisionChain:copy.source}</Button>)}
      </nav>
      <span className="replay-private" data-saving={saved} title={saved?copy.private:copy.unsaved}><ShieldCheck size={13}/>{!saved&&copy.unsaved}</span>
    </div>
    <header className="replay-heading">
      <div><h1 className="text-2xl font-semibold leading-tight tracking-tight">{view==='source'?copy.source:story.title}</h1><span className="replay-compact-identity">{copy.compactIdentity}</span></div>
      <span className="replay-scene-badge"><GitBranch size={13}/>{copy.scene} {state.sceneIndex+1}<span> / {story.scenes.length}</span></span>
    </header>
    <details className="replay-about"><summary><Info size={13}/>{copy.aboutReplay}</summary><div><p>{story.summary}</p><p>{copy.identityHint}</p><p>{story.source.runtime==='example'?copy.simulationNote:copy.recordedNote}</p><p>{copy.private}</p><p>{copy.keyboard}</p></div></details>
    {!notesSaved&&<p role="status" className="text-sm text-error">{copy.notesFailed}</p>}
    {progressNotice&&<div className="replay-resume-notice" role="status"><span>{copy[progressNotice]}</span><Button variant="ghost" size="icon-sm" aria-label={copy.dismissProgress} onClick={()=>setProgressNotice(null)}><X size={13}/></Button></div>}
    <div id="replay-view" className="replay-view" role="tabpanel" aria-labelledby={`replay-tab-${view}`}>
      {pending&&<div data-prediction-draft className="replay-prediction-draft" hidden={view!=='story'}><ReplayPredictionGate key={`${scene.id}/${pending.id}`} scene={scene} choice={pending} copy={copy} historical={pendingHistory} onCancel={()=>setPendingChoice(null)} onContinue={value=>{if(value)write(scene.id,pending.id,value);setPendingChoice(null);if(pendingHistory)dispatch({type:'follow-history'});else commitChoice(pending.id);}}/></div>}
      {view==='source'?<div className="replay-source-page"><OriginalRecord story={story} copy={copy}/></div>:view==='journey'?<ReplayJourneyReview story={story} state={state} copy={copy} onRevisit={revisit} judgments={judgments} onTransfer={selectTransfer}/>:<ReplayCanvas story={story} state={state} copy={copy} compare={view==='compare'} pending={!!pending&&view==='story'} onChoose={choose}
        onResume={resume} onRevisit={revisit} judgment={choice?judgments.entries[judgmentKey(scene.id,choice.id)]:undefined} onJudgment={patch=>{if(choice)write(scene.id,choice.id,patch);}}
        practice={story.source.runtime==='example'?{...labConditions,render:renderPractice}:undefined}>
        <div className="replay-dock-progress"><div className="replay-dock-title-row"><span className="replay-dock-label">{choice?`${state.historyFrom?copy.historicalRoute:copy.yourNow} · ${choice.label}`:copy.canvasJourney}</span>
          {choice&&choice.outcome.steps.length>0&&<span className="replay-step-count">{copy.revealed} {state.visibleSteps} / {choice.outcome.steps.length}</span>}</div>
          <span className="replay-dock-caption">{view==='compare'?copy.compareHint:state.phase==='choice'?copy.keyboard:state.phase==='complete'?copy.completed:state.phase==='unobserved'?copy.unknown:current}</span>
        </div>
        <div className="replay-dock-actions" inert={!!pending}>
          <Button variant="ghost" size="icon-sm" aria-label={copy.restart} onClick={()=>{dispatch({type:'restart'});setView('story');}}><RotateCcw size={15}/></Button>
          {view==='story'&&state.choiceId&&<>
            <Button variant={canTryAnother&&story.scenes.length===1?'amber':'outline'} onClick={()=>dispatch({type:'rewind'})}><ArrowLeft size={14}/>{canTryAnother?copy.tryAnother:copy.back}</Button>
            {state.phase==='unobserved'&&historicalReplayChoice(scene)&&<Button variant="amber" onClick={followHistory}>{copy.followHistory}<ArrowRight size={14}/></Button>}
            {(state.phase==='result'||(state.phase==='complete'&&choice?.nextSceneId))&&<Button variant="amber" onClick={()=>dispatch({type:'advance'})}><Play size={14}/>{state.phase==='complete'?copy.nextFork:copy.next}</Button>}
            {state.phase==='complete'&&!choice?.nextSceneId&&story.scenes.length>1&&<Button variant="amber" onClick={()=>setView('journey')}>{copy.reviewChain}<ArrowRight size={13}/></Button>}
            {state.phase==='complete'&&attempts.length>1&&<Button className="replay-dock-compare" variant={canTryAnother||story.scenes.length>1?'outline':'amber'} onClick={()=>setView('compare')}>{copy.compare}<ArrowRight size={13}/></Button>}
          </>}
          {view==='compare'&&<Button variant="outline" onClick={()=>{dispatch({type:'rewind'});setView('story');}}><ArrowLeft size={14}/>{copy.back}</Button>}
        </div>
      </ReplayCanvas>}
      <span className="sr-only" role="status" aria-live="polite">{choice?`${choice.label} · ${current}`:''}</span>
    </div>
  </div>;
}
