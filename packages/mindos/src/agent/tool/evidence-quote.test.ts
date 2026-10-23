import {expect,it} from 'vitest';
import {resolveEvidenceQuote} from './evidence-quote.js';
it('recovers the actual raw excerpt when the model omits inline markdown formatting',()=>{
 const raw='Before: ~~A · 强制刷新页面~~ —— *占位：历史记录中未出现此分支，为走通剧情补的推演*';
 const quote='A · 强制刷新页面 —— 占位：历史记录中未出现此分支，为走通剧情补的推演';
 const resolved=resolveEvidenceQuote(raw,quote);expect(resolved).toBeTruthy();expect(raw).toContain(resolved);expect(resolved).toContain('~~');
});
it('rejects changed words, ambiguous formatted matches, and short fuzzy matches',()=>{
 expect(resolveEvidenceQuote('The result was **not** successful.','The result was successful.')).toBeNull();
 expect(resolveEvidenceQuote('a **long enough quotation that appears twice** a **long enough quotation that appears twice**','long enough quotation that appears twice')).toBe('long enough quotation that appears twice');
 expect(resolveEvidenceQuote('**tiny** **phrase**','tiny phrase')).toBeNull();
 expect(resolveEvidenceQuote('**A sufficiently long** quotation twice / **A sufficiently long** quotation twice','A sufficiently long quotation twice')).toBeNull();
});
