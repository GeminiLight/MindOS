'use client';
import { ArrowRight, GitBranch, LoaderCircle, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import type { BranchStory, ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import type { ReplayCopy } from './replay-copy';

export interface ReplayLibrary { stories:BranchStory[];sources:ReplaySourceSummary[];sourceErrors:Array<{runtime:string;error:string}>; }
interface Props {
 library:ReplayLibrary;copy:ReplayCopy;runtime:'codex'|'claude';query:string;loading:boolean;preparing:string|null;error:string;hasOriginal:boolean;
 onRuntime:(runtime:'codex'|'claude')=>void;onQuery:(query:string)=>void;onSearch:()=>void;onRefresh:()=>void;onCancel:()=>void;
 onSelect:(story:BranchStory)=>void;onExample:()=>void;onPrepare:(source:ReplaySourceSummary,readOnly?:boolean)=>void;onOriginal:()=>void;
}
export function ReplaySourcePicker({library,copy,runtime,query,loading,preparing,error,hasOriginal,onRuntime,onQuery,onSearch,onRefresh,onCancel,onSelect,onExample,onPrepare,onOriginal}:Props){
 const filtered=library.sources.filter(source=>source.runtime===runtime&&`${source.title} ${source.project||''}`.toLowerCase().includes(query.trim().toLowerCase()));
 return <>
  <div className="replay-picker-saved">{library.stories.map(story=><Button key={story.id} variant="outline" size="sm" disabled={!!preparing} onClick={()=>onSelect(story)}><GitBranch size={12}/>{story.title}</Button>)}<Button variant="ghost" size="sm" disabled={!!preparing} onClick={onExample}>{copy.example}<ArrowRight size={12}/></Button></div>
  <div className="flex shrink-0 gap-2">{(['codex','claude'] as const).map(value=><Button variant="ghost" size="sm" key={value} aria-pressed={runtime===value} disabled={!!preparing} onClick={()=>onRuntime(value)} className={runtime===value?'bg-muted':''}>{value==='codex'?'Codex':'Claude Code'}</Button>)}</div>
  <form onSubmit={event=>{event.preventDefault();if(!loading&&!preparing)onSearch();}} className="flex shrink-0 gap-2">
   <div className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground"/><input autoFocus maxLength={160} disabled={!!preparing} className="min-h-11 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={copy.search} aria-label={copy.search} value={query} onChange={event=>onQuery(event.target.value)}/>{query&&<Button variant="ghost" size="icon-sm" className="absolute right-1 top-1.5" aria-label={copy.clearSearch} disabled={!!preparing} onClick={()=>onQuery('')}><X size={14}/></Button>}</div>
   <Button type="submit" variant="outline" className="min-h-11" disabled={loading||!!preparing}><Search size={15}/><span className="sr-only">{copy.search}</span></Button>
  </form>
  {error&&<div role="alert" className="replay-picker-error"><p>{error}</p><div className="mt-2 flex flex-wrap gap-2">{hasOriginal?<Button variant="outline" size="sm" onClick={onOriginal}>{copy.inspect}<ArrowRight size={12}/></Button>:<Button variant="outline" size="sm" onClick={onRefresh}>{copy.retry}</Button>}</div></div>}
  <div className="replay-picker-list" aria-busy={loading}>
   {loading?<div role="status" className="flex min-h-36 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle size={17} className="animate-spin"/>{copy.loadingSources}</div>:<>
    {library.sourceErrors.map(item=><p key={item.runtime} className="py-3 text-xs leading-6 text-error">{item.runtime}: {item.error}</p>)}
    {!filtered.length&&<div className="py-8 text-center text-sm leading-7 text-muted-foreground"><p>{query?copy.noMatchingSources:copy.noSources}</p>{query&&<p className="mt-2 text-xs">{copy.searchMore}</p>}</div>}
    {filtered.map(source=><div key={`${source.runtime}:${source.id}`} className="flex items-start gap-3 border-b border-border py-4 last:border-0"><GitBranch size={16} className="mt-1 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><h3 className="line-clamp-2 text-sm font-medium leading-6">{source.title}</h3><p className="mt-1 text-xs text-muted-foreground">{source.runtime==='codex'?'Codex':'Claude Code'} · {source.project}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!!preparing} onClick={()=>onPrepare(source)}>{preparing===source.id?<LoaderCircle size={13} className="animate-spin"/>:<Sparkles size={13}/>} {copy.import}</Button><Button variant="ghost" size="sm" disabled={!!preparing} onClick={()=>onPrepare(source,true)}>{copy.read}</Button></div></div></div>)}
   </>}
  </div>
  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
   {preparing?<span role="status" className="flex items-center gap-2"><LoaderCircle size={13} className="animate-spin"/>{copy.preparingSource}</span>:<span>{copy.local}</span>}
   {preparing?<Button variant="outline" size="sm" onClick={onCancel}>{copy.cancelPrepare}</Button>:<Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}><RefreshCw size={13}/>{copy.refresh}</Button>}
  </div>
 </>;
}
