export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { listReplaySources, readReplaySource } from '@geminilight/mindos/agent/runtime/adapters';
import { extractBranchStory, validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { listBranchStories, saveBranchStory } from '@geminilight/mindos/knowledge/branch-replay/store';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const query = params.get('query')?.trim().slice(0, 160);
    const selectedRuntime = params.get('runtime') || 'codex';
    if (!['codex','claude'].includes(selectedRuntime)) return json({error:'Unsupported source runtime'},400);
    const pages = await Promise.allSettled([listReplaySources({ runtime: selectedRuntime, query, limit: 16 })]);
    const sources = pages.flatMap(p => p.status === 'fulfilled' ? p.value : []);
    const sourceErrors = pages.flatMap(p => p.status === 'rejected' ? [{ runtime: selectedRuntime, error: p.reason instanceof Error ? p.reason.message : 'Source unavailable' }] : []);
    return json({ stories: listBranchStories(), sources, sourceErrors });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Could not read replays' }, 500); }
}

export async function POST(req: Request) {
  if(req.signal.aborted)return json({error:'Request cancelled'},499);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 150_000) return json({ error: 'Replay request is too large' }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || !['codex', 'claude'].includes(String(body.runtime)) || typeof body.sessionId !== 'string' || !/^[\w-]{1,100}$/.test(body.sessionId)) return json({ error: 'A valid runtime and sessionId are required' }, 400);
  } catch { return json({ error: 'Invalid JSON request' }, 400); }
  try {
    const saved=!body.draft&&body.op!=='read'&&!body.regenerate?listBranchStories().find(s=>s.id===`replay-${body.runtime}-${body.sessionId}`):undefined;
    if(saved)return json({story:saved,generation:'saved'});
    const source = await readReplaySource(String(body.runtime), String(body.sessionId));
    if(req.signal.aborted)return json({error:'Request cancelled'},499);
    if (body.op === 'read') return json({ source });
    let story;
    try { story = body.draft ? validateBranchStory(source, body.draft) : extractBranchStory(source); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Source validation failed' }, 422); }
    if (!story) return json({ error: '这段会话里暂时没有足够明确的取舍与后续记录。你仍然可以查看原文。', source }, 422);
    if(req.signal.aborted)return json({error:'Request cancelled'},499);
    saveBranchStory(story);
    return json({ story, generation: 'source-reconstruction' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not prepare this replay';
    return json({ error: message }, /missing|unreadable/i.test(message) ? 404 : 500);
  }
}
