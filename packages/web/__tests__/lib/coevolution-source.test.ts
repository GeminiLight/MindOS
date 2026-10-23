import {expect,it} from 'vitest';
import {sessionExcerpts} from '@/lib/coevolution-source';
it('preserves a human correction in the middle of a long session with its surrounding replies',()=>{
 const messages=Array.from({length:35},(_,i)=>({id:String(i),role:i===14?'user':'assistant',text:i===14?'My actual correction':'Reply '+i}));
 const selected=sessionExcerpts(messages);expect(selected.map(m=>m.messageId)).toEqual(expect.arrayContaining(['13','14','15']));expect(selected.length).toBeLessThanOrEqual(20);
});
it('ignores tool-only content and bounds long quotations',()=>{
 expect(sessionExcerpts([{id:'tool',role:'tool',text:'private tool data'},{id:'a',role:'assistant',text:'x'.repeat(10000)}])).toEqual([{messageId:'a',role:'assistant',quote:'x'.repeat(500)}]);
 expect(sessionExcerpts([])).toEqual([]);
});
