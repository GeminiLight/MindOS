import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { handleConnectGet } from './connect.js';
import { handleFilePost } from './file.js';
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mobile-create-root-')); });
afterEach(() => rmSync(root, { recursive:true, force:true }));
it.each(['previous-root', '', null, 123])('rejects a mismatched or invalid creation root before writing: %j', async expectedRootId => {
  const result = await handleFilePost({op:'create_file',path:'inbox/private.md',content:'private idea',expectedRootId},{mindRoot:root});
  expect(result.status).toBe(409);expect(result.body).toMatchObject({error:'root_changed'});
  expect(result.changeEvent).toBeFalsy();expect(existsSync(join(root,'inbox'))).toBe(false);
});
it('creates in the verified root and keeps unguarded callers compatible', async () => {
  const expectedRootId=handleConnectGet({mindRoot:root}).body.rootId;
  for(const [index,extra] of [{expectedRootId},{}].entries()) {
    const result=await handleFilePost({op:'create_file',path:`note-${index}.md`,content:'idea',...extra},{mindRoot:root});
    expect(result.status).toBe(200);expect(readFileSync(join(root,`note-${index}.md`),'utf8')).toBe('idea');
  }
});
