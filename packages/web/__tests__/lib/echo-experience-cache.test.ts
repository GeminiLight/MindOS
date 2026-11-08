import { describe, expect, it } from 'vitest';
import { mergeExperienceCatalogSnapshot, restoreExperienceCatalog } from '@/lib/echo-experience-cache';
import type { ExperienceCatalog } from '@/lib/echo-experiences';
const source = { id:'one',runtime:'claude' as const,title:'一个项目' };
const initial: ExperienceCatalog = {sources:[source],episodes:[],cursors:{codex:'50',claude:null},sourceErrors:[]};
describe('discovered project catalog snapshot',()=>{
  it('remembers filtered discoveries without substituting their cursors for the full catalog',()=>{
    const filtered={...initial,sources:[{...source,id:'found'}],cursors:{codex:'100',claude:'50'}};
    const saved=mergeExperienceCatalogSnapshot(initial,filtered,false);
    expect(saved.sources.map(value=>value.id).sort()).toEqual(['found','one']);
    expect(saved.cursors).toEqual(initial.cursors);
    expect(mergeExperienceCatalogSnapshot(saved,initial,true).sources).toHaveLength(2);
  });
  it('rejects damaged sources, episodes and cursor state instead of crashing the project page',()=>{
    for(const value of [null,{}, {...initial,sources:[{...source,title:{bad:true}}]}, {...initial,episodes:[{}]}, {...initial,cursors:{}}]) expect(restoreExperienceCatalog(value)).toBeNull();
    expect(restoreExperienceCatalog(initial)).toEqual(initial);
  });
  it('replaces a revised episode and bounds the metadata snapshot without keeping orphan episodes',()=>{
    const previous={...initial,episodes:[{source,status:'ready' as const,storyId:'s',title:'旧投影'}]};
    const updated={...initial,episodes:[{source,status:'ready' as const,storyId:'s',title:'修正后的投影'}]};
    expect(mergeExperienceCatalogSnapshot(previous,updated,true).episodes[0].title).toBe('修正后的投影');
    const large={...initial,sources:Array.from({length:1001},(_,i)=>({...source,id:`s${i}`,updatedAt:i}))};
    const bounded=mergeExperienceCatalogSnapshot(previous,large,true);
    expect(bounded.sources).toHaveLength(1000);expect(bounded.episodes).toEqual([]);
  });
});
