'use client';
import { useState } from 'react';
import { ArrowUpRight, MessageSquare, UserRound } from 'lucide-react';
import type { BranchStory, ReplayRef, ReplaySource } from '@geminilight/mindos/knowledge/branch-replay';
import { Button } from '@/components/ui/button';
import type { ReplayCopy } from './replay-copy';

export function EvidenceExcerpt({ story, reference, copy, onOpen }: { story:BranchStory; reference:ReplayRef; copy:ReplayCopy; onOpen?:(id:string)=>void }) {
  const message = story.source.messages.find(m=>m.id===reference.messageId);
  return <div className="replay-evidence-item">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">{message?.role==='user'?<UserRound size={13}/>:<MessageSquare size={13}/>}<span>{message?.role==='user'?copy.user:copy.assistant}</span></div>
    <blockquote className="mt-3 text-sm leading-7 text-foreground">{reference.quote}</blockquote>
    {onOpen && <Button variant="ghost" size="sm" onClick={()=>onOpen(reference.messageId)} className="mt-3 -ml-2 text-muted-foreground">{copy.inspect}<ArrowUpRight size={13}/></Button>}
  </div>;
}

export function OriginalRecord({story,source,copy,focusId,highlightQuote}:{story?:BranchStory;source?:ReplaySource;copy:ReplayCopy;focusId?:string|null;highlightQuote?:string}) {
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const record=source??story!.source;
  const messages=focusId?record.messages.filter(m=>m.id===focusId):record.messages;
  return <div className="replay-original">
    <div className="mb-7 flex items-center gap-2 text-xs text-muted-foreground"><MessageSquare size={14}/>{record.runtime==='example'?copy.example:record.runtime==='codex'?'Codex':'Claude Code'}<span>·</span>{messages.length} {copy.visibleMessages}</div>
    {messages.map(message=><article key={message.id} id={`replay-message-${message.id}`} className="replay-message">
      <div className="mb-3 flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{message.role==='user'?<UserRound size={14}/>:<MessageSquare size={14}/>} {message.role==='user'?copy.user:copy.assistant}</span>{message.timestamp&&<time className="font-mono text-xs text-muted-foreground">{new Date(message.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}</div>
      <p className="whitespace-pre-wrap break-words text-sm leading-8">{focusId&&highlightQuote&&message.text.includes(highlightQuote)?<>{message.text.slice(0,message.text.indexOf(highlightQuote))}<mark>{highlightQuote}</mark>{message.text.slice(message.text.indexOf(highlightQuote)+highlightQuote.length)}</>:expanded[message.id]||focusId?message.text:message.text.slice(0,800)}</p>
      {!focusId&&message.text.length>800&&<Button variant="ghost" size="sm" onClick={()=>setExpanded(s=>({...s,[message.id]:!s[message.id]}))} className="mt-2 -ml-2">{expanded[message.id]?copy.less:copy.more}</Button>}
    </article>)}
  </div>;
}
