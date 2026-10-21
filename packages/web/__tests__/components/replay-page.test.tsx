import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReplayPage from '@/app/echo/replay/page';
import { requestRaceExample } from '@/components/echo/replay/replay-example';
const saved=vi.hoisted(()=>vi.fn());
const request=vi.hoisted(()=>({headers:{host:'127.0.0.1:4567','sec-fetch-site':'none'} as Record<string,string>}));
vi.mock('next/headers',()=>({headers:async()=>new Headers(request.headers)}));
vi.mock('@geminilight/mindos/server',async()=>({allowsSameOriginExemption:(await import('../../../mindos/src/server/auth')).allowsSameOriginExemption}));
vi.mock('@geminilight/mindos/knowledge/branch-replay/store',()=>({listBranchStories:saved}));
vi.mock('@/components/echo/replay/ReplayPageClient',()=>({default:()=>null}));
beforeEach(()=>{saved.mockReset();request.headers={host:'127.0.0.1:4567','sec-fetch-site':'none'};});
describe('saved replay page snapshot',()=>{
 it('passes the requested saved story directly to the reading page',async()=>{
  const story=requestRaceExample('zh');saved.mockReturnValue([story]);
  const page=await ReplayPage({searchParams:Promise.resolve({story:story.id})});
  expect(page.props.initialStory).toEqual(story);
 });
 it('uses the first saved story for an unlinked visit but never substitutes for a missing link',async()=>{
  const story=requestRaceExample('zh');saved.mockReturnValue([story]);
  expect((await ReplayPage({searchParams:Promise.resolve({})})).props.initialStory).toEqual(story);
  expect((await ReplayPage({searchParams:Promise.resolve({story:'missing'})})).props.initialStory).toBeNull();
  expect((await ReplayPage({searchParams:Promise.resolve({story:['missing',story.id]})})).props.initialStory).toBeNull();
 });
 it('keeps the existing catalog recovery path when private storage cannot be read',async()=>{
  saved.mockImplementation(()=>{throw new Error('Unreadable');});
  expect((await ReplayPage({searchParams:Promise.resolve({})})).props.initialStory).toBeNull();
 });
 it.each([
  {host:'192.168.1.8:4567','sec-fetch-site':'none'},
  {host:'localhost:4567','sec-fetch-site':'cross-site'},
  {host:'localhost:4567'},
  {host:'localhost:4567','sec-fetch-site':'none','x-forwarded-for':'192.168.1.8'},
 ])('does not preload private transcripts outside direct local browser navigation: %j',async(headers)=>{
  request.headers=headers;saved.mockReturnValue([requestRaceExample('zh')]);
  expect((await ReplayPage({searchParams:Promise.resolve({})})).props.initialStory).toBeNull();
  expect(saved).not.toHaveBeenCalled();
 });
});
