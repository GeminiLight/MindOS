import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { validateBranchStory } from './index.js';
import { listBranchStories, saveBranchStory, readBranchStory } from './store.js';
const dirs: string[] = [];
afterEach(() => { for (const p of dirs.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
function home() { const p=fs.mkdtempSync(path.join(os.tmpdir(),'replay-store-')); dirs.push(p); return p; }
function story() { return validateBranchStory({ id:'one',runtime:'codex',title:'选择',messages:[{id:'m',role:'user',text:'保留原来结构，继续打磨。'}] }, {
  title:'保留结构', summary:'核对一次选择',scenes:[{ id:'fork',title:'怎样继续',context:'已有结构',evidence:[{messageId:'m',quote:'原来结构'}],
    choices:['a','b'].map(id=>({id,label:id,description:'继续核对',proposal:{messageId:'m',quote:'打磨'},outcome:{kind:'unobserved',title:'尚无后续',steps:[]}})) }],
}); }
describe('private local story storage', () => {
  it('does not redisplay an old internal scheduler prompt copied into a scene context', () => {
    const dir = home(), value = story(); value.scenes[0].context = '<codexinternalcontext source="goal">private scheduler task</codexinternalcontext>';
    saveBranchStory(value, dir);
    const file = path.join(dir, '.mindos', 'branch-replays', value.id + '.json'), original = fs.readFileSync(file, 'utf8');
    expect(readBranchStory(value.id, dir)).toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('reads an older saved story directly even beyond the library preview window', () => {
    const dir = home();
    for (let i = 0; i < 55; i++) { const value = story(); value.source.id = `s-${i}`; saveBranchStory(validateBranchStory(value.source, value), dir); }
    expect(readBranchStory('replay-codex-s-54', dir)?.source.id).toBe('s-54');
    expect(readBranchStory('replay-codex-missing', dir)).toBeNull();
    expect(() => readBranchStory('../outside', dir)).toThrow();
  });
  it('persists one validated story and keeps the directory outside the repository', () => {
    const dir=home(); const value=story(); saveBranchStory(value,dir); saveBranchStory(value,dir);
    expect(listBranchStories(dir)).toEqual([value]);
    const file=path.join(dir,'.mindos','branch-replays',value.id+'.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  it('returns an empty library only when no storage exists', () => { expect(listBranchStories(home())).toEqual([]); });
  it('reports damaged stored content instead of silently deleting it', () => {
    const dir=home(); saveBranchStory(story(),dir);
    fs.writeFileSync(path.join(dir,'.mindos','branch-replays',story().id+'.json'),'{broken');
    expect(()=>listBranchStories(dir)).toThrow();
  });
  it('refuses a symlinked story directory and forged story content', () => {
    const dir=home(); const outside=home(); fs.mkdirSync(path.join(dir,'.mindos')); fs.symlinkSync(outside,path.join(dir,'.mindos','branch-replays'));
    expect(()=>saveBranchStory(story(),dir)).toThrow(/symlink/i);
    const other=home(); const bad=story(); bad.scenes[0].evidence[0].quote='invented';
    expect(()=>saveBranchStory(bad,other)).toThrow();
  });
});
