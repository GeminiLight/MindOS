'use client';
import { ArrowRight, ChevronRight, FileText, Play } from 'lucide-react';
import type { ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import type { ExperienceEpisode } from '@/lib/echo-experiences';
import { experienceSourceKey, experienceTitle, experienceInProgress, decisionPreview } from '@/lib/echo-experiences';
import { Button } from '@/components/ui/button';
interface Props { source: ReplaySourceSummary; episode?: ExperienceEpisode; progress: {sceneIndex:number;phase:string} | null; locale:'zh'|'en'; analyzing:boolean; busy:string; open:(source:ReplaySourceSummary,scene?:string)=>void; read:(source:ReplaySourceSummary)=>Promise<void>; resume:(source:ReplaySourceSummary)=>Promise<void>; analyze:(sources:ReplaySourceSummary[])=>Promise<void>; }
export function ExperienceEpisodeCard({source,episode,progress,locale,analyzing,busy,open,read,resume,analyze}:Props) {
  const say=(cn:string,en:string)=>locale==='zh'?cn:en;
  const paused=!!episode&&experienceInProgress(episode,progress);
  const date=(value?:number)=>Number.isFinite(value)?new Intl.DateTimeFormat(locale==='zh'?'zh-CN':'en',{month:'short',day:'numeric'}).format(value):say('日期未知','Date unknown');
  return <article className="experience-episode" data-source={experienceSourceKey(source)}>
      <div className="experience-time"><span>{date(source.createdAt || source.updatedAt)}</span><span className="experience-runtime">{source.runtime === 'claude' ? 'Claude' : 'Codex'}</span></div>
      <div className="experience-episode-body"><div className="experience-episode-title"><h3 title={episode?.title || source.title}>{experienceTitle(episode?.title || source.title, source.project)}</h3>{source.archived && <span className="experience-status">{say('已归档', 'Archived')}</span>}</div>
        {episode?.status === 'ready' ? <>
          <p className="experience-caption">{episode.decisions?.length} {say('个可重走的转折', episode.decisions?.length===1?'decision point':'decision points')}{progress && (paused?` · ${say('停在第', 'Paused at')} ${progress.sceneIndex + 1} ${say('个', '')}`:` · ${say('已读到最后一处', 'Last decision reached')}`)}</p>
          <div className="experience-decisions">{episode.decisions?.slice(0, 2).map((decision, index) => <button key={decision.id} onClick={() => open(source, decision.id)} className="experience-decision"><span>{String(index + 1).padStart(2, '0')}</span><span>{decisionPreview(decision)}</span><ChevronRight size={14}/></button>)}{(episode.decisions?.length || 0) > 2 && <details className="experience-more-decisions"><summary>{say('其余转折', 'More decisions')} · {(episode.decisions?.length || 0) - 2}</summary>{episode.decisions?.slice(2).map((decision, index) => <button key={decision.id} onClick={() => open(source, decision.id)} className="experience-decision"><span>{String(index + 3).padStart(2, '0')}</span><span>{decisionPreview(decision)}</span><ChevronRight size={14}/></button>)}</details>}</div>
          {episode.coverage?.truncated && <p className="experience-caption">{say('长会话节选，已保留', 'Long session excerpt:')} {episode.coverage.includedMessages} / {episode.coverage.totalMessages} {say('条可见发言', 'visible messages')}</p>}
        </> : <p className="experience-caption">{episode?.status === 'no-decisions' ? say('暂未找到明确的取舍，原文仍值得回看。', 'No explicit trade-off found. The original conversation is still available.') : episode?.status === 'unavailable' ? say('读取中断，可单独重试。', 'Could not read this session. Retry it individually.') : analyzing ? say('正在从原文寻找转折…', 'Looking for decisions in the original record…') : say('尚未梳理', 'Not explored yet')}</p>}
        <div className="experience-episode-actions">
          {episode?.status === 'ready' ? <Button variant="outline" size="sm" onClick={() => open(source)}><Play size={12}/>{paused ? say('接着重走', 'Continue replay') : progress?say('回看这段经历','Revisit'):say('重走这段', 'Replay')}</Button> : <Button variant="outline" size="sm" disabled={analyzing || !!busy} onClick={() => void analyze([source])}>{say(episode?.status === 'unavailable' ? '重试整理' : '寻找转折', 'Find decisions')}</Button>}
          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void read(source)}><FileText size={13}/>{say('原文', 'Original')}</Button>
          {!source.archived && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void resume(source)}>{say('续接原会话', 'Resume session')}<ArrowRight size={13}/></Button>}
        </div>
      </div>
    </article>;
}
