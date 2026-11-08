import { describe, expect, it } from 'vitest';
import { experienceInProgress, recommendExperience, type ExperienceEpisode } from '@/lib/echo-experiences';
const episode = (id: string, count: number): ExperienceEpisode => ({
  source: { id, runtime: 'claude', title: id }, status: 'ready', storyId: id,
  decisions: Array.from({ length: count }, (_, i) => ({ id: String(i), title: '当时的问题', context: '后来才揭晓的内容' })),
});
describe('a clear starting experience', () => {
  it('prefers unfinished work, otherwise the fuller documented decision sequence', () => {
    const small = episode('small', 2), full = episode('full', 5);
    expect(recommendExperience([small, full])?.storyId).toBe('full');
    expect(recommendExperience([small, full], value => value === small ? { sceneIndex: 0, phase: 'result' } : null)?.storyId).toBe('small');
    expect(experienceInProgress(full, { sceneIndex: 4, phase: 'complete' })).toBe(false);
    expect(recommendExperience([small, full], value => value === small ? { sceneIndex: 1, phase: 'complete' } : null)?.storyId).toBe('full');
  });
  it('does not recommend unavailable, empty, or unprepared records', () => {
    expect(recommendExperience([])).toBeUndefined();
    expect(recommendExperience([{ ...episode('missing', 5), status: 'unavailable' }, episode('empty', 0)])).toBeUndefined();
  });
});
