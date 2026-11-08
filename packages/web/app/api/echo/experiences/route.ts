import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listReplaySourcePage, readReplaySource } from '@geminilight/mindos/agent/runtime/adapters';
import { extractBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { readBranchStory, saveBranchStory } from '@geminilight/mindos/knowledge/branch-replay/store';
import { body, json, ownerBoundary } from '@/lib/research-http';
import { episodeFromStory, type ExperienceEpisode } from '@/lib/echo-experiences';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const selection = z.object({ runtime: z.enum(['claude', 'codex']), id: z.string().regex(/^[\w-]{1,100}$/) }).strict();
const inputSchema = z.object({ sources: z.array(selection).min(1).max(8) }).strict();
export async function GET(req: NextRequest) {
  const denied = await ownerBoundary(req); if (denied) return denied;
  const params = req.nextUrl.searchParams, query = params.get('query')?.trim().slice(0, 160), includeArchived = params.get('archived') === '1';
  const results = await Promise.allSettled((['codex', 'claude'] as const).map(async runtime => {
    const cursor = params.get(runtime) || undefined;
    if (cursor === 'done') return { runtime, sources: [], nextCursor: null };
    return { runtime, ...await listReplaySourcePage({ runtime, query, limit: 50, cursor, includeArchived }) };
  }));
  const sources = results.flatMap(result => result.status === 'fulfilled' ? result.value.sources : []);
  const cursors = { codex: null as string | null, claude: null as string | null };
  const sourceErrors = results.flatMap((result, i) => result.status === 'rejected' ? [{ runtime: ['codex', 'claude'][i], error: '本地会话索引暂时无法读取，可刷新重试。' }] : []);
  for (const result of results) if (result.status === 'fulfilled') cursors[result.value.runtime] = result.value.nextCursor;
  const episodes: ExperienceEpisode[] = [];
  for (const source of sources) {
    try { const story = readBranchStory(`replay-${source.runtime}-${source.id}`); if (story) episodes.push(episodeFromStory(story, source)); }
    catch { episodes.push({ source, status: 'unavailable', error: '已保存的剧情暂时无法读取，可查看原文后重试。' }); }
  }
  return json({ sources, episodes, cursors, sourceErrors });
}
export async function POST(req: NextRequest) {
  const denied = await ownerBoundary(req); if (denied) return denied;
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(await body(req)); } catch { return json({ error: '一次选择 1–8 段有效的本地会话。' }, 400); }
  if (req.signal.aborted) return json({ error: '已取消整理。' }, 499);
  const unique = [...new Map(input.sources.map(source => [`${source.runtime}:${source.id}`, source])).values()];
  // Two readers at once bound file/SDK work; each result remains independently recoverable.
  const episodes: ExperienceEpisode[] = [];
  for (let i = 0; i < unique.length; i += 2) {
    if (req.signal.aborted) return json({ error: '已取消整理。' }, 499);
    const batch = await Promise.all(unique.slice(i, i + 2).map(async (selected) => {
      const source = { ...selected, title: selected.id };
      try {
        const existing = readBranchStory(`replay-${selected.runtime}-${selected.id}`);
        const raw = existing?.source || await readReplaySource(selected.runtime, selected.id);
        const story = existing || extractBranchStory(raw);
        if (!story) return { source: { ...source, title: raw.title, cwd: raw.cwd, updatedAt: raw.updatedAt, project: raw.project }, status: 'no-decisions' as const };
        if (!existing && !req.signal.aborted) saveBranchStory(story);
        return episodeFromStory(story, { ...source, cwd: raw.cwd, project: raw.project, updatedAt: raw.updatedAt, title: raw.title });
      } catch { return { source, status: 'unavailable' as const, error: '这段会话暂时无法读取。原记录没有被改动，可单独重试。' }; }
    }));
    episodes.push(...batch);
  }
  return json({ episodes });
}
