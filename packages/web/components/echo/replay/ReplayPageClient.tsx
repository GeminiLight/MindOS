'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ChevronDown, FileClock, GitBranch, LoaderCircle } from 'lucide-react';
import type { BranchStory, ReplaySource, ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { useLocale } from '@/lib/stores/locale-store';
import { WorkbenchPageShell } from '@/components/shared/ContentPageShell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ReplayExperience } from './ReplayExperience';
import { replayCopy } from './replay-copy';
import { requestRaceExample } from './replay-example';
import { OriginalRecord } from './ReplayEvidence';
import { ReplaySourcePicker, type ReplayLibrary } from './ReplaySourcePicker';
import './replay.css';

const subscribeToHydration=()=>()=>{};
const browserReady=()=>true;
const serverReady=()=>false;
export default function ReplayPageClient({initialStory=null}:{initialStory?:BranchStory|null}={}){
 const {locale}=useLocale();const copy=replayCopy(locale);
 // Restore browser-only progress after hydration; the source catalog is independent.
 const hydrated=useSyncExternalStore(subscribeToHydration,browserReady,serverReady);
 const [library,setLibrary]=useState<ReplayLibrary>({stories:[],sources:[],sourceErrors:[]});
 const [story,setStory]=useState<BranchStory|null>(initialStory);
 const activeStory=useMemo(()=>story?.source.runtime==='example'?requestRaceExample(locale):story,[story,locale]);
 const [loading,setLoading]=useState(true);const [catalogError,setCatalogError]=useState('');const [missing,setMissing]=useState(false);
 const [picker,setPicker]=useState(false);const [query,setQuery]=useState('');const [preparing,setPreparing]=useState<string|null>(null);
 const [sourceRuntime,setSourceRuntime]=useState<'codex'|'claude'>('codex');
 const [rawSource,setRawSource]=useState<ReplaySource|null>(null);const [fallbackSource,setFallbackSource]=useState<ReplaySource|null>(null);const [prepareError,setPrepareError]=useState('');
 const request=useRef<AbortController|null>(null);const catalog=useRef<AbortController|null>(null);const mounted=useRef(true);const loadVersion=useRef(0);const catalogQuery=useRef('');
 const cancelPrepare=()=>{request.current?.abort();request.current=null;setPreparing(null);};
 const refresh=useCallback(async(search='')=>{
  const version=++loadVersion.current;catalog.current?.abort();const controller=new AbortController();catalog.current=controller;catalogQuery.current=search;setLoading(true);
  const wanted=new URLSearchParams(window.location.search).get('story');
  if(wanted==='replay-example-request-race')setStory(current=>current||requestRaceExample(locale));
  try{
   const params=new URLSearchParams({runtime:sourceRuntime});if(search.trim())params.set('query',search.trim());
   const response=await fetch(`/api/echo/replays?${params}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});
   const data=await response.json();if(!response.ok)throw new Error(data.error||copy.error);
   if(!mounted.current||controller.signal.aborted||version!==loadVersion.current)return;
   setCatalogError('');setLibrary(data);
   const selected=data.stories.find((value:BranchStory)=>value.id===wanted);
   setMissing(!!wanted&&wanted!=='replay-example-request-race'&&!selected);
   // A linked experience never silently falls through to a different story.
   setStory(current=>current||(wanted==='replay-example-request-race'?requestRaceExample(locale):wanted?selected:data.stories[0])||null);
  }catch(error){if(mounted.current&&!controller.signal.aborted&&version===loadVersion.current)setCatalogError(error&&typeof error==='object'&&'name'in error&&error.name==='TimeoutError'?copy.loadTimeout:error instanceof Error?error.message:copy.error);}
  finally{if(mounted.current&&version===loadVersion.current)setLoading(false);}
 },[copy.error,copy.loadTimeout,sourceRuntime,locale]);
 // Catalog reads and cleanup are external effects; loading is immediate feedback.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;catalog.current?.abort();request.current?.abort();};},[refresh]);
 const select=(value:BranchStory)=>{
  cancelPrepare();setStory(value);setMissing(false);setRawSource(null);setFallbackSource(null);setPicker(false);setPrepareError('');
  const url=new URL(window.location.href);url.searchParams.set('story',value.id);window.history.replaceState({},'',url);
  document.getElementById('main-content')?.scrollTo({top:0,behavior:'auto'});
 };
 const prepare=async(source:ReplaySourceSummary,readOnly=false)=>{
  cancelPrepare();const controller=new AbortController();request.current=controller;setPreparing(source.id);setPrepareError('');setFallbackSource(null);
  try{
   const response=await fetch('/api/echo/replays',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runtime:source.runtime,sessionId:source.id,op:readOnly?'read':undefined}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
   const data=await response.json();if(controller.signal.aborted||!mounted.current)return;
   if(!response.ok){if(data.source)setFallbackSource(data.source);throw new Error(data.error||copy.error);}
   if(data.story){select(data.story);setLibrary(current=>({...current,stories:[data.story,...current.stories.filter(value=>value.id!==data.story.id)]}));}
   else if(data.source)setRawSource(data.source);
  }catch(error){if(!controller.signal.aborted&&mounted.current)setPrepareError(error instanceof Error?error.message:copy.error);}
  finally{if(request.current===controller&&mounted.current){request.current=null;setPreparing(null);}}
 };
 const changeQuery=(value:string)=>{setQuery(value);if(!value.trim()&&catalogQuery.current)void refresh();};
 const closePicker=()=>{cancelPrepare();setPicker(false);setRawSource(null);setFallbackSource(null);setPrepareError('');};
 return <WorkbenchPageShell className="replay-page mx-auto pb-10 pt-6 md:pt-8">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-center gap-2 text-xs text-muted-foreground"><Link href="/echo/overview" className="hover:text-foreground">{locale==='zh'?'回响':'Echo'}</Link>{locale==='zh'&&<><span>/</span><span>Echo</span></>}</div>
   <div className="flex items-center gap-2"><span className="hidden text-xs text-muted-foreground sm:inline">{story?.source.project||'MindOS'}</span><span className="hidden rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground sm:inline">{story?.source.runtime==='example'?copy.example:story?.source.runtime==='claude'?'Claude Code':story?.source.runtime==='codex'?'Codex':copy.curated}</span>
    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={()=>select(requestRaceExample(locale))}>{copy.example}<ArrowRight size={12}/></Button>
    <Button variant="outline" size="sm" className="min-h-9" onClick={()=>setPicker(true)}><FileClock size={14}/>{copy.newStory}<ChevronDown size={13}/></Button>
   </div>
  </div>
  {catalogError&&!picker&&!story&&<div role="alert" className="my-5 flex flex-wrap items-center gap-3 rounded-lg border border-error/25 bg-error/5 p-4 text-sm text-error"><span className="flex-1">{catalogError}</span><Button variant="ghost" onClick={()=>void refresh()}>{copy.retry}</Button></div>}
  {(!hydrated&&!!activeStory)||(loading&&!story)?<div role="status" className="flex min-h-80 flex-col items-center justify-center gap-5 text-sm text-muted-foreground"><LoaderCircle size={24} className="animate-spin"/>{copy.loadingSources}</div>:activeStory?<ReplayExperience key={`${activeStory.id}:${activeStory.fingerprint}`} story={activeStory} locale={locale}/>:<div className="py-20">
   <span className="mb-7 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber-text)]"><GitBranch size={22}/></span>
   <h1 className="text-3xl font-semibold tracking-tight">{catalogError?copy.error:missing?copy.missingTitle:copy.emptyTitle}</h1><p className="mt-4 max-w-xl text-sm leading-8 text-muted-foreground">{catalogError?copy.loadFailureBody:missing?copy.missingBody:copy.emptyBody}</p>
   <Button variant="amber" size="xl" className="mt-7 min-h-11" onClick={()=>setPicker(true)}>{copy.selectSource}<ArrowRight size={15}/></Button>
  </div>}
  <Dialog open={picker||!!rawSource} onOpenChange={open=>{if(!open)closePicker();}}>
   <DialogContent className="replay-picker-dialog sm:max-w-2xl">
    <DialogTitle className="shrink-0 pr-8">{rawSource?copy.source:copy.browse}</DialogTitle><DialogDescription className="shrink-0">{rawSource?rawSource.title:copy.local}</DialogDescription>
    {rawSource?<><Button variant="ghost" size="sm" className="shrink-0 self-start" onClick={()=>setRawSource(null)}><ArrowLeft size={14}/>{copy.backToPicker}</Button><div className="min-h-0 overflow-y-auto pr-3"><OriginalRecord key={`${rawSource.runtime}:${rawSource.id}`} source={rawSource} copy={copy}/></div></>:<ReplaySourcePicker library={library} copy={copy} runtime={sourceRuntime} query={query} loading={loading} preparing={preparing} error={prepareError||catalogError} hasOriginal={!!fallbackSource}
     onRuntime={runtime=>{if(sourceRuntime!==runtime){setPrepareError('');setFallbackSource(null);setCatalogError('');setQuery('');setLoading(true);setSourceRuntime(runtime);}}} onQuery={changeQuery} onSearch={()=>void refresh(query)} onRefresh={()=>void refresh(query)} onCancel={cancelPrepare} onSelect={select} onExample={()=>select(requestRaceExample(locale))} onPrepare={(source,readOnly)=>void prepare(source,readOnly)} onOriginal={()=>setRawSource(fallbackSource)}/>}
   </DialogContent>
  </Dialog>
 </WorkbenchPageShell>;
}
