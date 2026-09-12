import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { GET as preview } from '@/app/api/obsidian-plugins/package/route';
import { GET, POST } from '@/app/api/obsidian-plugins/data/route';
vi.mock('@/lib/settings', () => ({ readSettings: () => ({ mindRoot: testMindRoot }) }));
async function install() {
 seedFile('.mindos/plugins/example/manifest.json',JSON.stringify({id:'example',name:'Example',version:'1.0.0'}));
 seedFile('.mindos/plugins/example/main.js','throw new Error("must not execute");');
 const meta=await (await preview(new NextRequest('http://localhost/api/obsidian-plugins/package?pluginId=example'))).json();
 return {pluginId:'example',vaultId:meta.vaultId,fingerprint:meta.fingerprint};
}
const get=(binding: Record<string,string>)=>GET(new NextRequest('http://localhost/api/obsidian-plugins/data?'+new URLSearchParams(binding)));
const post=(body: unknown)=>POST(new NextRequest('http://localhost/api/obsidian-plugins/data',{method:'POST',body:JSON.stringify(body)}));
describe('plugin configuration API',()=>{
 it('returns no-store configuration and requires a matching revision to save',async()=>{
  const binding=await install();const initial=await get(binding);expect(initial.status).toBe(200);expect(initial.headers.get('cache-control')).toContain('no-store');
  const {revision}=await initial.json();
  const saved=await post({...binding,revision,data:{label:'中文',enabled:false}});expect(saved.status).toBe(200);
  expect((await (await get(binding)).json()).data).toEqual({label:'中文',enabled:false});
  expect((await post({...binding,revision,data:{bad:true}})).status).toBe(409);
 });
 it('refuses changed packages, missing authority, extra paths and malformed bodies without leaking settings',async()=>{
  const binding=await install();seedFile('.mindos/plugins/example/data.json','{"secret":"do-not-leak"}');
  expect((await get({pluginId:'example'})).status).toBe(400);
  seedFile('.mindos/plugins/example/main.js','changed');const changed=await get(binding);
  expect(changed.status).toBe(400);expect(await changed.text()).not.toContain('do-not-leak');
  expect((await post({...binding,revision:'a'.repeat(64),path:'../another',data:{}})).status).toBe(400);
  expect((await POST(new NextRequest('http://localhost/api/obsidian-plugins/data',{method:'POST',body:'{broken'}))).status).toBe(400);
 });
 it('rejects oversized input before parsing or writing',async()=>{
  const binding=await install();const {revision}=await (await get(binding)).json();
  expect((await post({...binding,revision,data:'x'.repeat(1024*1024+4096)})).status).toBe(400);
  expect((await (await get(binding)).json()).data).toBeNull();
 });
});
