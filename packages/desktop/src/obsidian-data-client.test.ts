import { describe, expect, it, vi } from 'vitest';
import { createObsidianDataClient } from './obsidian-data-client';
const binding={pluginId:'example',vaultId:'a'.repeat(64),fingerprint:'b'.repeat(64)};
function options(fetchImpl: typeof fetch) { return { ...binding,baseUrl:'http://127.0.0.1:4567',token:'test-token',signal:new AbortController().signal,fetchImpl }; }
describe('plugin configuration transport',()=>{
 it('pins identity, carries revisions and serializes concurrent saves',async()=>{
  const bodies: any[]=[];
  const fetchImpl=vi.fn(async (url: any,init: any)=>{
   expect(String(url)).toContain('/api/obsidian-plugins/data');
   expect(init.headers.authorization).toBe('Bearer test-token');
   if(init.method==='GET')return Response.json({data:{before:true},revision:'c'.repeat(64)});
   const body=JSON.parse(init.body);bodies.push(body);
   return Response.json({data:body.data,revision:(bodies.length===1?'d':'e').repeat(64)});
  }) as typeof fetch;
  const client=createObsidianDataClient(options(fetchImpl));
  expect(await client.read()).toEqual({before:true});
  await Promise.all([client.save({n:1}),client.save({n:2})]);
  expect(bodies.map(b=>b.revision)).toEqual(['c'.repeat(64),'d'.repeat(64)]);
  expect(bodies[0]).toMatchObject(binding);
 });
 it('surfaces conflicts and does not silently retry with a newer revision',async()=>{
  const fetchImpl=vi.fn(async (_: any,init: any)=>init.method==='GET'?Response.json({data:null,revision:'c'.repeat(64)}):Response.json({error:'configuration_conflict'},{status:409})) as typeof fetch;
  const client=createObsidianDataClient(options(fetchImpl));await client.read();
  await expect(client.save({n:1})).rejects.toThrow(/conflict/i);
  await expect(client.save({n:2})).rejects.toThrow(/conflict|reload/i);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
 });
 it('rejects use before reading, oversized settings and revoked requests',async()=>{
  const fetchImpl=vi.fn(async()=>Response.json({data:null,revision:'c'.repeat(64)})) as typeof fetch;
  const abort=new AbortController();const client=createObsidianDataClient({...options(fetchImpl),signal:abort.signal});
  await expect(client.save({})).rejects.toThrow(/read|load/i);
  await client.read();await expect(client.save('x'.repeat(1024*1024+1))).rejects.toThrow(/limit/i);
  abort.abort();await expect(client.save({})).rejects.toThrow();
 });
});
