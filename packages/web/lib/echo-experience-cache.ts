import type { ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { experienceSourceKey, mergeExperienceSources, type ExperienceCatalog, type ExperienceEpisode } from './echo-experiences';

const sourceIsValid = (value: unknown): value is ReplaySourceSummary => {
  if (!value || typeof value !== 'object') return false;
  const source = value as ReplaySourceSummary;
  return ['claude', 'codex'].includes(source.runtime) && typeof source.id === 'string' && /^[\w-]{1,100}$/.test(source.id) && typeof source.title === 'string' &&
    ['cwd', 'project', 'projectId', 'projectPath'].every(key => source[key as keyof ReplaySourceSummary] === undefined || typeof source[key as keyof ReplaySourceSummary] === 'string');
};
export function restoreExperienceCatalog(raw: unknown): ExperienceCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as ExperienceCatalog;
  if (!Array.isArray(value.sources) || value.sources.length > 1000 || !value.sources.every(sourceIsValid) || !Array.isArray(value.episodes)) return null;
  if (!value.episodes.every(episode => episode && sourceIsValid(episode.source) && ['ready','no-decisions','unavailable'].includes(episode.status) &&
    (episode.storyId === undefined || typeof episode.storyId === 'string') && (episode.title === undefined || typeof episode.title === 'string') &&
    (episode.decisions === undefined || Array.isArray(episode.decisions) && episode.decisions.every(decision => decision && ['id','title','context'].every(key => typeof decision[key as keyof typeof decision] === 'string'))))) return null;
  if (!value.cursors || !['codex','claude'].every(key => value.cursors[key as 'codex'|'claude'] === null || typeof value.cursors[key as 'codex'|'claude'] === 'string')) return null;
  return { ...value, sourceErrors: Array.isArray(value.sourceErrors) ? value.sourceErrors.filter(item => item && typeof item.runtime === 'string' && typeof item.error === 'string') : [] };
}

/** Remember discoveries across filters; a filtered page's cursor must never become the main cursor. */
export function mergeExperienceCatalogSnapshot(previous: ExperienceCatalog | null, current: ExperienceCatalog, unfiltered: boolean): ExperienceCatalog {
  const sources = mergeExperienceSources(previous?.sources || [], current.sources).slice(0, 1000);
  const keys = new Set(sources.map(experienceSourceKey));
  const episodes = new Map<string, ExperienceEpisode>();
  for (const episode of [...previous?.episodes || [], ...current.episodes]) {
    const key = experienceSourceKey(episode.source);
    if (keys.has(key)) episodes.set(key, episode);
  }
  return { sources, episodes: [...episodes.values()], cursors: unfiltered ? current.cursors : previous?.cursors || { codex: null, claude: null }, sourceErrors: [] };
}
