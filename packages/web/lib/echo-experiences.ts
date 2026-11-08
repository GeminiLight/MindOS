import type { BranchStory, ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';

export interface ExperienceEpisode {
  source: ReplaySourceSummary;
  status: 'ready' | 'no-decisions' | 'unavailable';
  storyId?: string;
  title?: string;
  decisions?: Array<{ id: string; title: string; context: string }>;
  coverage?: BranchStory['source']['coverage'];
  error?: string;
}
export interface ExperienceCatalog {
  sources: ReplaySourceSummary[];
  episodes: ExperienceEpisode[];
  cursors: Record<'codex' | 'claude', string | null>;
  sourceErrors: Array<{ runtime: string; error: string }>;
}
export interface ExperienceProgress { sceneIndex: number; phase: string; }
export function experienceInProgress(episode: ExperienceEpisode, progress: ExperienceProgress | null) {
  return !!progress && (progress.phase !== 'complete' || progress.sceneIndex < (episode.decisions?.length || 1) - 1);
}
/** Prefer an unfinished replay, then the prepared experience with the most decision points. */
export function recommendExperience(episodes: ExperienceEpisode[], progress: (episode: ExperienceEpisode) => ExperienceProgress | null = () => null) {
  return episodes.filter(episode => episode.status === 'ready' && episode.storyId && episode.decisions?.length).sort((a, b) =>
    Number(experienceInProgress(b, progress(b))) - Number(experienceInProgress(a, progress(a))) ||
    (b.decisions?.length || 0) - (a.decisions?.length || 0) ||
    (b.source.updatedAt || 0) - (a.source.updatedAt || 0))[0];
}
export const experienceSourceKey = (source: Pick<ReplaySourceSummary, 'runtime' | 'id'>) => `${source.runtime}:${source.id}`;
/** Chapter questions orient the reader; later-scene context can contain earlier outcomes. */
export function decisionPreview(decision: { title: string; context: string }) {
  return /^(面对这次反馈|你想先试哪条路径|Which route would you try)/.test(decision.title) ? decision.context.slice(0, 105) : decision.title;
}
export function mergeExperienceSources(previous: ReplaySourceSummary[], incoming: ReplaySourceSummary[]) {
  const sources = new Map(previous.map(source => [experienceSourceKey(source), source]));
  for (const source of incoming) sources.set(experienceSourceKey(source), { ...sources.get(experienceSourceKey(source)), ...source });
  return [...sources.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || experienceSourceKey(a).localeCompare(experienceSourceKey(b)));
}
export function experienceProjects(sources: ReplaySourceSummary[]) {
  const groups = new Map<string, { id: string; title: string; path: string; sources: ReplaySourceSummary[] }>();
  for (const source of sources) {
    const id = source.projectId || 'unassigned';
    const project = groups.get(id) || { id, title: source.project || '未归属项目', path: source.projectPath || '', sources: [] };
    project.sources.push(source); groups.set(id, project);
  }
  return [...groups.values()];
}
export function episodeFromStory(story: BranchStory, source: ReplaySourceSummary): ExperienceEpisode {
  return { source, status: 'ready', storyId: story.id, title: story.title,
    decisions: story.scenes.map(scene => ({ id: scene.id, title: scene.title, context: scene.context })), coverage: story.source.coverage };
}

/** Keep transport URLs out of a reading title, preserving their original record. */
export function experienceTitle(text: string, fallback = '项目经历') {
  const clean = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/^[\s\[\]()._-]+|[\s\[\]()._-]+$/g, '').trim();
  return clean || fallback;
}
