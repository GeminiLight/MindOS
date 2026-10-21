import ReplayPageClient from '@/components/echo/replay/ReplayPageClient';
import { listBranchStories } from '@geminilight/mindos/knowledge/branch-replay/store';
import type { BranchStory } from '@geminilight/mindos/knowledge/branch-replay';
import { allowsSameOriginExemption } from '@geminilight/mindos/server';
import { headers } from 'next/headers';
export const metadata={title:'分支剧情 · MindOS'};
export const dynamic='force-dynamic';
export default async function ReplayPage({searchParams}:{searchParams:Promise<{story?:string|string[]}>}){
 const params=await searchParams;const wanted=Array.isArray(params.story)?params.story[0]:params.story;
 let initialStory:BranchStory|null=null;
 try{
  const incoming=new Headers(await headers());const site=incoming.get('sec-fetch-site');
  // Page navigation must not broaden the API's local-browser exemption.
  // Other clients retain the authenticated API loading path.
  if((site==='none'||site==='same-origin')&&allowsSameOriginExemption({headers:incoming})){
   const stories=listBranchStories();initialStory=(wanted?stories.find(story=>story.id===wanted):stories[0])??null;
  }
 }
 catch{/* The catalog API retains the existing error and retry surface. */}
 return <ReplayPageClient initialStory={initialStory}/>;
}
