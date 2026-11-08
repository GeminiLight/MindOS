import { ChevronRight } from 'lucide-react';
import type { ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { experienceTitle, decisionPreview } from '@/lib/echo-experiences';
import type { ExperienceEpisode } from '@/lib/echo-experiences';
export function ProjectDecisions({ episodes, locale, onOpen }: { episodes: ExperienceEpisode[]; locale:'zh'|'en'; onOpen:(source:ReplaySourceSummary,sceneId:string)=>void }) {
  if (!episodes.some(episode => episode.decisions?.length)) return <p className="experience-empty">{locale === 'zh' ? '还没有找到明确的取舍。可以切回项目脉络查看原文，或继续梳理会话。' : 'No explicit decisions yet. Switch to Journey to read the original sessions, or explore more sessions.'}</p>;
  return <div className="experience-key-decisions">{episodes.flatMap(episode => episode.decisions?.map((decision, index) => <button key={`${episode.storyId}:${decision.id}`} className="experience-key-decision" onClick={() => onOpen(episode.source, decision.id)}><span className="experience-eyebrow">{episode.source.runtime === 'claude' ? 'Claude' : 'Codex'} · {locale === 'zh' ? `转折 ${index + 1}` : `Decision ${index + 1}`}</span><h3>{decisionPreview(decision)}</h3><span className="experience-key-source">{experienceTitle(episode.title || '', episode.source.project)}<ChevronRight size={14}/></span></button>) || [])}</div>;
}
